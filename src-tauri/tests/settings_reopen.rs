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
    config.wsl_settings_path = r"D:\Apps\WSL\wslsettings.exe".into();
    config
}

#[test]
fn settings_process() {
    let Ok(directory) = std::env::var("DOOTTY_PERSISTENCE_TEST_DIRECTORY") else {
        return;
    };
    let file = PathBuf::from(directory).join("config.json");
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
