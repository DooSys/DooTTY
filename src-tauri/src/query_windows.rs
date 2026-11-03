//! Bounded, finite queries. Callers supply only fixed read-only command forms.
use std::{
    io::Read,
    os::windows::process::CommandExt,
    process::{Command, Stdio},
    time::{Duration, Instant},
};
pub fn query(args: &[String], timeout: Duration) -> Result<String, String> {
    let mut child = Command::new(super::wsl_path()?)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(0x08000000)
        .spawn()
        .map_err(|e| e.to_string())?;
    let mut stdout = child.stdout.take().ok_or("WSL output unavailable")?;
    let reader = std::thread::spawn(move || -> Result<Vec<u8>, String> {
        let mut bytes = Vec::new();
        (&mut stdout)
            .take(262145)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        std::io::copy(&mut stdout, &mut std::io::sink()).map_err(|e| e.to_string())?;
        Ok(bytes)
    });
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(25)),
            result => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(match result {
                    Err(e) => e.to_string(),
                    _ => "WSL query timed out".into(),
                });
            }
        }
    };
    let bytes = reader.join().map_err(|_| "WSL query reader failed")??;
    if bytes.len() > 262144 {
        return Err("WSL query output exceeds 256 KiB".into());
    }
    if !status.success() {
        return Err(format!("WSL query failed ({:?})", status.code()));
    }
    Ok(dootty::management::decode_output(&bytes))
}
