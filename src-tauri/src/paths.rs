//! Build an Explorer UNC path from a resolved Linux profile directory.
pub fn profile_folder(distribution: &str, directory: &str) -> Result<String, String> {
    let invalid = |s: &str| {
        s.chars()
            .any(|c| c.is_control() || matches!(c, '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
    };
    if distribution.is_empty()
        || distribution.contains('/')
        || invalid(distribution)
        || matches!(distribution, "." | "..")
        || directory.len() > 4096
        || !directory.starts_with('/')
        || invalid(directory)
        || directory.split('/').any(|p| matches!(p, "." | ".."))
    {
        return Err("Profile directory cannot be opened in Windows Explorer".into());
    }
    Ok(format!(
        r"\\wsl.localhost\{}{}",
        distribution,
        directory.replace('/', r"\")
    ))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn keeps_the_resolved_home_or_custom_directory_without_guessing_a_username() {
        assert_eq!(
            profile_folder("Debian", "/home/developer").unwrap(),
            r"\\wsl.localhost\Debian\home\developer"
        );
        assert_eq!(
            profile_folder("Ubuntu", "/srv/my projects").unwrap(),
            r"\\wsl.localhost\Ubuntu\srv\my projects"
        );
        assert_eq!(
            profile_folder("Debian", "/root").unwrap(),
            r"\\wsl.localhost\Debian\root"
        );
        for path in ["~", "/a/../b", "/tmp\nother", "/a\\b", "/a:b"] {
            assert!(profile_folder("Debian", path).is_err());
        }
        assert!(profile_folder("../other", "/home").is_err());
    }
}
