//! Fixed, read-only Linux probe. No agent, dependency install or privilege change.
use serde::Serialize;

pub const PROBE: &str = include_str!("monitor.sh");

/// Check without starting a distro, then run the probe only while its session is usable.
pub fn collect(
    profile: &crate::config::LaunchProfile,
    ready: impl Fn() -> bool,
    mut query: impl FnMut(&[String], std::time::Duration) -> Result<String, String>,
) -> Result<Snapshot, String> {
    use std::time::Duration;
    if !ready() {
        return Err("Monitoring paused".into());
    }
    let running = query(
        &["--list".into(), "--running".into(), "--quiet".into()],
        Duration::from_secs(2),
    )?;
    if !running
        .lines()
        .any(|line| line.trim() == profile.distribution)
    {
        return Err("MONITOR_DISTRIBUTION_STOPPED".into());
    }
    if !ready() {
        return Err("Monitoring paused".into());
    }
    let mut args = vec!["--distribution".into(), profile.distribution.clone()];
    if let Some(user) = &profile.username {
        args.extend(["--user".into(), user.clone()]);
    }
    args.extend(["--exec".into(), "/bin/sh".into(), "-c".into(), PROBE.into()]);
    parse(&query(&args, Duration::from_secs(4))?)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub cpu_total: u64,
    pub cpu_idle: u64,
    pub memory_total: u64,
    pub memory_available: u64,
    pub swap_total: u64,
    pub swap_free: u64,
    pub uptime: f64,
    pub user: String,
    pub hostname: String,
    pub kernel: String,
    pub interface: Option<String>,
    pub received: Option<u64>,
    pub transmitted: Option<u64>,
    pub disk_read: Option<u64>,
    pub disk_written: Option<u64>,
    pub filesystems: Vec<Filesystem>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Filesystem {
    pub device: String,
    pub mount: String,
    pub total: u64,
    pub used: u64,
    pub available: u64,
}
pub fn parse(text: &str) -> Result<Snapshot, String> {
    if text.len() > 262144 {
        return Err("Monitoring output exceeds 256 KiB".into());
    }
    let mut sections = std::collections::HashMap::<&str, Vec<&str>>::new();
    let mut section = "";
    for line in text.lines() {
        if let Some(key) = line.strip_prefix("@") {
            section = key;
        } else {
            sections.entry(section).or_default().push(line);
        }
    }
    let content = |key| {
        sections
            .get(key)
            .map(|lines| lines.join("\n"))
            .unwrap_or_default()
    };
    let cpu = sections
        .get("stat")
        .and_then(|lines| lines.iter().find(|line| line.starts_with("cpu ")))
        .ok_or("CPU statistics unavailable")?;
    let ticks: Vec<u64> = cpu
        .split_whitespace()
        .skip(1)
        .take(8)
        .map(|n| n.parse::<u64>())
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;
    if ticks.len() < 4 {
        return Err("Incomplete CPU statistics".into());
    }
    // guest/guest_nice already count in user/nice; do not count them twice.
    let cpu_total = ticks
        .iter()
        .try_fold(0u64, |sum, value| sum.checked_add(*value))
        .ok_or("CPU counter overflow")?;
    let memory = |key: &str| -> u64 {
        sections
            .get("mem")
            .into_iter()
            .flatten()
            .find_map(|line| line.strip_prefix(key))
            .and_then(|s| s.split_whitespace().next())
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0)
            .saturating_mul(1024)
    };
    let memory_total = memory("MemTotal:");
    if memory_total == 0 {
        return Err("Memory statistics unavailable".into());
    }
    let memory_available = if memory("MemAvailable:") > 0 {
        memory("MemAvailable:")
    } else {
        memory("MemFree:")
            .saturating_add(memory("Buffers:"))
            .saturating_add(memory("Cached:"))
    }
    .min(memory_total);
    let interface = content("interface");
    let network = sections.get("net").into_iter().flatten().find_map(|line| {
        let (name, data) = line.split_once(':')?;
        if name.trim() != interface.trim() || interface.trim().is_empty() {
            return None;
        }
        let values: Vec<_> = data.split_whitespace().collect();
        Some((
            values.first()?.parse::<u64>().ok()?,
            values.get(8)?.parse::<u64>().ok()?,
        ))
    });
    let root = content("root");
    let disk = sections.get("disk").into_iter().flatten().find_map(|line| {
        let v: Vec<_> = line.split_whitespace().collect();
        if format!("{}:{}", v.first()?, v.get(1)?) != root.trim() {
            return None;
        }
        Some((
            v.get(5)?.parse::<u64>().ok()?.checked_mul(512)?,
            v.get(9)?.parse::<u64>().ok()?.checked_mul(512)?,
        ))
    });
    let filesystems = sections
        .get("df")
        .into_iter()
        .flatten()
        .filter_map(|line| {
            let v: Vec<_> = line.split_whitespace().collect();
            if v.len() < 6 || !v[0].starts_with('/') || !v[5].starts_with('/') {
                return None;
            }
            Some(Filesystem {
                device: v[0].into(),
                total: v[1].parse::<u64>().ok()?.checked_mul(1024)?,
                used: v[2].parse::<u64>().ok()?.checked_mul(1024)?,
                available: v[3].parse::<u64>().ok()?.checked_mul(1024)?,
                mount: v[5..].join(" "),
            })
        })
        .take(64)
        .collect();
    let uptime = content("uptime")
        .split_whitespace()
        .next()
        .and_then(|s| s.parse::<f64>().ok())
        .filter(|n| n.is_finite() && *n >= 0.0)
        .ok_or("Uptime unavailable")?;
    Ok(Snapshot {
        cpu_total,
        cpu_idle: ticks[3].saturating_add(*ticks.get(4).unwrap_or(&0)),
        memory_total,
        memory_available,
        swap_total: memory("SwapTotal:"),
        swap_free: memory("SwapFree:"),
        uptime,
        user: content("user"),
        hostname: content("host"),
        kernel: content("kernel"),
        interface: (!interface.trim().is_empty()).then(|| interface.trim().into()),
        received: network.map(|n| n.0),
        transmitted: network.map(|n| n.1),
        disk_read: disk.map(|n| n.0),
        disk_written: disk.map(|n| n.1),
        filesystems,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stopped_distribution_and_closing_session_never_launch_a_probe() {
        use crate::config::LaunchProfile;
        use std::cell::Cell;
        let profile = LaunchProfile {
            distribution: "Debian".into(),
            username: None,
            directory: "~".into(),
        };
        let count = Cell::new(0);
        let result = collect(
            &profile,
            || true,
            |args, _| {
                count.set(count.get() + 1);
                assert_eq!(args, &["--list", "--running", "--quiet"]);
                Ok("Ubuntu\nDebian-test\n".into())
            },
        );
        assert_eq!(result.unwrap_err(), "MONITOR_DISTRIBUTION_STOPPED");
        assert_eq!(count.get(), 1);
        let ready = Cell::new(true);
        let result = collect(
            &profile,
            || ready.get(),
            |args, _| {
                assert_eq!(args, &["--list", "--running", "--quiet"]);
                ready.set(false);
                Ok("Debian\n".into())
            },
        );
        assert_eq!(result.unwrap_err(), "Monitoring paused");
        assert!(collect(
            &profile,
            || false,
            |_, _| panic!("A stopped session must not query WSL")
        )
        .is_err());
    }
    #[cfg(target_os = "linux")]
    #[test]
    fn fixed_probe_runs_without_installing_an_agent() {
        let output = std::process::Command::new("/bin/sh")
            .args(["-c", PROBE])
            .output()
            .unwrap();
        assert!(output.status.success());
        let snapshot = parse(std::str::from_utf8(&output.stdout).unwrap()).unwrap();
        assert!(snapshot.memory_total > 0);
        assert!(!snapshot.user.is_empty());
    }
    #[test]
    fn parses_scope_counters_and_filesystems_without_double_counting_guest() {
        let probe = "@stat\ncpu 10 2 3 80 5 0 0 0 7 1\n@mem\nMemTotal: 1000 kB\nMemAvailable: 600 kB\n@uptime\n10.5 8\n@user\nuser\n@interface\neth0\n@net\neth0: 100 0 0 0 0 0 0 0 200 0\n@root\n8:32\n@disk\n8 32 sdc 1 0 4 0 2 0 6 0\n@df\nFilesystem 1024-blocks Used Available Capacity Mounted on\n/dev/sdc 100 25 70 26% /\n/dev/sdd 200 50 140 26% /a b\n";
        let s = parse(probe).unwrap();
        assert_eq!(s.cpu_total, 100);
        assert_eq!(s.cpu_idle, 85);
        assert_eq!(s.memory_available, 614400);
        assert_eq!(s.received, Some(100));
        assert_eq!(s.disk_read, Some(2048));
        assert_eq!(s.disk_written, Some(3072));
        assert_eq!(s.filesystems[1].mount, "/a b");
        assert_eq!(s.filesystems[0].available, 71680);
    }
    #[test]
    fn missing_optional_counters_stay_unavailable_and_invalid_snapshots_fail() {
        let s = parse("@stat\ncpu 1 0 0 4\n@mem\nMemTotal: 10 kB\nMemFree: 5 kB\n@uptime\n3\n")
            .unwrap();
        assert_eq!(s.received, None);
        assert_eq!(s.disk_read, None);
        assert_eq!(s.memory_available, 5120);
        assert!(parse("").is_err());
        assert!(parse(&"x".repeat(262145)).is_err());
    }
}
