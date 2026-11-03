//! Parsing of read-only WSL/GitHub version information, independent of Windows I/O.
use serde::{Deserialize, Serialize};

pub fn version_parts(value: &str) -> Option<[u32; 4]> {
    let value = value.strip_prefix('v').unwrap_or(value);
    let parts: Vec<_> = value.split('.').collect();
    if !(3..=4).contains(&parts.len()) {
        return None;
    }
    let mut result = [0; 4];
    for (index, part) in parts.iter().enumerate() {
        if part.is_empty() || !part.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        result[index] = part.parse().ok()?;
    }
    Some(result)
}

pub fn installed_version(output: &str) -> Option<String> {
    // Do not accidentally compare the Linux kernel, WSLg or Windows version.
    let line = output.lines().find(|line| !line.trim().is_empty())?;
    if !line.to_ascii_uppercase().contains("WSL") {
        return None;
    }
    line.split(|c: char| !c.is_ascii_digit() && c != '.')
        .find(|candidate| version_parts(candidate).is_some())
        .map(str::to_owned)
}

pub fn release_url(tag: &str) -> Result<String, String> {
    version_parts(tag).ok_or("Invalid stable WSL release tag")?;
    Ok(format!(
        "https://github.com/microsoft/WSL/releases/tag/{tag}"
    ))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StableRelease {
    pub tag: String,
    pub version: String,
    pub published_at: Option<String>,
    pub url: String,
}

pub fn parse_release(bytes: &[u8]) -> Result<StableRelease, String> {
    #[derive(Deserialize)]
    struct Release {
        tag_name: String,
        draft: bool,
        prerelease: bool,
        published_at: Option<String>,
    }
    let release: Release = serde_json::from_slice(bytes)
        .map_err(|e| format!("Invalid GitHub release response: {e}"))?;
    if release.draft || release.prerelease {
        return Err("The GitHub response is not a published stable release".into());
    }
    let url = release_url(&release.tag_name)?;
    Ok(StableRelease {
        version: release
            .tag_name
            .strip_prefix('v')
            .unwrap_or(&release.tag_name)
            .to_owned(),
        tag: release.tag_name,
        published_at: release.published_at,
        url,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_only_the_wsl_version_in_localized_output() {
        assert_eq!(
            installed_version("Version WSL : 2.6.1.0\r\nVersion du noyau : 6.6.87.2"),
            Some("2.6.1.0".into())
        );
        assert_eq!(
            installed_version("WSL version: 3.0.3.0\nKernel version: 6.18.54.1"),
            Some("3.0.3.0".into())
        );
        assert_eq!(
            installed_version("WSL 版本: 2.6.1.0"),
            Some("2.6.1.0".into())
        );
        assert_eq!(installed_version("Kernel version: 6.6.87.2"), None);
        assert_eq!(installed_version("Usage: wsl.exe [Argument]"), None);
    }
    #[test]
    fn accepts_stable_versions_and_normalizes_the_windows_revision() {
        assert_eq!(version_parts("v3.0.3"), version_parts("3.0.3.0"));
        assert!(version_parts("3.0.10").unwrap() > version_parts("3.0.9.0").unwrap());
        for tag in [
            "3.0.3-rc.1",
            "3.0",
            "3.0.3/../other",
            "3.0.3?x=1",
            "https://evil.test",
            "99999999999.0.0",
        ] {
            assert!(release_url(tag).is_err(), "{tag}");
        }
    }
    #[test]
    fn builds_the_notes_url_from_the_validated_tag() {
        let result = parse_release(br#"{"tag_name":"v3.0.3","draft":false,"prerelease":false,"published_at":"2026-10-09T18:21:40Z","html_url":"https://untrusted.example"}"#).unwrap();
        assert_eq!(result.version, "3.0.3");
        assert_eq!(
            result.url,
            "https://github.com/microsoft/WSL/releases/tag/v3.0.3"
        );
        assert!(parse_release(br#"{"tag_name":"3.1.0","draft":false,"prerelease":true}"#).is_err());
        assert!(parse_release(br#"{"tag_name":"3.1.0","draft":true,"prerelease":false}"#).is_err());
        assert!(parse_release(b"not JSON").is_err());
    }
}
