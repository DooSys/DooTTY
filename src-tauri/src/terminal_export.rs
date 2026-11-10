//! Atomic text export, only to the .txt path chosen in the native Save dialog.
use std::{
    io::Write,
    path::Path,
    sync::atomic::{AtomicU64, Ordering},
};
pub const MAX_BYTES: usize = 8 * 1024 * 1024;
static NEXT: AtomicU64 = AtomicU64::new(1);

pub fn write_text(path: &Path, text: &str) -> Result<(), String> {
    if text.len() > MAX_BYTES
        || !path.is_absolute()
        || !path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("txt"))
    {
        return Err("Export texte invalide (8 Mio maximum, fichier .txt).".into());
    }
    let parent = path.parent().ok_or("Dossier introuvable")?;
    for _ in 0..16 {
        let temp = parent.join(format!(
            ".dootty-text-{}-{}.tmp",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let mut file = match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
        {
            Ok(file) => file,
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.to_string()),
        };
        let result = (|| {
            file.write_all(text.as_bytes())?;
            file.sync_all()?;
            drop(file);
            std::fs::rename(&temp, path)
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(&temp);
        }
        return result.map_err(|e: std::io::Error| e.to_string());
    }
    Err("Impossible de réserver un fichier temporaire.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn text_replacement_is_complete_and_rejects_other_file_types() {
        let root = std::env::temp_dir().join(format!(
            "dootty-text-test-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("terminal.txt");
        std::fs::write(&path, "old").unwrap();
        write_text(&path, "été\nnew output\n").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "été\nnew output\n");
        let other = root.join("config.json");
        std::fs::write(&other, "original").unwrap();
        assert!(write_text(&other, "replacement").is_err());
        assert_eq!(std::fs::read_to_string(&other).unwrap(), "original");
        let directory = root.join("folder.txt");
        std::fs::create_dir(&directory).unwrap();
        assert!(write_text(&directory, "fail").is_err());
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 3);
        std::fs::remove_dir_all(root).unwrap();
    }
}
