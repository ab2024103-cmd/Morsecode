//! Startup diagnostics.
//!
//! A GUI subsystem binary on Windows has no console, so anything that goes
//! wrong before the window appears is invisible. Every startup stage is
//! therefore appended to a log file, panics are captured, and a hard failure
//! raises a native message box instead of vanishing.

use std::fmt::Write as _;
use std::fs::OpenOptions;
use std::io::Write as _;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

static LOG_PATH: OnceLock<PathBuf> = OnceLock::new();

/// `%LOCALAPPDATA%\com.morsecode.app\startup.log` on Windows,
/// `~/.local/share/com.morsecode.app/startup.log` on Linux,
/// `~/Library/Application Support/com.morsecode.app/startup.log` on macOS.
pub fn log_path() -> PathBuf {
    LOG_PATH
        .get_or_init(|| {
            let dir = dirs::data_local_dir()
                .or_else(dirs::config_dir)
                .unwrap_or_else(std::env::temp_dir)
                .join("com.morsecode.app");
            std::fs::create_dir_all(&dir).ok();
            dir.join("startup.log")
        })
        .clone()
}

fn stamp() -> String {
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let secs = (ms / 1000) as i64;
    let (h, m, s) = ((secs / 3600) % 24, (secs / 60) % 60, secs % 60);
    let mut out = String::new();
    let _ = write!(out, "{h:02}:{m:02}:{s:02}.{:03}", ms % 1000);
    out
}

/// Appends one line to the startup log (best effort — never panics).
pub fn log(stage: &str, detail: impl AsRef<str>) {
    let line = format!("{} [{}] {}\n", stamp(), stage, detail.as_ref());
    if let Ok(mut file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path())
    {
        let _ = file.write_all(line.as_bytes());
    }
    // Also useful when the app is started from a terminal / dev build.
    eprint!("{line}");
}

/// Starts a fresh section in the log and installs the panic hook.
pub fn init() {
    // Keep the log from growing without bound across launches.
    if std::fs::metadata(log_path()).map(|m| m.len()).unwrap_or(0) > 256 * 1024 {
        std::fs::remove_file(log_path()).ok();
    }
    log(
        "boot",
        format!(
            "MorseCode {} · {} {} · exe {:?}",
            env!("CARGO_PKG_VERSION"),
            std::env::consts::OS,
            std::env::consts::ARCH,
            std::env::current_exe().unwrap_or_default()
        ),
    );

    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let location = info
            .location()
            .map(|l| format!("{}:{}", l.file(), l.line()))
            .unwrap_or_else(|| "<unknown>".into());
        let message = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| (*s).to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "panic".into());
        log("panic", format!("{message} (at {location})"));
        previous(info);
    }));
}

/// Last-resort user-visible error: a native dialog, because there is no
/// console and the window may never have appeared.
pub fn fatal(title: &str, body: &str) {
    log("fatal", format!("{title}: {body}"));
    let body = format!("{body}\n\nDetails were written to:\n{}", log_path().display());

    #[cfg(windows)]
    {
        use std::iter::once;
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            MessageBoxW, MB_ICONERROR, MB_OK, MB_SYSTEMMODAL,
        };

        let wide = |s: &str| -> Vec<u16> {
            std::ffi::OsStr::new(s).encode_wide().chain(once(0)).collect()
        };
        unsafe {
            MessageBoxW(
                std::ptr::null_mut(),
                wide(&body).as_ptr(),
                wide(title).as_ptr(),
                MB_OK | MB_ICONERROR | MB_SYSTEMMODAL,
            );
        }
    }

    #[cfg(target_os = "macos")]
    {
        let script = format!(
            "display dialog {:?} with title {:?} buttons {{\"OK\"}} with icon stop",
            body, title
        );
        let _ = std::process::Command::new("osascript")
            .args(["-e", &script])
            .status();
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        for (bin, args) in [
            ("zenity", vec!["--error".to_string(), format!("--text={body}")]),
            ("kdialog", vec!["--error".to_string(), body.clone()]),
        ] {
            if std::process::Command::new(bin).args(&args).status().is_ok() {
                break;
            }
        }
    }
}

/// True when the platform webview is usable. On Windows this is the Edge
/// WebView2 runtime, which is the single most common reason a Tauri app dies
/// on launch without drawing a window.
pub fn webview_available() -> Result<String, String> {
    tauri::webview_version().map_err(|err| err.to_string())
}

/// Environment report for `MorseCode.exe --doctor`.
///
/// Answers the questions a remote debugging session would otherwise need a
/// dozen round trips for: is there a webview, is the config writable, are the
/// LAN ports free, which interfaces exist, what did the last launch do.
pub fn doctor_report() -> String {
    use std::fmt::Write as _;
    let mut out = String::new();

    let _ = writeln!(out, "MorseCode {} — diagnostics", env!("CARGO_PKG_VERSION"));
    let _ = writeln!(
        out,
        "platform   {} {}",
        std::env::consts::OS,
        std::env::consts::ARCH
    );
    let _ = writeln!(
        out,
        "executable {}",
        std::env::current_exe().unwrap_or_default().display()
    );

    match webview_available() {
        Ok(version) => {
            let _ = writeln!(out, "webview    OK (runtime {version})");
        }
        Err(err) => {
            let _ = writeln!(out, "webview    MISSING — {err}");
            let _ = writeln!(
                out,
                "           install the Microsoft Edge WebView2 runtime, or use the"
            );
            let _ = writeln!(out, "           offline-webview2 installer from the release page");
        }
    }

    let config_dir = dirs::config_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("com.morsecode.app");
    let writable = std::fs::create_dir_all(&config_dir)
        .and_then(|_| std::fs::write(config_dir.join(".probe"), b"ok"))
        .is_ok();
    std::fs::remove_file(config_dir.join(".probe")).ok();
    let _ = writeln!(
        out,
        "config     {} ({})",
        config_dir.display(),
        if writable { "writable" } else { "NOT WRITABLE" }
    );
    let _ = writeln!(
        out,
        "downloads  {}",
        dirs::download_dir().unwrap_or_default().display()
    );

    let tcp = std::net::TcpListener::bind(("0.0.0.0", crate::model::DEFAULT_TRANSFER_PORT));
    let _ = writeln!(
        out,
        "tcp {}   {}",
        crate::model::DEFAULT_TRANSFER_PORT,
        match tcp {
            Ok(_) => "free".to_string(),
            Err(err) => format!("IN USE / BLOCKED — {err}"),
        }
    );
    let udp = std::net::UdpSocket::bind(("0.0.0.0", crate::model::DISCOVERY_PORT));
    let _ = writeln!(
        out,
        "udp {}   {}",
        crate::model::DISCOVERY_PORT,
        match udp {
            Ok(_) => "free".to_string(),
            Err(err) => format!("IN USE / BLOCKED — {err}"),
        }
    );

    match local_ip_address::list_afinet_netifas() {
        Ok(list) => {
            for (name, ip) in list.iter().filter(|(_, ip)| ip.is_ipv4() && !ip.is_loopback()) {
                let _ = writeln!(out, "interface  {name} {ip}");
            }
        }
        Err(err) => {
            let _ = writeln!(out, "interface  enumeration failed: {err}");
        }
    }

    #[cfg(windows)]
    {
        let rule = std::process::Command::new("netsh")
            .args(["advfirewall", "firewall", "show", "rule", "name=MorseCode"])
            .output();
        let state = match rule {
            Ok(output) if output.status.success() => "present",
            Ok(_) => "NOT FOUND — allow MorseCode on the Private profile",
            Err(_) => "could not query netsh",
        };
        let _ = writeln!(out, "firewall   rule \"MorseCode\" {state}");
    }

    let _ = writeln!(out, "log        {}", log_path().display());
    if let Ok(contents) = std::fs::read_to_string(log_path()) {
        let tail: Vec<&str> = contents.lines().rev().take(20).collect();
        let _ = writeln!(out, "\nlast log lines:");
        for line in tail.into_iter().rev() {
            let _ = writeln!(out, "  {line}");
        }
    }

    out
}

/// `--doctor`: write the report to the log, show it, and exit.
pub fn run_doctor() {
    let report = doctor_report();
    for line in report.lines() {
        log("doctor", line);
    }
    println!("{report}");

    #[cfg(windows)]
    {
        use std::iter::once;
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONINFORMATION, MB_OK};

        let wide = |s: &str| -> Vec<u16> {
            std::ffi::OsStr::new(s).encode_wide().chain(once(0)).collect()
        };
        unsafe {
            MessageBoxW(
                std::ptr::null_mut(),
                wide(&report).as_ptr(),
                wide("MorseCode diagnostics").as_ptr(),
                MB_OK | MB_ICONINFORMATION,
            );
        }
    }
}
