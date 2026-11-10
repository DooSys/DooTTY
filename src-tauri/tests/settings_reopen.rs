//! Exercise actual filesystem persistence across separate processes, without WSL.
use dootty::config::Config;
use std::{path::PathBuf, process::Command};

fn customized() -> Config {
    let mut config = Config::default();
    config.language = "en".into();
    config.monitoring_enabled = false;
    config.distribution = "Ubuntu Test".into();
    config.username = Some("developer".into());
    config.directory = "/home/developer/my workspace".into();
    config.appearance.ui_theme = "light".into();
    config.appearance.font_family = "JetBrains Mono, monospace".into();
    config.appearance.font_size = 18;
    config.appearance.theme = "solarizedDark".into();
    config.appearance.cursor_style = "block".into();
    config.appearance.cursor_blink = false;
    config.appearance.scrollback = 24000;
    config.interaction.copy_on_select = true;
    config.interaction.right_click_paste = true;
    config.interaction.trim_copy_whitespace = true;
    config.interaction.trim_paste_whitespace = true;
    config.interaction.trim_paste_newlines = true;
    config.interaction.rectangular_selection = true;
    config.interaction.warn_on_close = false;
    config.interaction.warn_multiline_paste = true;
    config.profiles.push(dootty::config::SavedProfile {
        id: "work".into(),
        name: "Work".into(),
        distribution: "Debian".into(),
        username: Some("developer".into()),
        directory: "/home/developer/work".into(),
    });
    config.default_profile_id = Some("work".into());
    config.wsl_settings_path = r"D:\Apps\WSL\wslsettings.exe".into();
    config
}

#[test]
fn settings_process() {
    let Ok(directory) = std::env::var("DOOTTY_PERSISTENCE_TEST_DIRECTORY") else {
        return;
    };
    let root = PathBuf::from(directory);
    let file = if std::env::var_os("DOOTTY_TEST_PORTABLE").is_some() {
        let layout =
            dootty::storage::Layout::resolve(&root.join("DooTTY.exe"), None, None).unwrap();
        assert!(layout.portable);
        layout.prepare().unwrap();
        layout.config
    } else {
        root.join("config.json")
    };
    match std::env::var("DOOTTY_PERSISTENCE_TEST_MODE")
        .unwrap()
        .as_str()
    {
        "save" => {
            Config::default().write(&file).unwrap();
            customized().write(&file).unwrap();
        }
        "reopen" => assert_eq!(Config::read(&file).unwrap(), customized()),
        _ => panic!("Unknown persistence test mode"),
    }
}

#[test]
fn reopening_a_fresh_process_restores_every_saved_preference() {
    let directory = std::env::temp_dir().join(format!(
        "dootty-reopen-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir(&directory).unwrap();
    struct Cleanup(PathBuf);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    let _cleanup = Cleanup(directory.clone());
    let child = |mode| {
        let output = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "settings_process", "--nocapture"])
            .env("DOOTTY_PERSISTENCE_TEST_DIRECTORY", &directory)
            .env("DOOTTY_PERSISTENCE_TEST_MODE", mode)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "Child failed: {}",
            String::from_utf8_lossy(&output.stdout)
        );
    };
    child("save");
    let saved = std::fs::read(directory.join("config.json")).unwrap();
    child("reopen");
    child("reopen");
    assert_eq!(
        std::fs::read(directory.join("config.json")).unwrap(),
        saved,
        "Opening the app must not rewrite the settings"
    );
    assert_eq!(
        std::fs::read_dir(&directory).unwrap().count(),
        1,
        "No temporary configuration file left behind"
    );
}

#[test]
fn portable_reopening_preserves_settings_without_profile_directories() {
    let root = std::env::temp_dir().join(format!("dootty-portable-reopen-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join(dootty::storage::PORTABLE_MARKER), b"1").unwrap();
    for mode in ["save", "reopen", "reopen"] {
        let child = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "settings_process", "--nocapture"])
            .env("DOOTTY_PERSISTENCE_TEST_DIRECTORY", &root)
            .env("DOOTTY_PERSISTENCE_TEST_MODE", mode)
            .env("DOOTTY_TEST_PORTABLE", "1")
            .env_remove("APPDATA")
            .env_remove("LOCALAPPDATA")
            .output()
            .unwrap();
        assert!(
            child.status.success(),
            "{}",
            String::from_utf8_lossy(&child.stdout)
        );
    }
    assert!(!root.join("config.json").exists());
    assert!(root.join("data/config.json").is_file());
    assert!(root.join("data/webview2").is_dir());
    std::fs::remove_dir_all(root).unwrap();
}
