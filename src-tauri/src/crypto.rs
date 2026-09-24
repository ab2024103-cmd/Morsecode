//! Session crypto: X25519 ECDH → HKDF-SHA256 → AES-256-GCM.
//!
//! One ephemeral key pair per TCP session, so every connection gets a fresh
//! key and there is no long-term secret on disk. The public key fingerprint
//! shown in the consent modal is derived from the peer's static identity key
//! (see [`Identity`]), which is what "trust this device" pins.

use anyhow::{anyhow, Result};
use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM, NONCE_LEN};
use ring::agreement::{agree_ephemeral, EphemeralPrivateKey, PublicKey, UnparsedPublicKey, X25519};
use ring::hkdf::{KeyType, Salt, HKDF_SHA256};
use ring::rand::{SecureRandom, SystemRandom};
use sha2::{Digest, Sha256};
use std::sync::atomic::{AtomicU64, Ordering};

const HKDF_INFO: &[u8] = b"morsecode/v1/session";
const HKDF_SALT: &[u8] = b"morsecode/v1/salt";
const KEY_LEN: usize = 32; // AES-256

/// Length marker for the HKDF expansion — avoids relying on ring's
/// `KeyType for &'static aead::Algorithm` impl.
struct Aes256KeyLen;

impl KeyType for Aes256KeyLen {
    fn len(&self) -> usize {
        KEY_LEN
    }
}

/// Which side of the connection we are — keeps the two nonce spaces disjoint.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    Initiator,
    Responder,
}

impl Role {
    fn send_tag(self) -> u8 {
        match self {
            Role::Initiator => 1,
            Role::Responder => 2,
        }
    }

    fn recv_tag(self) -> u8 {
        match self {
            Role::Initiator => 2,
            Role::Responder => 1,
        }
    }
}

/// Long-lived identity used purely for the trust fingerprint.
#[derive(Debug, Clone)]
pub struct Identity {
    pub id: String,
    pub fingerprint: String,
}

impl Identity {
    /// Deterministic per-installation id derived from a random seed stored in
    /// the app config dir (see `state::AppState::load_identity`).
    pub fn from_seed(seed: &[u8]) -> Self {
        let digest = Sha256::digest(seed);
        let hex = hex::encode(digest);
        let fingerprint = hex[..12]
            .as_bytes()
            .chunks(2)
            .map(|pair| String::from_utf8_lossy(pair).to_uppercase())
            .collect::<Vec<_>>()
            .join(":");
        Identity {
            id: format!("dev_{}", &hex[..16]),
            fingerprint,
        }
    }
}

pub fn random_seed() -> [u8; 32] {
    let rng = SystemRandom::new();
    let mut seed = [0u8; 32];
    // A failure here means the OS CSPRNG is unavailable; falling back to a
    // timestamp keeps the app usable but is only reached in exotic sandboxes.
    if rng.fill(&mut seed).is_err() {
        let now = crate::model::now_ms().to_be_bytes();
        seed[..8].copy_from_slice(&now);
    }
    seed
}

pub struct Handshake {
    private: EphemeralPrivateKey,
    public: PublicKey,
}

impl Handshake {
    pub fn new() -> Result<Self> {
        let rng = SystemRandom::new();
        let private = EphemeralPrivateKey::generate(&X25519, &rng)
            .map_err(|_| anyhow!("failed to generate X25519 ephemeral key"))?;
        let public = private
            .compute_public_key()
            .map_err(|_| anyhow!("failed to derive X25519 public key"))?;
        Ok(Self { private, public })
    }

    pub fn public_bytes(&self) -> Vec<u8> {
        self.public.as_ref().to_vec()
    }

    /// Consumes the ephemeral key and returns the sealed session.
    pub fn into_session(self, peer_public: &[u8], role: Role) -> Result<Session> {
        let peer = UnparsedPublicKey::new(&X25519, peer_public.to_vec());
        let key_bytes = agree_ephemeral(self.private, &peer, |shared| {
            let salt = Salt::new(HKDF_SHA256, HKDF_SALT);
            let prk = salt.extract(shared);
            let okm = prk
                .expand(&[HKDF_INFO], Aes256KeyLen)
                .expect("HKDF expand with a fixed 32-byte length cannot fail");
            let mut out = [0u8; KEY_LEN];
            okm.fill(&mut out)
                .expect("AES-256-GCM key length matches the OKM length");
            out
        })
        .map_err(|_| anyhow!("X25519 agreement failed"))?;

        let unbound = UnboundKey::new(&AES_256_GCM, &key_bytes)
            .map_err(|_| anyhow!("failed to build AES-256-GCM key"))?;

        Ok(Session {
            key: LessSafeKey::new(unbound),
            role,
            send_counter: AtomicU64::new(0),
            recv_counter: AtomicU64::new(0),
        })
    }
}

/// An established, authenticated channel. Every frame payload passes through
/// `seal`/`open` — nothing is ever written to the socket in the clear.
pub struct Session {
    key: LessSafeKey,
    role: Role,
    send_counter: AtomicU64,
    recv_counter: AtomicU64,
}

impl Session {
    fn nonce(tag: u8, counter: u64) -> Nonce {
        let mut bytes = [0u8; NONCE_LEN];
        bytes[0] = tag;
        bytes[4..12].copy_from_slice(&counter.to_be_bytes());
        Nonce::assume_unique_for_key(bytes)
    }

    pub fn seal(&self, plaintext: &[u8]) -> Result<Vec<u8>> {
        let counter = self.send_counter.fetch_add(1, Ordering::SeqCst);
        let mut buffer = plaintext.to_vec();
        self.key
            .seal_in_place_append_tag(
                Self::nonce(self.role.send_tag(), counter),
                Aad::empty(),
                &mut buffer,
            )
            .map_err(|_| anyhow!("AES-256-GCM seal failed"))?;
        let mut out = counter.to_be_bytes().to_vec();
        out.extend_from_slice(&buffer);
        Ok(out)
    }

    pub fn open(&self, ciphertext: &[u8]) -> Result<Vec<u8>> {
        if ciphertext.len() < 8 {
            return Err(anyhow!("ciphertext too short"));
        }
        let mut counter_bytes = [0u8; 8];
        counter_bytes.copy_from_slice(&ciphertext[..8]);
        let counter = u64::from_be_bytes(counter_bytes);

        // Replay protection: counters must strictly increase per direction.
        let expected = self.recv_counter.load(Ordering::SeqCst);
        if counter < expected {
            return Err(anyhow!("replayed or out-of-order frame rejected"));
        }
        self.recv_counter.store(counter + 1, Ordering::SeqCst);

        let mut buffer = ciphertext[8..].to_vec();
        let plaintext = self
            .key
            .open_in_place(
                Self::nonce(self.role.recv_tag(), counter),
                Aad::empty(),
                &mut buffer,
            )
            .map_err(|_| anyhow!("AES-256-GCM open failed — tampered or wrong key"))?;
        Ok(plaintext.to_vec())
    }
}

/// Stable id for resume matching: file content is identified by name + size +
/// the first and last 1 MiB, which is cheap and good enough to detect "same
/// file, interrupted" without hashing gigabytes.
pub fn quick_file_id(name: &str, size: u64, head: &[u8], tail: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(name.as_bytes());
    hasher.update(size.to_be_bytes());
    hasher.update(head);
    hasher.update(tail);
    hex::encode(&hasher.finalize()[..16])
}
