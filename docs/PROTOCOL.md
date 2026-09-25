# MorseCode network protocol

Everything below happens on the local subnet. There is no bootstrap server,
tracker, relay, STUN/TURN or update endpoint anywhere in the app.

## 1. Discovery

| Transport | Details |
|---|---|
| mDNS (primary) | Service type `_morsecode._tcp.local.`, TXT records `id`, `name`, `fp` (fingerprint), `platform`, `v`. Browsed continuously; peers are re-announced on a ~1200 ms sweep (configurable 400–5000 ms). |
| UDP broadcast (fallback) | JSON beacon on port **33457** (`SO_BROADCAST`, `SO_REUSEADDR`/`SO_REUSEPORT`), same fields plus `ts` and `unicast`. Sent to `255.255.255.255` **and** every interface's /24 directed broadcast (hotspots often forward only one of the two), plus a directed unicast beacon to every already-known peer. A broadcast beacon is answered with a direct unicast reply (`unicast: true`, never re-answered) — the `:33457 → :33457` reply passes the sender's stateful firewall as return traffic even where inbound broadcast is filtered. Peers on 1.0.5 and older ignore the `unicast` field and simply never reply. |
| Manual connect | Direct `ip:port` probe: TCP connect → handshake → read the peer card → hang up. |

Peers that stop announcing for 9 s are **verified before removal**: a bare TCP
connect (closed without sending a byte — the receiver logs nothing for these)
is attempted against their transfer port, and only peers that fail to answer
within 1.5 s are dropped (`morse://device-lost`). This keeps a peer on the
radar on networks where broadcast/multicast crosses in only one direction
(phone hotspots, guest Wi-Fi) while direct TCP still works.
Signal strength shown on the radar is derived from beacon latency; it places
the blip's radius (strong = close to the centre).

## 2. Framing

TCP, default port **33456**:

```
┌────────┬─────────┬─────────┬───────────────┬────────┐
│ "MLNK" │ seq u32 │ len u32 │ payload (len) │ CRC32  │
│  4 B   │  4 B BE │  4 B BE │     bytes     │ 4 B BE │
└────────┴─────────┴─────────┴───────────────┴────────┘
```

* `MAX_FRAME` = 1 MiB (4 × chunk size). Anything larger is rejected before allocation.
* CRC32 covers the payload as it appears on the wire (i.e. the sealed bytes).
* After the handshake, **every** payload is an AES-256-GCM sealed blob:
  `[8B counter BE][ciphertext][16B tag]`.

## 3. Handshake

```
initiator                                   responder
    │ frame 0: X25519 public key  ───────────▶│
    │ frame 1: Control::Hello{peer}  ────────▶│
    │◀─────────── frame 0: X25519 public key  │
    │◀──── frame 1: sealed Control::HelloAck  │
    │                                         │
    │ sealed Control::Offer{files, bytes} ───▶│  ┌ trusted fingerprint?
    │                                         │  ├ yes & not "large" → auto-accept
    │                                         │  └ otherwise → Accept/Reject modal
    │◀──────────── sealed Control::Decision   │
    │◀──────────── sealed Control::ResumeState│
```

Key schedule: `X25519(shared) → HKDF-SHA256(salt="morsecode/v1/salt",
info="morsecode/v1/session") → 32-byte AES-256-GCM key`.

Nonces are `[role tag][0,0,0][counter u64 BE]` with a separate counter per
direction; the receiver rejects counters that go backwards (replay protection).

## 4. Transfer

Per file:

```
Control::FileStart{file_id, offset}
  ↓ repeated
Control::Chunk{file_id, offset, len, compressed}   ← header frame
<sealed data frame>                                 ← ≤256 KiB payload
  ↑ receiver ACKs every 2 MiB
Control::Ack{file_id, offset}
  ↓
Control::FileDone{file_id, crc32}                   ← CRC32 of the *plaintext* file
Control::Ack{file_id, offset == size}               ← "it is on my disk"
```

* **Chunking** — 256 KiB reads straight from `tokio::fs::File`; a file is never
  fully resident in memory.
* **Pipelining** — a bounded `mpsc` channel `settings.concurrency` deep (default 8)
  lets reads + zstd compression + sealing run ahead of the socket.
* **Compression** — optional, applied only to compressible extensions and only
  kept when the compressed chunk is actually smaller (per-chunk flag).
* **Bandwidth limiter** — token-bucket throttle; 100 % disables it, lower values
  target that percentage of a 1 Gbps reference ceiling.
* **Broadcast** — one independent session (and one Tokio task) per target device,
  so the same file set streams to N peers in parallel.

## 5. Resume

* The receiver writes to `name.mcpart` in the download directory.
* `file_id` is content-derived: `SHA-256(name ‖ size ‖ first 1 MiB ‖ last 1 MiB)`,
  so "the same file" is recognised across reconnects without hashing gigabytes.
* On a new session the receiver reports `(file_id, bytes_on_disk)` pairs in
  `ResumeState`; the sender seeks to that offset.
* The sender still hashes the skipped prefix so the final CRC32 covers the whole
  file; the receiver re-hashes its partial file for the same reason.
* A CRC mismatch keeps the `.mcpart` file (so another resume can fix it) and
  records the transfer as `failed`.

## 6. Clipboard

A short-lived session that sends a single sealed `Control::Clipboard{text}`
frame and hangs up. Same handshake, same encryption, 256 KiB text cap.

## 7. Event channels (Rust → UI)

| Channel | Payload |
|---|---|
| `morse://device-upserted` / `morse://device-lost` | `Device` / `id` |
| `morse://transfer-updated` / `morse://transfer-removed` | `TransferItem` / `id` |
| `morse://consent-requested` / `morse://consent-resolved` | `ConsentRequest` / `id` |
| `morse://clipboard-received` | `ClipboardItem` |
| `morse://history-appended` | `HistoryEntry` |
| `morse://log` | `LogEvent` (drives the activity feed) |
| `morse://notify` | toast + native notification mirror |
| `morse://tray-action` | `"pause-all"` / `"resume-all"` |

Progress is emitted at most every 250 ms per transfer, which satisfies the
"speed readout updated at least every 500 ms" requirement with headroom.
