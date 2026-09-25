//! LAN discovery.
//!
//! Primary:  mDNS service `_morsecode._tcp.local.` (Bonjour / Avahi compatible)
//! Fallback: UDP broadcast beacons on port 33457, for networks where multicast
//!           is filtered (common on enterprise Wi-Fi).
//!
//! Both paths only ever talk to the local subnet — there is no bootstrap
//! server, tracker or STUN/TURN anywhere in this file.

use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

use anyhow::Result;
use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use serde::{Deserialize, Serialize};
use socket2::{Domain, Protocol, Socket, Type};
use tokio::net::UdpSocket;

use crate::model::*;
use crate::state::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Beacon {
    id: String,
    name: String,
    platform: String,
    fingerprint: String,
    port: u16,
    ts: u64,
    /// True when this beacon was sent point-to-point (a reply or a directed
    /// keepalive). Unicast beacons are never answered, which prevents two
    /// peers from ping-ponging replies forever. Old versions simply ignore
    /// the field (serde skips unknown keys) and never reply at all.
    #[serde(default)]
    unicast: bool,
}

pub fn local_ip() -> String {
    local_ip_address::local_ip()
        .map(|ip| ip.to_string())
        .unwrap_or_else(|_| "127.0.0.1".to_string())
}

/// Wi-Fi vs Ethernet is a presentation detail; we infer it from the interface
/// name that owns the peer's subnet, falling back to Wi-Fi.
fn guess_link(_ip: &str) -> LinkType {
    match local_ip_address::list_afinet_netifas() {
        Ok(list) => {
            let wired = list.iter().any(|(name, _)| {
                let lower = name.to_lowercase();
                lower.starts_with("en") && !lower.starts_with("enx")
                    || lower.starts_with("eth")
                    || lower.contains("ethernet")
            });
            if wired {
                LinkType::Ethernet
            } else {
                LinkType::Wifi
            }
        }
        Err(_) => LinkType::Wifi,
    }
}

fn signal_from_latency(latency_ms: u64) -> u8 {
    let penalty = (latency_ms / 8).min(60) as u8;
    99u8.saturating_sub(penalty).max(20)
}

/// Starts (or restarts) both discovery transports. Safe to call repeatedly.
pub async fn start(state: Arc<AppState>) -> Result<()> {
    if state.discovery_running.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    let settings = state.settings_snapshot().await;

    if settings.mdns_enabled {
        let mdns_state = state.clone();
        tokio::spawn(async move {
            if let Err(err) = run_mdns(mdns_state.clone()).await {
                mdns_state.log(LogLevel::Error, "MDNS", format!("mDNS stopped: {err}"));
            }
        });
    }

    if settings.udp_fallback_enabled {
        let udp_state = state.clone();
        tokio::spawn(async move {
            if let Err(err) = run_udp(udp_state.clone()).await {
                udp_state.log(LogLevel::Error, "UDP", format!("broadcast stopped: {err}"));
            }
        });
    }

    // Expire peers that stopped announcing.
    let reaper = state.clone();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(3)).await;
            if !reaper.discovery_running.load(Ordering::SeqCst) {
                break;
            }
            let cutoff = now_ms().saturating_sub(9_000);
            let stale: Vec<(String, String, String, u16)> = reaper
                .devices
                .read()
                .await
                .values()
                .filter(|device| device.last_seen < cutoff)
                .map(|device| {
                    (
                        device.id.clone(),
                        device.name.clone(),
                        device.ip.clone(),
                        device.port,
                    )
                })
                .collect();
            for (id, name, ip, port) in stale {
                // Broadcast/multicast is filtered on plenty of networks
                // (phone hotspots, guest Wi-Fi, strict firewalls) while
                // direct TCP works fine — transfers prove it. So before
                // declaring a peer dead, knock on its transfer port; if it
                // answers, it is alive and only its announcements are being
                // eaten, so keep it on the radar.
                let alive = tokio::time::timeout(
                    Duration::from_millis(1500),
                    tokio::net::TcpStream::connect((ip.as_str(), port)),
                )
                .await
                .map(|res| res.is_ok())
                .unwrap_or(false);
                if alive {
                    let refreshed = {
                        let mut devices = reaper.devices.write().await;
                        devices.get_mut(&id).map(|device| {
                            device.last_seen = now_ms();
                            device.clone()
                        })
                    };
                    if let Some(device) = refreshed {
                        reaper.upsert_device(device).await;
                    }
                } else {
                    reaper.drop_device(&id).await;
                    reaper.log(
                        LogLevel::Warn,
                        "MDNS",
                        format!("peer {name} ({id}) unreachable — removed"),
                    );
                }
            }
        }
    });

    state.log(LogLevel::Ok, "MDNS", format!("browsing {SERVICE_TYPE}"));
    Ok(())
}

pub fn stop(state: &AppState) {
    state.discovery_running.store(false, Ordering::SeqCst);
    state.log(LogLevel::Warn, "MDNS", "discovery stopped");
}

async fn run_mdns(state: Arc<AppState>) -> Result<()> {
    let daemon = ServiceDaemon::new()?;
    let settings = state.settings_snapshot().await;
    let ip = local_ip();
    let host_name = format!("{}.local.", settings.device_name.replace(' ', "-"));

    let mut props: HashMap<String, String> = HashMap::new();
    props.insert("id".into(), state.identity.id.clone());
    props.insert("name".into(), settings.device_name.clone());
    props.insert("fp".into(), state.identity.fingerprint.clone());
    props.insert(
        "platform".into(),
        format!("{:?}", Platform::current()).to_lowercase(),
    );
    props.insert("v".into(), env!("CARGO_PKG_VERSION").into());

    let service = ServiceInfo::new(
        SERVICE_TYPE,
        &settings.device_name,
        &host_name,
        ip.as_str(),
        settings.transfer_port,
        Some(props),
    )?;

    daemon.register(service)?;
    state.log(
        LogLevel::Ok,
        "MDNS",
        format!("announced {} at {ip}:{}", settings.device_name, settings.transfer_port),
    );

    let receiver = daemon.browse(SERVICE_TYPE)?;
    while let Ok(event) = receiver.recv_async().await {
        if !state.discovery_running.load(Ordering::SeqCst) {
            let _ = daemon.shutdown();
            break;
        }
        match event {
            ServiceEvent::ServiceResolved(info) => {
                let props = info.get_properties();
                let peer_id = props
                    .get_property_val_str("id")
                    .unwrap_or_default()
                    .to_string();
                if peer_id.is_empty() || peer_id == state.identity.id {
                    continue; // ignore our own announcement
                }
                let addr = info
                    .get_addresses()
                    .iter()
                    .next()
                    .map(|ip| ip.to_string())
                    .unwrap_or_else(|| "0.0.0.0".into());

                let device = Device {
                    id: peer_id,
                    name: props
                        .get_property_val_str("name")
                        .unwrap_or_else(|| info.get_fullname())
                        .to_string(),
                    ip: addr.clone(),
                    port: info.get_port(),
                    platform: match props.get_property_val_str("platform").unwrap_or("linux") {
                        "windows" => Platform::Windows,
                        "macos" => Platform::Macos,
                        _ => Platform::Linux,
                    },
                    link: guess_link(&addr),
                    signal: signal_from_latency(12),
                    trusted: false, // set by upsert_device from the trusted store
                    fingerprint: props
                        .get_property_val_str("fp")
                        .unwrap_or("??")
                        .to_string(),
                    last_seen: now_ms(),
                };
                // mDNS resolves the same service once per interface/record,
                // so only log when the peer is new or moved.
                let newly_seen = match state.device(&device.id).await {
                    Some(known) => known.ip != device.ip || known.port != device.port,
                    None => true,
                };
                if newly_seen {
                    state.log(
                        LogLevel::Ok,
                        "MDNS",
                        format!("peer found — {} @ {}:{}", device.name, device.ip, device.port),
                    );
                }
                state.upsert_device(device).await;
            }
            ServiceEvent::ServiceRemoved(_, fullname) => {
                state.log(LogLevel::Warn, "MDNS", format!("peer left — {fullname}"));
            }
            _ => {}
        }
    }
    Ok(())
}

/// Everywhere a beacon should go: the limited broadcast plus the /24
/// directed broadcast of every local IPv4 interface. Hotspots and some APs
/// silently drop 255.255.255.255 but forward the subnet-directed form (the
/// /24 guess covers the overwhelming majority of home/hotspot LANs; on wider
/// subnets the limited broadcast still applies).
fn broadcast_dests() -> Vec<SocketAddr> {
    let mut dests = vec![SocketAddr::new(
        IpAddr::V4(Ipv4Addr::BROADCAST),
        DISCOVERY_PORT,
    )];
    if let Ok(list) = local_ip_address::list_afinet_netifas() {
        for (_, ip) in list {
            if let IpAddr::V4(v4) = ip {
                if v4.is_loopback() {
                    continue;
                }
                let o = v4.octets();
                let addr = SocketAddr::new(
                    IpAddr::V4(Ipv4Addr::new(o[0], o[1], o[2], 255)),
                    DISCOVERY_PORT,
                );
                if !dests.contains(&addr) {
                    dests.push(addr);
                }
            }
        }
    }
    dests
}

fn broadcast_socket() -> Result<std::net::UdpSocket> {
    let socket = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP))?;
    socket.set_reuse_address(true)?;
    #[cfg(unix)]
    socket.set_reuse_port(true)?;
    socket.set_broadcast(true)?;
    socket.set_nonblocking(true)?;
    let addr: SocketAddr = SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), DISCOVERY_PORT);
    socket.bind(&addr.into())?;
    Ok(socket.into())
}

async fn run_udp(state: Arc<AppState>) -> Result<()> {
    let socket = UdpSocket::from_std(broadcast_socket()?)?;
    let socket = Arc::new(socket);
    let settings = state.settings_snapshot().await;

    // Beacon sender.
    let tx_socket = socket.clone();
    let tx_state = state.clone();
    tokio::spawn(async move {
        let dest = SocketAddr::new(IpAddr::V4(Ipv4Addr::BROADCAST), DISCOVERY_PORT);
        loop {
            if !tx_state.discovery_running.load(Ordering::SeqCst) {
                break;
            }
            let settings = tx_state.settings_snapshot().await;
            let beacon = Beacon {
                id: tx_state.identity.id.clone(),
                name: settings.device_name.clone(),
                platform: format!("{:?}", Platform::current()).to_lowercase(),
                fingerprint: tx_state.identity.fingerprint.clone(),
                port: settings.transfer_port,
                ts: now_ms(),
                unicast: false,
            };
            if let Ok(payload) = serde_json::to_vec(&beacon) {
                let _ = tx_socket.send_to(&payload, dest).await;
                for extra in broadcast_dests() {
                    if extra != dest {
                        let _ = tx_socket.send_to(&payload, extra).await;
                    }
                }
            }
            // Also beacon every peer we already know point-to-point:
            // unicast survives networks that filter broadcast entirely, so
            // a peer discovered even once (mDNS, inbound transfer, manual
            // connect) keeps getting refreshed instead of timing out.
            let known: Vec<String> = tx_state
                .devices
                .read()
                .await
                .values()
                .map(|device| device.ip.clone())
                .collect();
            if !known.is_empty() {
                let direct = Beacon {
                    unicast: true,
                    ts: now_ms(),
                    ..beacon.clone()
                };
                if let Ok(payload) = serde_json::to_vec(&direct) {
                    for ip in known {
                        if let Ok(ip) = ip.parse::<IpAddr>() {
                            let _ = tx_socket
                                .send_to(&payload, SocketAddr::new(ip, DISCOVERY_PORT))
                                .await;
                        }
                    }
                }
            }
            tokio::time::sleep(Duration::from_millis(settings.scan_interval_ms.max(400))).await;
        }
    });

    state.log(
        LogLevel::Ok,
        "UDP",
        format!("broadcast beacon on :{DISCOVERY_PORT} every {}ms", settings.scan_interval_ms),
    );

    // Beacon receiver.
    let mut buf = vec![0u8; 2048];
    loop {
        if !state.discovery_running.load(Ordering::SeqCst) {
            break;
        }
        let (len, from) = match socket.recv_from(&mut buf).await {
            Ok(value) => value,
            Err(_) => continue,
        };
        let Ok(beacon) = serde_json::from_slice::<Beacon>(&buf[..len]) else {
            continue;
        };
        if beacon.id == state.identity.id {
            continue;
        }
        // Answer broadcast beacons with a direct unicast reply. The sender
        // just emitted a datagram from :33457, so its stateful firewall
        // accepts our :33457 → :33457 answer as return traffic even when it
        // filters inbound broadcast — this is what keeps the radar alive on
        // hotspot networks where broadcast only crosses in one direction.
        // Replies are flagged `unicast` and never answered themselves.
        if !beacon.unicast {
            let settings = state.settings_snapshot().await;
            let reply = Beacon {
                id: state.identity.id.clone(),
                name: settings.device_name.clone(),
                platform: format!("{:?}", Platform::current()).to_lowercase(),
                fingerprint: state.identity.fingerprint.clone(),
                port: settings.transfer_port,
                ts: now_ms(),
                unicast: true,
            };
            if let Ok(payload) = serde_json::to_vec(&reply) {
                let _ = socket
                    .send_to(&payload, SocketAddr::new(from.ip(), DISCOVERY_PORT))
                    .await;
            }
        }
        let latency = now_ms().saturating_sub(beacon.ts);
        let ip = from.ip().to_string();
        let device = Device {
            id: beacon.id,
            name: beacon.name,
            ip: ip.clone(),
            port: beacon.port,
            platform: match beacon.platform.as_str() {
                "windows" => Platform::Windows,
                "macos" => Platform::Macos,
                _ => Platform::Linux,
            },
            link: guess_link(&ip),
            signal: signal_from_latency(latency),
            trusted: false,
            fingerprint: beacon.fingerprint,
            last_seen: now_ms(),
        };
        state.upsert_device(device).await;
    }
    Ok(())
}

/// Manual connect: probe `ip:port` and register the peer if it answers a
/// handshake. Used when multicast/broadcast are both blocked.
pub async fn probe(state: Arc<AppState>, ip: String, port: u16) -> Result<Device> {
    let peer = crate::transfer::probe_peer(state.clone(), &ip, port).await?;
    let device = Device {
        id: peer.id.clone(),
        name: peer.name.clone(),
        ip: ip.clone(),
        port,
        platform: match peer.platform.as_str() {
            "windows" => Platform::Windows,
            "macos" => Platform::Macos,
            _ => Platform::Linux,
        },
        link: guess_link(&ip),
        signal: 80,
        trusted: false,
        fingerprint: peer.fingerprint.clone(),
        last_seen: now_ms(),
    };
    state.upsert_device(device.clone()).await;
    state.log(
        LogLevel::Ok,
        "NET",
        format!("manual connect ok — {} @ {ip}:{port}", device.name),
    );
    Ok(device)
}
