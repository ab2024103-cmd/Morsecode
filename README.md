<div align="center">

<img src="src/assets/logo.png" alt="MorseCode" width="112" />

# MorseCode

**Local. Fast. No internet required.**

Peer-to-peer file transfer between computers on the same LAN — zero cloud, zero accounts, zero internet dependency.

Tauri v2 · Rust · React 18 + TypeScript · Zustand · AES-256-GCM

</div>

---

## What this is

MorseCode is a cross-platform desktop app that moves files directly between machines on the same network. Peers find each other over mDNS (with a UDP broadcast fallback), every byte is encrypted with a per-session AES-256-GCM key derived from an X25519 handshake, and **every connection from an untrusted device is blocked behind an explicit Accept/Reject prompt** — no pairing codes, no QR codes, no silent transfers.

It ships in **two complete visual themes** (Classic and HUD) and **two colour modes** (Dark and Light) as *independent* toggles — four valid visual states, switchable live from the top-right of the window.

---

## Run it

### Browser preview (UI, all screens, mock backend)

```bash
npm install
npm run dev          # http://localhost:1420
```

Outside the Tauri shell the app talks to a **mock core** (`src/ipc/mock.ts`) that emits exactly the same events as Rust: peers appear on the radar, transfers stream with live speed, inbound requests raise the consent modal, clipboard replies arrive. Nothing about the UI branches on which backend is running.

### Desktop app (real Rust core)

```bash
npm install
npm run tauri dev
```

Requires the Rust toolchain plus the usual Tauri v2 system dependencies (WebView2 on Windows, Xcode CLT on macOS, `libwebkit2gtk-4.1-dev` + `libgtk-3-dev` + `libayatana-appindicator3-dev` on Linux).

### Checks

```bash
npm run build        # tsc --noEmit + vite build
npm run smoke        # headless jsdom run: every screen, all 4 themes, consent flow, tray, clipboard, history
npm run icons        # regenerate the full icon set from src/assets/logo.svg
```

`npm run smoke` renders the real app in jsdom and drives it like a user (27 assertions); any React error or warning fails the run.

---

## Packaging

```bash
npm run tauri build                                       # current OS
npm run tauri build -- --target x86_64-pc-windows-msvc    # cross targets
```

| Platform | Artifacts |
|---|---|
| Windows | `.exe` (NSIS) + `.msi` (WiX) |
| macOS | `.app` + `.dmg` |
| Linux | `.AppImage` + `.deb` |

Configured in `src-tauri/tauri.conf.json` (`bundle.targets`). The release profile is size-tuned (`opt-level="z"`, LTO, `strip`, `panic=abort`); the web bundle is **760 KB** including locally-bundled fonts, so the installed footprint stays in the target range without an Electron/Node runtime.

**Code signing** (deferred, required for public distribution):
* Windows — Authenticode certificate for `.exe`/`.msi`, otherwise SmartScreen warns on first run.
* macOS — Apple Developer ID signing + notarization, otherwise Gatekeeper blocks the `.dmg`.

---

## The four visual states

```
Theme:  [ Classic ] [ HUD ]     ← skin
Mode:   [ Dark ]    [ Light ]   ← palette
```

Both live permanently in the titlebar, both persist to `localStorage` (`morsecode.theme`) and the app config, and both are restored on launch. `ThemeProvider` writes `data-theme` / `data-mode` on `<html>`; **all** styling is CSS custom properties resolved from those two attributes.

| | Classic | HUD |
|---|---|---|
| Shape | 8–26px rounded corners | `clip-path` notched hexagonal panels |
| Type | Inter, sentence case | JetBrains Mono, uppercase, wide tracking |
| Depth | layered soft shadows + inset highlights | glassmorphism blur, neon glow, corner brackets |
| Background | soft ember/sun radial glow | grid overlay + drifting blobs + scanlines |
| Radar | rounded glow blips | tactical readouts, sharp neon blips |
| Morse animation | rounded travelling dots/dashes | sharp clipped neon pulses |
| System log | optional collapsible panel | always-on ticker |

Information architecture and interaction logic are identical between themes — only the skin changes.

---

## Screens

| # | Screen | Notes |
|---|---|---|
| 1 | Discover | Radar visualisation, live device list, manual IP:port connect |
| 2 | Send / Broadcast | Drop zone, broadcast target bar, morse link animation, queue |
| 3 | Receive | Mirror of Send, inbound link + receive rules |
| 4 | Consent modal | Accept/Reject, device card, fingerprint, "trust this device" |
| 5 | History | Tabs (All/Sent/Received/Failed), search, CSV export |
| 6 | Clipboard Share | Compose + target picker, received feed with sender/timestamp |
| 7 | Trusted Devices | Trusted grid with revoke, promote discovered peers |
| 8 | Settings | Identity, network, appearance, transfer, security, system |
| 9 | System Log | Full-page activity feed (also a rail panel in both themes) |
| 10 | Tray menu | Open / Pause all / Resume / Quit (native menu in `tray.rs`, mirrored in-app) |
| 11 | Toasts | In-app stack, mirrored to native OS notifications |

All of them share one shell: **Titlebar → Sidebar → Main → Right rail** (session stats, bandwidth limiter, live queue, network readout, system log).

---

## Architecture

```
src/
├── themes/            ThemeProvider + base.css + classic/ + hud/   (design tokens)
├── components/        layout · discovery · transfer · consent · history ·
│                      clipboard · trusted · settings · log · toast · tray · shared
├── screens/           one file per screen, composed from components
├── store/             Zustand: theme, settings, devices, transfers,
│                      history, clipboard, log, toasts
├── ipc/               commands.ts (typed invoke wrappers) · events.ts · mock.ts
└── assets/            logo.svg (source of truth) + logo.png

src-tauri/src/
├── lib.rs             builder, plugins, window/tray lifecycle
├── commands.rs        the invoke surface (mirrors ipc/commands.ts 1:1)
├── state.rs           shared state + event channels
├── model.rs           serde types mirroring src/types.ts
├── protocol.rs        MLNK framing + control messages
├── crypto.rs          X25519 → HKDF-SHA256 → AES-256-GCM
├── discovery.rs       mDNS service + UDP broadcast beacons
├── transfer.rs        chunked send/receive, resume, throttle, consent gate
├── history.rs         SQLite (rusqlite, bundled)
├── trusted.rs         trusted-device JSON store (fingerprint-pinned)
├── clipboard.rs       clipboard relay over the same encrypted channel
└── tray.rs            tray icon, menu, activity indicator
```

Only `src/ipc/*` may import `@tauri-apps/*`; every component talks to the backend through typed wrappers, which is what makes the browser mock possible.

---

## Protocol

Full details in [`docs/PROTOCOL.md`](docs/PROTOCOL.md). In short:

* **Discovery** — mDNS `_morsecode._tcp.local.` (primary, ~1200 ms sweep) + UDP broadcast beacons on `33457` (fallback).
* **Framing** — `[4B "MLNK"][4B seq][4B len][payload][4B CRC32]` on TCP `33456`.
* **Handshake** — X25519 key exchange → receiver consent (skipped for trusted fingerprints) → HKDF-SHA256 → AES-256-GCM session key; every subsequent frame is sealed, with strictly increasing per-direction nonce counters (replay protection).
* **Transfer** — 256 KiB chunks streamed from disk (never fully buffered), optional zstd for compressible types, a prepared-chunk pipeline `settings.concurrency` deep, and a bandwidth throttle driven by the 1–100 % slider.
* **Resume** — the receiver writes to `name.mcpart` and ACKs the last byte on disk every 2 MiB; on reconnect it reports that offset per content-derived file id and the sender seeks to it. The CRC32 covers the whole file, including a resumed prefix.

---

## Security model

* AES-256-GCM on every byte; the toggle in Settings exists only to state that it cannot be turned off.
* X25519 ephemeral key pair **per session** — no long-term secret leaves the machine; the pinned identity fingerprint is what "trust" refers to.
* Consent modal for every untrusted device; trusted devices skip it **unless** the payload exceeds the "confirm large transfers" threshold (default 500 MB).
* Trust is pinned to the fingerprint, so a changed identity key re-triggers consent even if the device id matches.
* Unanswered consent prompts auto-reject after 120 s.
* Received files land as `.mcpart` and are only renamed after CRC32 verification; existing names are never overwritten (`report (1).pdf`).
* No HTTP client anywhere in the dependency graph, no telemetry, no update check — verify with a network monitor: the only traffic is LAN mDNS/UDP/TCP.

---

## Logo & icons

`src/assets/logo.svg` is the single source of truth. `npm run icons` renders `src/assets/logo.png` (1024 px) plus the complete platform set into `src-tauri/icons/`: 16/32/48/64/128/256/512/1024 PNG, `128x128@2x`, tray icons, Windows Store logos, multi-resolution `icon.ico` and `icon.icns`. The same asset is used for the sidebar mark, titlebar mark, radar centre, consent-modal avatar, window icon, dock/taskbar icon, tray icon and installer icon. (`npm run tauri icon src/assets/logo.png` produces the same set when the Tauri CLI is available.)

---

## Status against the acceptance criteria

| Criterion | Status |
|---|---|
| Both themes fully functional | ✅ every screen implemented in both skins |
| Dark/Light independent within each theme | ✅ 4 states verified by `npm run smoke` |
| Toggles visually separate, always accessible | ✅ titlebar (and mirrored in Settings → Appearance) |
| `logo.png` used everywhere | ✅ UI marks + full generated icon set |
| Zero-config discovery | ✅ mDNS + UDP fallback implemented in `discovery.rs` |
| Progress, resume, bandwidth limit | ✅ implemented in `transfer.rs` |
| Nothing leaves the LAN | ✅ no HTTP client in either dependency tree |
| Accept/Reject blocks untrusted devices | ✅ `transfer.rs::request_consent` + `ConsentModal` |
| Trusted devices skip the modal | ✅ fingerprint-pinned, large-transfer override |
| Clipboard + system log in both themes | ✅ |
| Under 15 MB installed | ◻︎ expected, not measured here — needs a real `tauri build` |
| Installers build on all three OSes | ◻︎ configured, not executed here |

**Build environment note:** this workspace has no Rust toolchain and no network access to `crates.io`, so `src-tauri/` could not be compiled or bundled here. The TypeScript side is fully type-checked, built and smoke-tested; the Rust side is complete, self-consistent source that expects a first `cargo`/`tauri build` on a machine with the toolchain (run `npm run tauri build` and address any crate-version drift in `Cargo.toml` if it appears).
