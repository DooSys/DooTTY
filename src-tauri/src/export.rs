//! Publish an export without overwriting a destination created during the command.
use std::{
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};
static NEXT: AtomicU64 = AtomicU64::new(1);

pub struct ExportReservation {
    pub temporary: PathBuf,
    target: PathBuf,
    keep: bool,
}
impl ExportReservation {
    pub fn new(target: &Path) -> Result<Self, String> {
        if target.exists() {
            return Err("Le fichier de sauvegarde existe déjà.".into());
        }
        let parent = target
            .parent()
            .filter(|parent| parent.is_dir())
            .ok_or("Dossier de sauvegarde introuvable.")?;
        for _ in 0..16 {
            let temporary = parent.join(format!(
                ".dootty-export-{}-{}.tar",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            match std::fs::OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&temporary)
            {
                Ok(_) => {
                    return Ok(Self {
                        temporary,
                        target: target.to_owned(),
                        keep: false,
                    })
                }
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(e.to_string()),
            }
        }
        Err("Impossible de réserver un fichier de sauvegarde temporaire.".into())
    }
    pub fn publish(&mut self) -> Result<(), String> {
        #[cfg(windows)]
        let result = {
            use std::os::windows::ffi::OsStrExt;
            let from: Vec<u16> = self
                .temporary
                .as_os_str()
                .encode_wide()
                .chain(Some(0))
                .collect();
            let to: Vec<u16> = self
                .target
                .as_os_str()
                .encode_wide()
                .chain(Some(0))
                .collect();
            // No REPLACE_EXISTING: the destination must still be unused.
            if unsafe {
                windows_sys::Win32::Storage::FileSystem::MoveFileExW(from.as_ptr(), to.as_ptr(), 8)
            } != 0
            {
                Ok(())
            } else {
                Err(std::io::Error::last_os_error())
            }
        };
        #[cfg(not(windows))]
        let result = std::fs::hard_link(&self.temporary, &self.target)
            .and_then(|()| std::fs::remove_file(&self.temporary));
        if let Err(error) = result {
            self.keep = true;
            return Err(format!(
                "Publication de la sauvegarde impossible : {error}. Export conservé dans {}",
                self.temporary.display()
            ));
        }
        Ok(())
    }
}
impl Drop for ExportReservation {
    fn drop(&mut self) {
        if !self.keep {
            let _ = std::fs::remove_file(&self.temporary);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn protects_a_destination_created_during_export_and_cleans_failed_work() {
        let root = std::env::temp_dir().join(format!(
            "dootty-export-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir(&root).unwrap();
        let target = root.join("backup.tar");
        let mut export = ExportReservation::new(&target).unwrap();
        std::fs::write(&export.temporary, "export data").unwrap();
        std::fs::write(&target, "existing data").unwrap();
        assert!(export.publish().is_err());
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "existing data");
        assert_eq!(
            std::fs::read_to_string(&export.temporary).unwrap(),
            "export data"
        );
        drop(export);
        std::fs::remove_file(&target).unwrap();
        let mut success = ExportReservation::new(&target).unwrap();
        std::fs::write(&success.temporary, "success").unwrap();
        success.publish().unwrap();
        drop(success);
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "success");
        let partial = ExportReservation::new(&root.join("partial.tar")).unwrap();
        let path = partial.temporary.clone();
        drop(partial);
        assert!(!path.exists());
        std::fs::remove_dir_all(root).unwrap();
    }
}
