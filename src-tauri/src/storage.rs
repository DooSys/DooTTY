//! Storage mode is explicit: a portable marker never falls back to the Windows profile.
use std::path::{Path, PathBuf};
pub const PORTABLE_MARKER: &str = "DooTTY.portable";
#[derive(Clone, Debug, PartialEq)]
pub struct Layout {
    pub portable: bool,
    pub config: PathBuf,
    pub webview: PathBuf,
}
impl Layout {
    pub fn resolve(
        executable: &Path,
        roaming: Option<&Path>,
        local: Option<&Path>,
    ) -> Result<Self, String> {
        let directory = executable
            .parent()
            .ok_or("Application directory unavailable")?;
        if directory.join(PORTABLE_MARKER).is_file() {
            let data = directory.join("data");
            return Ok(Self {
                portable: true,
                config: data.join("config.json"),
                webview: data.join("webview2"),
            });
        }
        Ok(Self {
            portable: false,
            config: roaming
                .ok_or("APPDATA unavailable")?
                .join("DooTTY/config.json"),
            webview: local
                .ok_or("LOCALAPPDATA unavailable")?
                .join("com.doosys.dootty"),
        })
    }
    pub fn prepare(&self) -> Result<(), String> {
        let root = self
            .config
            .parent()
            .ok_or("Configuration directory unavailable")?;
        std::fs::create_dir_all(root)
            .map_err(|e| format!("Cannot create {}: {e}", root.display()))?;
        std::fs::create_dir_all(&self.webview)
            .map_err(|e| format!("Cannot create {}: {e}", self.webview.display()))?;
        let probe = root.join(format!(".write-check-{}", std::process::id()));
        let file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&probe)
            .map_err(|e| {
                format!(
                    "The DooTTY data directory is not writable ({}): {e}",
                    root.display()
                )
            })?;
        drop(file);
        std::fs::remove_file(probe).map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn instance_key(&self) -> String {
        // Stable across versions/toolchains; Windows paths compare without letter case.
        let path = std::fs::canonicalize(self.config.parent().unwrap())
            .unwrap_or_else(|_| self.config.parent().unwrap().to_owned());
        let path = path
            .to_string_lossy()
            .trim_start_matches(r"\\?\")
            .replace('/', "\\")
            .to_lowercase();
        let hash = path.bytes().fold(0xcbf29ce484222325u64, |hash, byte| {
            (hash ^ u64::from(byte)).wrapping_mul(0x100000001b3)
        });
        format!("Local\\DooSys.DooTTY.{hash:016x}")
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn installed_mode_keeps_the_existing_config_location() {
        let root = std::env::temp_dir();
        let l = Layout::resolve(
            &root.join("DooTTY.exe"),
            Some(Path::new("roaming")),
            Some(Path::new("local")),
        )
        .unwrap();
        assert!(!l.portable);
        assert_eq!(l.config, Path::new("roaming/DooTTY/config.json"));
    }
    #[test]
    fn portable_data_is_isolated_and_does_not_require_windows_profile_variables() {
        let root = std::env::temp_dir().join(format!("dootty-portable-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join(PORTABLE_MARKER), b"1").unwrap();
        let l = Layout::resolve(&root.join("DooTTY.exe"), None, None).unwrap();
        l.prepare().unwrap();
        assert!(l.portable);
        assert_eq!(l.config, root.join("data/config.json"));
        assert_eq!(l.webview, root.join("data/webview2"));
        let mut config = crate::config::Config::default();
        config.language = "en".into();
        config.write(&l.config).unwrap();
        let reopened = Layout::resolve(
            &root.join("DooTTY.exe"),
            Some(Path::new("other")),
            Some(Path::new("other")),
        )
        .unwrap();
        assert_eq!(
            crate::config::Config::read(&reopened.config).unwrap(),
            config
        );
        assert_eq!(l.instance_key(), reopened.instance_key());
        std::fs::remove_dir_all(root).unwrap();
    }
}
