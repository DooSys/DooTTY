//! Explicit WSL operations. No shell command strings are accepted.
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(tag = "action", rename_all = "camelCase", deny_unknown_fields)]
pub enum WslAction {
    Update {},
    Restart {},
    Terminate {
        distribution: String,
    },
    SetDefault {
        distribution: String,
    },
    Export {
        distribution: String,
        path: String,
    },
    Import {
        name: String,
        path: String,
        location: String,
    },
    Install {
        name: String,
    },
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct CatalogueEntry {
    pub name: String,
    pub label: String,
}

/// The command emits localized prose followed by a two-column ASCII-name table.
pub fn parse_online_catalogue(text: &str) -> Result<Vec<CatalogueEntry>, String> {
    let mut entries = Vec::<CatalogueEntry>::new();
    for line in text.lines() {
        let line = line.trim().trim_start_matches('\u{feff}');
        let Some(end) = line.find(char::is_whitespace) else {
            continue;
        };
        let name = &line[..end];
        let remaining = &line[end..];
        if !(remaining.starts_with("  ") || remaining.starts_with('\t'))
            || name.len() > 256
            || name.starts_with('-')
            || !name
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b'.'))
            || ["NAME", "NOM", "NOMBRE", "NOME", "NAAM"].contains(&name)
            || entries.iter().any(|entry| entry.name == name)
        {
            continue;
        }
        let label = remaining.trim();
        if label.is_empty() || label.chars().any(char::is_control) {
            continue;
        }
        entries.push(CatalogueEntry {
            name: name.into(),
            label: label.into(),
        });
        if entries.len() > 512 {
            return Err("WSL catalogue exceeds 512 entries".into());
        }
    }
    if entries.is_empty() {
        return Err("WSL catalogue is empty or unrecognized".into());
    }
    Ok(entries)
}

/// Restart previously running distros; when none were running, start only the default.
pub fn restart_targets(
    running: &[String],
    installed: &[String],
    default: Option<&str>,
) -> Vec<String> {
    let mut targets = Vec::new();
    for distro in running {
        if installed.contains(distro) && !targets.contains(distro) {
            targets.push(distro.clone());
        }
    }
    if targets.is_empty() {
        if let Some(distro) = default
            .filter(|name| installed.iter().any(|d| d == name))
            .or_else(|| installed.first().map(String::as_str))
        {
            targets.push(distro.to_owned());
        }
    }
    targets
}

fn name(value: &str) -> Result<String, String> {
    if value.trim().is_empty()
        || value.starts_with('-')
        || value.len() > 256
        || value.chars().any(char::is_control)
    {
        return Err("Nom de distribution invalide.".into());
    }
    Ok(value.to_owned())
}

fn windows_path(value: &str) -> Result<String, String> {
    let bytes = value.as_bytes();
    let drive = bytes.len() > 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'\\' | b'/');
    // Local drive paths only: exclude devices, UNC shares and relative paths.
    if !drive
        || value.len() > 1024
        || value
            .chars()
            .any(|c| c.is_control() || matches!(c, '"' | '<' | '>' | '|' | '*' | '?'))
        || value[2..].contains(':')
        || value[3..].split(['\\', '/']).any(|part| {
            let stem = part.split('.').next().unwrap_or("").to_ascii_uppercase();
            part.is_empty()
                || part == "."
                || part == ".."
                || part.ends_with([' ', '.'])
                || ["CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$"].contains(&stem.as_str())
                || (stem.len() == 4
                    && (stem.starts_with("COM") || stem.starts_with("LPT"))
                    && matches!(stem.as_bytes()[3], b'1'..=b'9'))
        })
    {
        return Err(
            "Indiquez un chemin Windows absolu sur un disque local (ex. D:\\WSL\\Debian.tar)."
                .into(),
        );
    }
    Ok(value.to_owned())
}

impl WslAction {
    pub fn target(&self) -> Option<&str> {
        match self {
            Self::Terminate { distribution }
            | Self::SetDefault { distribution }
            | Self::Export { distribution, .. } => Some(distribution),
            _ => None,
        }
    }

    pub fn args(&self) -> Result<Vec<String>, String> {
        let args: Vec<String> = match self {
            Self::Update {} => vec!["--update".into(), "--web-download".into()],
            Self::Restart {} => vec!["--shutdown".into()],
            Self::Terminate { distribution } => vec!["--terminate".into(), name(distribution)?],
            Self::SetDefault { distribution } => vec!["--set-default".into(), name(distribution)?],
            Self::Export { distribution, path } => {
                vec!["--export".into(), name(distribution)?, windows_path(path)?]
            }
            Self::Import {
                name: distro,
                path,
                location,
            } => vec![
                "--import".into(),
                name(distro)?,
                windows_path(location)?,
                windows_path(path)?,
                "--version".into(),
                "2".into(),
            ],
            Self::Install { name: distro } => vec![
                "--install".into(),
                "--distribution".into(),
                name(distro)?,
                "--no-launch".into(),
            ],
        };
        Ok(args)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandResult {
    pub code: Option<i32>,
    pub success: bool,
}

/// WSL writes UTF-16LE to redirected pipes on some versions, UTF-8 on others.
pub fn decode_output(bytes: &[u8]) -> String {
    let utf16 = bytes.starts_with(&[0xff, 0xfe]) || bytes.contains(&0);
    if utf16 {
        let start = if bytes.starts_with(&[0xff, 0xfe]) {
            2
        } else {
            0
        };
        let words: Vec<u16> = bytes[start..]
            .chunks_exact(2)
            .map(|p| u16::from_le_bytes([p[0], p[1]]))
            .collect();
        String::from_utf16_lossy(&words)
    } else {
        String::from_utf8_lossy(bytes)
            .trim_start_matches('\u{feff}')
            .to_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn online_catalogue_parses_localized_tables_and_rejects_prose() {
        let text = "Les distributions suivantes sont disponibles.\nNOM                 NOM CONVIVIAL\nUbuntu-24.04        Ubuntu 24.04 LTS\nDebian              Debian GNU/Linux\nDebian              Debian GNU/Linux\n--bad               Invalid\n";
        let rows = parse_online_catalogue(text).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].name, "Ubuntu-24.04");
        assert_eq!(rows[1].label, "Debian GNU/Linux");
        assert!(parse_online_catalogue("Network unavailable\nNAME    FRIENDLY NAME").is_err());
        assert_eq!(
            parse_online_catalogue("NAME\tFRIENDLY NAME\nFedoraLinux-42\tFedora Linux 42").unwrap()
                [0]
            .name,
            "FedoraLinux-42"
        );
    }
    #[test]
    fn global_restart_preserves_the_running_set_and_uses_a_default_when_idle() {
        let installed = vec![
            "Debian".to_owned(),
            "Ubuntu".to_owned(),
            "Archive".to_owned(),
        ];
        assert_eq!(
            restart_targets(
                &["Ubuntu".into(), "Ubuntu".into(), "Missing".into()],
                &installed,
                Some("Debian")
            ),
            vec!["Ubuntu"]
        );
        assert_eq!(
            restart_targets(&[], &installed, Some("Ubuntu")),
            vec!["Ubuntu"]
        );
        assert!(restart_targets(&[], &[], None).is_empty());
        assert_eq!(WslAction::Restart {}.args().unwrap(), vec!["--shutdown"]);
    }
    #[test]
    fn stable_update_uses_the_same_github_source_as_the_version_check() {
        assert_eq!(
            WslAction::Update {}.args().unwrap(),
            ["--update", "--web-download"]
        );
    }

    #[test]
    fn rejects_unknown_actions_and_parameters() {
        for request in [
            r#"{"action":"unregister","distribution":"Debian"}"#,
            r#"{"action":"update","args":["--shutdown"]}"#,
        ] {
            assert!(serde_json::from_str::<WslAction>(request).is_err());
        }
    }

    #[test]
    fn arguments_preserve_spaces_without_shell_interpretation() {
        let action = WslAction::Export {
            distribution: "Debian test".into(),
            path: r"D:\My backups\Debian.tar".into(),
        };
        assert_eq!(
            action.args().unwrap(),
            ["--export", "Debian test", r"D:\My backups\Debian.tar"]
        );
        assert!(WslAction::Terminate {
            distribution: "--all".into()
        }
        .args()
        .is_err());
    }

    #[test]
    fn rejects_relative_device_and_traversal_paths() {
        for path in [
            r"backup.tar",
            r"D:backup.tar",
            r"\\.\PhysicalDrive0",
            r"D:\safe\..\other.tar",
            r"D:\file:stream",
            r"D:\NUL.tar",
            r"D:\COM1",
            r"D:\folder.\file.tar",
            r"D:\folder \file.tar",
        ] {
            assert!(windows_path(path).is_err(), "{path}");
        }
    }

    #[test]
    fn decodes_wsl_output_in_both_encodings() {
        let value = "Debian\r\nArrêtée";
        let utf16: Vec<u8> = value.encode_utf16().flat_map(u16::to_le_bytes).collect();
        assert_eq!(decode_output(&utf16), value);
        assert_eq!(decode_output(value.as_bytes()), value);
        assert_eq!(decode_output(&[0xff, 0xfe, b'A', 0]), "A");
        let non_latin = "测试发行版测试发行版\r\n";
        let encoded: Vec<u8> = non_latin
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect();
        assert_eq!(decode_output(&encoded), non_latin);
    }
}
