use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(default, deny_unknown_fields)]
pub struct Config {
    pub language: String,
    #[serde(rename = "monitoringEnabled")]
    pub monitoring_enabled: bool,
    pub distribution: String,
    pub username: Option<String>,
    pub directory: String,
    pub profiles: Vec<SavedProfile>,
    #[serde(rename = "defaultProfileId")]
    pub default_profile_id: Option<String>,
    pub appearance: Appearance,
    pub interaction: Interaction,
    #[serde(rename = "wslSettingsPath")]
    pub wsl_settings_path: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct LaunchProfile {
    pub distribution: String,
    pub username: Option<String>,
    pub directory: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct SavedProfile {
    pub id: String,
    pub name: String,
    pub distribution: String,
    pub username: Option<String>,
    pub directory: String,
}
impl SavedProfile {
    pub fn launch(&self) -> LaunchProfile {
        LaunchProfile {
            distribution: self.distribution.clone(),
            username: self.username.clone(),
            directory: self.directory.clone(),
        }
    }
}

impl LaunchProfile {
    pub fn validate(&self) -> Result<(), String> {
        for (name, value) in [
            ("distribution", self.distribution.as_str()),
            ("directory", self.directory.as_str()),
        ]
        .into_iter()
        .chain(self.username.as_deref().map(|value| ("username", value)))
        {
            if value.trim().is_empty()
                || value.len() > 1024
                || value.chars().any(char::is_control)
                || value.starts_with('-')
            {
                return Err(format!("Valeur invalide pour {name}."));
            }
        }
        Ok(())
    }

    pub fn args(&self) -> Vec<String> {
        let mut args = vec!["--distribution".into(), self.distribution.clone()];
        if let Some(username) = &self.username {
            args.extend(["--user".into(), username.clone()]);
        }
        args.extend(["--cd".into(), self.directory.clone()]);
        args
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
pub struct Appearance {
    pub ui_theme: String,
    pub font_family: String,
    pub font_size: u16,
    pub theme: String,
    pub cursor_style: String,
    pub cursor_blink: bool,
    pub scrollback: u32,
}
impl Default for Appearance {
    fn default() -> Self {
        Self {
            ui_theme: "dark".into(),
            font_family: "Cascadia Mono, Consolas, monospace".into(),
            font_size: 14,
            theme: "campbell".into(),
            cursor_style: "bar".into(),
            cursor_blink: true,
            scrollback: 10000,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
pub struct Interaction {
    pub copy_on_select: bool,
    pub right_click_paste: bool,
    pub trim_copy_whitespace: bool,
    pub trim_paste_whitespace: bool,
    pub trim_paste_newlines: bool,
    pub rectangular_selection: bool,
    pub warn_on_close: bool,
    pub warn_multiline_paste: bool,
}
impl Default for Interaction {
    fn default() -> Self {
        Self {
            copy_on_select: false,
            right_click_paste: false,
            trim_copy_whitespace: false,
            trim_paste_whitespace: false,
            trim_paste_newlines: false,
            rectangular_selection: false,
            warn_on_close: true,
            warn_multiline_paste: false,
        }
    }
}

impl Default for Config {
    fn default() -> Self {
        Self {
            language: "fr".into(),
            monitoring_enabled: true,
            distribution: "Debian".into(),
            username: None,
            directory: "~".into(),
            profiles: Vec::new(),
            default_profile_id: None,
            appearance: Appearance::default(),
            interaction: Interaction::default(),
            wsl_settings_path: r"C:\Program Files\WSL\wslsettings\wslsettings.exe".into(),
        }
    }
}

impl Config {
    pub fn read(path: &Path) -> Result<Self, String> {
        use std::io::Read;
        let config = match std::fs::File::open(path) {
            Ok(file) => {
                let mut bytes = Vec::new();
                file.take(65537)
                    .read_to_end(&mut bytes)
                    .map_err(|e| e.to_string())?;
                if bytes.len() > 65536 {
                    return Err("Le fichier de configuration dépasse 64 Kio.".into());
                }
                serde_json::from_slice::<Self>(&bytes)
                    .map_err(|e| format!("Configuration invalide ({}): {e}", path.display()))?
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Self::default(),
            Err(e) => return Err(format!("Lecture de {} impossible : {e}", path.display())),
        };
        config.validate()?;
        Ok(config)
    }

    pub fn validate(&self) -> Result<(), String> {
        LaunchProfile {
            distribution: self.distribution.clone(),
            username: self.username.clone(),
            directory: self.directory.clone(),
        }
        .validate()?;
        if self.profiles.len() > 32 {
            return Err("32 profils maximum.".into());
        }
        let mut ids = std::collections::HashSet::new();
        for profile in &self.profiles {
            if profile.id.is_empty()
                || profile.id.len() > 64
                || !profile
                    .id
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_'))
                || !ids.insert(&profile.id)
                || profile.name.trim().is_empty()
                || profile.name.chars().count() > 80
                || profile.name.chars().any(char::is_control)
            {
                return Err("Profil enregistré invalide.".into());
            }
            profile.launch().validate()?;
        }
        if self
            .default_profile_id
            .as_ref()
            .is_some_and(|id| !ids.contains(id))
        {
            return Err("Profil par défaut introuvable.".into());
        }
        if serde_json::to_vec_pretty(self)
            .map_err(|e| e.to_string())?
            .len()
            + 1
            > 65536
        {
            return Err("Le fichier de configuration dépasse 64 Kio.".into());
        }
        self.launch_profile().validate()?;
        // Allow community locales without requiring a native-code change.
        if self.language.is_empty()
            || self.language.len() > 35
            || self
                .language
                .split('-')
                .any(|part| part.is_empty() || !part.bytes().all(|c| c.is_ascii_alphanumeric()))
        {
            return Err("Code de langue invalide / Invalid language code.".into());
        }
        if !["dark", "light"].contains(&self.appearance.ui_theme.as_str())
            || self.appearance.font_family.trim().is_empty()
            || self.appearance.font_family.len() > 256
            || self.appearance.font_family.chars().any(char::is_control)
            || !(8..=32).contains(&self.appearance.font_size)
            || self.appearance.scrollback > 100000
            || ![
                "campbell",
                "oneHalfDark",
                "light",
                "darkPlus",
                "solarizedDark",
            ]
            .contains(&self.appearance.theme.as_str())
            || !["bar", "block", "underline"].contains(&self.appearance.cursor_style.as_str())
        {
            return Err("Réglages d’apparence invalides.".into());
        }
        let launcher = &self.wsl_settings_path;
        if launcher.len() > 1024
            || launcher.chars().any(char::is_control)
            || !launcher.to_ascii_lowercase().ends_with(".exe")
            || !(launcher.as_bytes().get(1) == Some(&b':')
                && launcher.as_bytes().get(2) == Some(&b'\\'))
        {
            return Err("Indiquez un chemin Windows absolu vers wslsettings.exe.".into());
        }
        Ok(())
    }

    /// Replace the app configuration only after the complete new file is durable.
    /// A failed write leaves the previous configuration intact.
    pub fn write(&self, path: &Path) -> Result<(), String> {
        use std::{
            io::Write,
            sync::atomic::{AtomicU64, Ordering},
        };
        static NEXT: AtomicU64 = AtomicU64::new(1);
        self.validate()?;
        let parent = path.parent().ok_or("Dossier de configuration invalide.")?;
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        let temporary = parent.join(format!(
            "config-{}-{}.tmp",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let result = (|| -> Result<(), String> {
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)
                .map_err(|e| e.to_string())?;
            file.write_all(&serde_json::to_vec_pretty(self).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
            file.write_all(b"\n").map_err(|e| e.to_string())?;
            file.sync_all().map_err(|e| e.to_string())?;
            drop(file);
            std::fs::rename(&temporary, path).map_err(|e| e.to_string())
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(&temporary);
        }
        result
    }

    pub fn launch_profile(&self) -> LaunchProfile {
        if let Some(profile) = self
            .profiles
            .iter()
            .find(|p| Some(&p.id) == self.default_profile_id.as_ref())
        {
            return profile.launch();
        }
        LaunchProfile {
            distribution: self.distribution.clone(),
            username: self.username.clone(),
            directory: self.directory.clone(),
        }
    }
}

pub fn validate_size(cols: u16, rows: u16) -> Result<(), String> {
    if !(2..=1000).contains(&cols) || !(1..=1000).contains(&rows) {
        return Err("Dimensions du terminal invalides.".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn language_migrates_and_round_trips_without_affecting_the_launch_profile() {
        let old: Config =
            serde_json::from_str(r#"{"distribution":"Debian","username":null,"directory":"~"}"#)
                .unwrap();
        assert_eq!(old.language, "fr");
        assert!(old.monitoring_enabled);
        let disabled: Config = serde_json::from_str(r#"{"monitoringEnabled":false}"#).unwrap();
        assert!(!disabled.monitoring_enabled);
        for locale in ["fr", "en", "pt-BR"] {
            let config = Config {
                language: locale.into(),
                ..old.clone()
            };
            config.validate().unwrap();
            let read: Config =
                serde_json::from_str(&serde_json::to_string(&config).unwrap()).unwrap();
            assert_eq!(read.language, locale);
            assert_eq!(read.launch_profile(), old.launch_profile());
        }
        for locale in ["", "en/../../file", "en\n", "-en", "en--US"] {
            assert!(Config {
                language: locale.into(),
                ..old.clone()
            }
            .validate()
            .is_err());
        }
    }
    #[test]
    fn preserves_default_user_and_launches_no_command() {
        assert_eq!(
            Config::default().launch_profile().args(),
            ["--distribution", "Debian", "--cd", "~"]
        );
    }
    #[test]
    fn arguments_remain_separate_without_a_shell() {
        let config = Config {
            distribution: "Debian Dev".into(),
            username: Some("developer".into()),
            directory: "/home/developer/a project".into(),
            ..Config::default()
        };
        assert!(config.validate().is_ok());
        assert_eq!(
            config.launch_profile().args(),
            [
                "--distribution",
                "Debian Dev",
                "--user",
                "developer",
                "--cd",
                "/home/developer/a project"
            ]
        );
    }
    #[test]
    fn rejects_switches_and_control_characters() {
        for distribution in ["--unregister", "", "Debian\n"] {
            assert!(Config {
                distribution: distribution.into(),
                ..Config::default()
            }
            .validate()
            .is_err());
        }
        assert!(validate_size(0, 24).is_err());
        assert!(validate_size(80, 24).is_ok());
    }

    #[test]
    fn oversized_config_is_rejected_before_deserialization() {
        let path =
            std::env::temp_dir().join(format!("dootty-big-config-{}.json", std::process::id()));
        std::fs::write(&path, vec![b' '; 65537]).unwrap();
        assert!(Config::read(&path).unwrap_err().contains("64 Kio"));
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn interface_theme_migrates_and_rejects_unknown_modes() {
        let mut value = serde_json::to_value(Config::default()).unwrap();
        value["appearance"]
            .as_object_mut()
            .unwrap()
            .remove("uiTheme");
        let old: Config = serde_json::from_value(value).unwrap();
        assert_eq!(old.appearance.ui_theme, "dark");
        let mut changed = old;
        changed.appearance.ui_theme = "light".into();
        assert!(changed.validate().is_ok());
        changed.appearance.ui_theme = "unknown".into();
        assert!(changed.validate().is_err());
    }
    #[test]
    fn old_configuration_gets_new_defaults() {
        let config: Config = serde_json::from_str(
            r#"{"distribution":"Debian","username":"developer","directory":"~"}"#,
        )
        .unwrap();
        assert_eq!(config.appearance.font_size, 14);
        assert_eq!(config.username.as_deref(), Some("developer"));
        assert!(config.validate().is_ok());
    }
    #[test]
    fn old_interaction_settings_keep_clipboard_defaults_and_enable_close_warning() {
        let config: Config =
            serde_json::from_str(r#"{"interaction":{"copyOnSelect":true,"rightClickPaste":true}}"#)
                .unwrap();
        assert!(config.interaction.copy_on_select);
        assert!(config.interaction.right_click_paste);
        assert!(config.interaction.warn_on_close);
        assert!(!config.interaction.trim_copy_whitespace);
        assert!(!config.interaction.trim_paste_whitespace);
        assert!(!config.interaction.trim_paste_newlines);
        assert!(!config.interaction.rectangular_selection);
        let mut changed = config.clone();
        changed.interaction.trim_copy_whitespace = true;
        changed.interaction.trim_paste_whitespace = true;
        changed.interaction.trim_paste_newlines = true;
        changed.interaction.rectangular_selection = true;
        changed.interaction.warn_on_close = false;
        let read: Config = serde_json::from_str(&serde_json::to_string(&changed).unwrap()).unwrap();
        assert_eq!(read, changed);
        assert_eq!(read.launch_profile(), config.launch_profile());
    }

    #[test]
    fn per_tab_profile_is_validated_and_uses_separate_wsl_arguments() {
        let profile = LaunchProfile {
            distribution: "Ubuntu Dev".into(),
            username: None,
            directory: "~".into(),
        };
        assert!(profile.validate().is_ok());
        assert_eq!(
            profile.args(),
            ["--distribution", "Ubuntu Dev", "--cd", "~"]
        );
        assert!(LaunchProfile {
            distribution: "--shutdown".into(),
            ..profile
        }
        .validate()
        .is_err());
    }

    #[test]
    fn settings_replace_previous_file_and_invalid_settings_preserve_it() {
        let root = std::env::temp_dir().join(format!(
            "dootty-settings-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let path = root.join("config.json");
        let mut config = Config::default();
        config.write(&path).unwrap();
        config.appearance.font_size = 18;
        config.write(&path).unwrap();
        assert_eq!(Config::read(&path).unwrap(), config);
        config.appearance.font_size = 1;
        assert!(config.write(&path).is_err());
        assert_eq!(Config::read(&path).unwrap().appearance.font_size, 18);
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[cfg(test)]
mod saved_profile_tests {
    use super::*;
    fn profile() -> SavedProfile {
        SavedProfile {
            id: "work".into(),
            name: "Work".into(),
            distribution: "Debian".into(),
            username: Some("developer".into()),
            directory: "/home/developer/work".into(),
        }
    }
    #[test]
    fn old_config_migrates_and_selected_profile_supplies_separate_arguments() {
        let mut config: Config = serde_json::from_str("{}").unwrap();
        assert!(config.profiles.is_empty());
        assert_eq!(config.default_profile_id, None);
        assert!(!config.interaction.warn_multiline_paste);
        config.profiles.push(profile());
        config.default_profile_id = Some("work".into());
        config.validate().unwrap();
        assert_eq!(
            config.launch_profile().args(),
            [
                "--distribution",
                "Debian",
                "--user",
                "developer",
                "--cd",
                "/home/developer/work"
            ]
        );
        let restored: Config =
            serde_json::from_slice(&serde_json::to_vec(&config).unwrap()).unwrap();
        assert_eq!(restored, config);
    }
    #[test]
    fn rejects_duplicate_ids_missing_defaults_and_oversized_serialized_configs() {
        let mut config = Config::default();
        config.default_profile_id = Some("missing".into());
        assert!(config.validate().is_err());
        config.default_profile_id = None;
        config.profiles = vec![profile(), profile()];
        assert!(config.validate().is_err());
        config.profiles = (0..32)
            .map(|i| SavedProfile {
                id: format!("p{i}"),
                distribution: "d".repeat(1024),
                username: Some("u".repeat(1024)),
                directory: "/".repeat(1024),
                ..profile()
            })
            .collect();
        assert!(config.validate().unwrap_err().contains("64 Kio"));
    }
}
