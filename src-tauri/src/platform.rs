use serde::Serialize;
use std::os::windows::{ffi::OsStrExt, process::CommandExt};
use std::{path::PathBuf, process::Command};
use winreg::{enums::HKEY_CURRENT_USER, RegKey};
pub static WSL_OPERATION_BUSY: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);
pub struct OperationGuard;
impl OperationGuard {
    pub fn acquire() -> Result<Self, String> {
        use std::sync::atomic::Ordering;
        let _lock = super::LIFECYCLE.lock().map_err(|e| e.to_string())?;
        if super::CLOSING.load(Ordering::Acquire) {
            return Err("DooTTY est en cours de fermeture.".into());
        }
        if WSL_OPERATION_BUSY.swap(true, Ordering::AcqRel) {
            return Err("Une opération WSL est déjà en cours dans DooTTY.".into());
        }
        Ok(Self)
    }
}
impl Drop for OperationGuard {
    fn drop(&mut self) {
        WSL_OPERATION_BUSY.store(false, std::sync::atomic::Ordering::Release);
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Distribution {
    name: String,
    version: Option<u32>,
    base_path: String,
    vhd_path: Option<String>,
    file_bytes: Option<u64>,
    is_default: bool,
}

fn expand_path(path: &str) -> String {
    let input: Vec<u16> = path.encode_utf16().chain(Some(0)).collect();
    let mut output = vec![0u16; 32768];
    let length = unsafe {
        windows_sys::Win32::System::Environment::ExpandEnvironmentStringsW(
            input.as_ptr(),
            output.as_mut_ptr(),
            output.len() as u32,
        )
    } as usize;
    let path = if length > 0 && length <= output.len() {
        String::from_utf16_lossy(&output[..length - 1])
    } else {
        path.to_owned()
    };
    if let Some(unc) = path.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{unc}")
    } else {
        path.strip_prefix(r"\\?\")
            .or_else(|| path.strip_prefix(r"\??\"))
            .unwrap_or(&path)
            .to_owned()
    }
}

fn distributions() -> Result<Vec<Distribution>, String> {
    let root = match RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Lxss")
    {
        Ok(root) => root,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(e) => return Err(format!("Lecture des distributions WSL impossible : {e}")),
    };
    let mut result = Vec::new();
    let default_key = root
        .get_value::<String, _>("DefaultDistribution")
        .unwrap_or_default();
    for key in root.enum_keys().flatten() {
        let is_default = key.eq_ignore_ascii_case(&default_key);
        let Ok(key) = root.open_subkey(key) else {
            continue;
        };
        let (Ok(name), Ok(base)) = (
            key.get_value::<String, _>("DistributionName"),
            key.get_value::<String, _>("BasePath"),
        ) else {
            continue;
        };
        let version = key.get_value::<u32, _>("Version").ok();
        let base_path = expand_path(&base);
        let file_name = key
            .get_value::<String, _>("VhdFileName")
            .unwrap_or_else(|_| "ext4.vhdx".into());
        let vhd = (version != Some(1)).then(|| PathBuf::from(&base_path).join(file_name));
        let file_bytes = vhd
            .as_ref()
            .and_then(|p| std::fs::metadata(p).ok())
            .map(|m| m.len());
        result.push(Distribution {
            name,
            version,
            base_path,
            vhd_path: vhd.map(|p| p.to_string_lossy().into_owned()),
            file_bytes,
            is_default,
        });
    }
    result.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(result)
}

#[tauri::command]
pub async fn list_terminal_fonts() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        use std::collections::BTreeSet;
        use windows_sys::Win32::Graphics::Gdi::*;
        unsafe extern "system" fn collect(
            font: *const LOGFONTW,
            metrics: *const TEXTMETRICW,
            font_type: u32,
            data: isize,
        ) -> i32 {
            // In TEXTMETRIC, TMPF_FIXED_PITCH is set for variable-pitch fonts.
            if font_type & TRUETYPE_FONTTYPE != 0
                && (*metrics).tmPitchAndFamily & TMPF_FIXED_PITCH == 0
            {
                let face = &(*font).lfFaceName;
                let end = face.iter().position(|&c| c == 0).unwrap_or(face.len());
                let name = String::from_utf16_lossy(&face[..end]);
                if !name.is_empty() && !name.starts_with('@') {
                    (*(data as *mut BTreeSet<String>)).insert(name);
                }
            }
            1
        }
        let mut names = BTreeSet::<String>::new();
        unsafe {
            let dc = GetDC(std::ptr::null_mut());
            if dc.is_null() {
                return Err("Lecture des polices Windows impossible.".into());
            }
            let mut filter: LOGFONTW = std::mem::zeroed();
            filter.lfCharSet = DEFAULT_CHARSET;
            EnumFontFamiliesExW(dc, &filter, Some(collect), &mut names as *mut _ as isize, 0);
            ReleaseDC(std::ptr::null_mut(), dc);
        }
        Ok(names.into_iter().collect())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn open_distribution_files(distribution: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !distributions()?.iter().any(|d| d.name == distribution) {
            return Err("Distribution introuvable.".into());
        }
        if distribution.contains(['\\', '/']) {
            return Err("Nom de distribution incompatible avec un chemin Explorateur.".into());
        }
        let explorer = super::wsl_path()?
            .parent()
            .and_then(|p| p.parent())
            .ok_or("Chemin Windows introuvable.")?
            .join("explorer.exe");
        Command::new(explorer)
            .arg(format!(r"\\wsl.localhost\{distribution}\"))
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|e| format!("Ouverture des fichiers impossible : {e}"))?;
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[derive(Serialize)]
pub struct WslOverview {
    running: Vec<String>,
}

#[tauri::command]
pub async fn wsl_overview() -> Result<WslOverview, String> {
    tauri::async_runtime::spawn_blocking(|| {
        use std::{
            io::Read,
            process::Stdio,
            time::{Duration, Instant},
        };
        let mut child = Command::new(super::wsl_path()?)
            .args(["--list", "--running", "--quiet"])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|e| e.to_string())?;
        let mut pipe = child.stdout.take().ok_or("Sortie WSL inaccessible.")?;
        let reader = std::thread::spawn(move || {
            let mut bytes = Vec::new();
            let _ = (&mut pipe).take(1_048_576).read_to_end(&mut bytes);
            bytes
        });
        let deadline = Instant::now() + Duration::from_secs(15);
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(50))
                }
                result => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(match result {
                        Err(e) => e.to_string(),
                        _ => "WSL ne répond pas. Réessayez l’actualisation.".into(),
                    });
                }
            }
        };
        let bytes = reader
            .join()
            .map_err(|_| "Lecture de l’état WSL interrompue.")?;
        if !status.success() {
            return Err("Impossible de lire l’état des distributions WSL.".into());
        }
        let text = dootty::management::decode_output(&bytes);
        Ok(WslOverview {
            running: text
                .lines()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_owned)
                .collect(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum OperationOutput {
    Data {
        stream: &'static str,
        bytes: Vec<u8>,
        truncated: bool,
    },
    Complete,
}

#[tauri::command]
pub async fn run_wsl_action(
    state: tauri::State<'_, super::Sessions>,
    request: dootty::management::WslAction,
    output: tauri::ipc::Channel<OperationOutput>,
) -> Result<dootty::management::CommandResult, String> {
    let sessions = state.inner().0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        use dootty::management::{CommandResult, WslAction};
        use std::{io::Read, process::Stdio};
        let _guard = OperationGuard::acquire()?;
        // Let existing probes finish before stopping WSL; no probe may cross this stop.
        let stopping = matches!(
            &request,
            WslAction::Shutdown {} | WslAction::Terminate { .. }
        );
        let _queries = if stopping {
            Some(super::WSL_QUERY_GATE.write().map_err(|e| e.to_string())?)
        } else {
            None
        };
        let read_only = matches!(&request, WslAction::ListOnline {});
        let mut args = request.args()?;
        let mut export = None;
        let installed = distributions()?;
        if let Some(target) = request.target() {
            if !installed.iter().any(|d| d.name == target) {
                return Err("La distribution ciblée n’existe plus. Actualisez la liste.".into());
            }
        }
        match &request {
            WslAction::Export { path, .. } => {
                let file = PathBuf::from(path);
                if file.exists() {
                    return Err(
                        "Le fichier de sauvegarde existe déjà. Choisissez un nouveau nom.".into(),
                    );
                }
                if !file.parent().is_some_and(|p| p.is_dir()) {
                    return Err("Le dossier de sauvegarde doit déjà exister.".into());
                }
            }
            WslAction::Import {
                name,
                path,
                location,
            } => {
                if installed.iter().any(|d| d.name.eq_ignore_ascii_case(name)) {
                    return Err("Ce nom de distribution existe déjà.".into());
                }
                if !PathBuf::from(path).is_file() {
                    return Err("Le fichier de sauvegarde est introuvable.".into());
                }
                let target = PathBuf::from(location);
                if target.exists() || !target.parent().is_some_and(|p| p.is_dir()) {
                    return Err("Choisissez un nouveau dossier dont le parent existe déjà.".into());
                }
            }
            WslAction::Install { name }
                if installed.iter().any(|d| d.name.eq_ignore_ascii_case(name)) =>
            {
                return Err("Cette distribution est déjà installée.".into())
            }
            _ => {}
        }
        if let WslAction::Export { path, .. } = &request {
            let reserved = dootty::export::ExportReservation::new(std::path::Path::new(path))?;
            args[2] = reserved.temporary.to_string_lossy().into_owned();
            export = Some(reserved);
        }
        if stopping {
            let owned = sessions.lock().map_err(|e| e.to_string())?;
            for (session, profile) in owned.values() {
                if matches!(&request, WslAction::Shutdown {})
                    || request.target() == Some(profile.distribution.as_str())
                {
                    session.close();
                }
            }
        }
        let mut child = Command::new(super::wsl_path()?)
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|e| format!("Lancement de wsl.exe impossible : {e}"))?;
        fn drain(
            mut reader: impl Read + Send + 'static,
            stream: &'static str,
            output: tauri::ipc::Channel<OperationOutput>,
        ) -> std::thread::JoinHandle<Result<(), String>> {
            std::thread::spawn(move || {
                let mut kept = 0usize;
                let mut buffer = [0; 8192];
                let mut truncated = false;
                loop {
                    let length = reader.read(&mut buffer).map_err(|e| e.to_string())?;
                    if length == 0 {
                        break;
                    }
                    let keep = length.min(512 * 1024 - kept);
                    kept += keep;
                    let newly_truncated = !truncated && keep < length;
                    truncated |= keep < length;
                    if keep > 0 || newly_truncated {
                        let _ = output.send(OperationOutput::Data {
                            stream,
                            bytes: buffer[..keep].to_vec(),
                            truncated,
                        });
                    }
                }
                Ok(())
            })
        }
        let stdout = drain(
            child.stdout.take().ok_or("Sortie WSL inaccessible.")?,
            "stdout",
            output.clone(),
        );
        let stderr = drain(
            child
                .stderr
                .take()
                .ok_or("Sortie d’erreur WSL inaccessible.")?,
            "stderr",
            output.clone(),
        );
        let mut timed_out = false;
        let status = if read_only {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(60);
            loop {
                if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
                    break status;
                }
                if std::time::Instant::now() >= deadline {
                    timed_out = true;
                    let _ = child.kill();
                    break child.wait().map_err(|e| e.to_string())?;
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
        } else {
            child.wait().map_err(|e| e.to_string())?
        };
        stdout
            .join()
            .map_err(|_| "Lecture des messages interrompue.")??;
        stderr
            .join()
            .map_err(|_| "Lecture des erreurs interrompue.")??;
        let _ = output.send(OperationOutput::Complete);
        if timed_out {
            return Err("La commande de lecture WSL a dépassé 60 secondes.".into());
        }
        if status.success() {
            if let Some(export) = &mut export {
                export.publish()?;
            }
        }
        Ok(CommandResult {
            code: status.code(),
            success: status.success(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn list_distributions() -> Result<Vec<Distribution>, String> {
    tauri::async_runtime::spawn_blocking(distributions)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn open_storage_folder(distribution: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let selected = distributions()?
            .into_iter()
            .find(|d| d.name == distribution)
            .ok_or("Distribution introuvable dans les enregistrements WSL.")?;
        let folder = selected
            .vhd_path
            .as_ref()
            .and_then(|path| {
                PathBuf::from(path)
                    .parent()
                    .map(|parent| parent.to_path_buf())
            })
            .unwrap_or_else(|| PathBuf::from(selected.base_path));
        if !folder.is_dir() {
            return Err("Le dossier de stockage de cette distribution est introuvable.".into());
        }
        let explorer = super::wsl_path()?
            .parent()
            .and_then(|p| p.parent())
            .ok_or("Chemin Windows introuvable.")?
            .join("explorer.exe");
        Command::new(explorer)
            .arg(folder)
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|e| format!("Ouverture du dossier impossible : {e}"))?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn open_wsl_settings() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        let path = PathBuf::from(super::config()?.wsl_settings_path);
        if !path.is_file() { return Err("L’application WSL Settings est introuvable. Vérifiez son chemin dans les paramètres DooTTY.".into()); }
        let folder = path.parent().ok_or("Dossier WSL Settings invalide.")?;
        Command::new(&path).current_dir(folder).creation_flags(0x08000000).spawn().map_err(|e| format!("Ouverture de WSL Settings impossible : {e}"))?;
        Ok(())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn open_wsl_config_help() -> Result<(), String> {
    let verb: Vec<u16> = "open\0".encode_utf16().collect();
    let url: Vec<u16> = "https://learn.microsoft.com/windows/wsl/wsl-config#wslconfig\0"
        .encode_utf16()
        .collect();
    let result = unsafe {
        windows_sys::Win32::UI::Shell::ShellExecuteW(
            std::ptr::null_mut(),
            verb.as_ptr(),
            url.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            1,
        )
    };
    if result as isize <= 32 {
        Err("Ouverture de la documentation impossible.".into())
    } else {
        Ok(())
    }
}

#[derive(Serialize)]
pub struct WslConfigInfo {
    path: String,
    exists: bool,
}

fn wsl_config_path() -> Result<PathBuf, String> {
    let profile =
        std::env::var_os("USERPROFILE").ok_or("Le dossier utilisateur Windows est introuvable.")?;
    Ok(PathBuf::from(profile).join(".wslconfig"))
}

#[tauri::command]
pub async fn wsl_config_info() -> Result<WslConfigInfo, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let path = wsl_config_path()?;
        Ok(WslConfigInfo {
            path: path.to_string_lossy().into_owned(),
            exists: path.is_file(),
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn open_wsl_config() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        let path = wsl_config_path()?;
        if !path.is_file() {
            return Err("Aucun fichier .wslconfig existant n’a été trouvé. DooTTY n’en crée pas automatiquement.".into());
        }
        let notepad = super::wsl_path()?.parent().ok_or("Dossier système Windows introuvable.")?.join("notepad.exe");
        Command::new(notepad).arg(path).creation_flags(0x08000000).spawn()
            .map_err(|error| format!("Ouverture de .wslconfig impossible : {error}"))?;
        Ok(())
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    if url.len() > 2048 || url.chars().any(char::is_control) {
        return Err("URL invalide.".into());
    }
    let parsed = tauri::Url::parse(&url).map_err(|e| e.to_string())?;
    if !matches!(parsed.scheme(), "http" | "https")
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("Seuls les liens HTTP(S) sans identifiants peuvent être ouverts.".into());
    }
    let verb: Vec<u16> = "open\0".encode_utf16().collect();
    let target: Vec<u16> = parsed.as_str().encode_utf16().chain(Some(0)).collect();
    let result = unsafe {
        windows_sys::Win32::UI::Shell::ShellExecuteW(
            std::ptr::null_mut(),
            verb.as_ptr(),
            target.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            1,
        )
    };
    if result as isize <= 32 {
        Err("Ouverture du navigateur impossible.".into())
    } else {
        Ok(())
    }
}

/// The only elevated action: a fixed WSL platform update. The terminal stays unelevated.
#[tauri::command]
pub async fn update_wsl_elevated() -> Result<dootty::management::CommandResult, String> {
    tauri::async_runtime::spawn_blocking(|| {
        use windows_sys::Win32::{
            Foundation::CloseHandle,
            System::Threading::{GetExitCodeProcess, WaitForSingleObject},
            UI::Shell::{
                ShellExecuteExW, SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW,
            },
        };
        let _guard = OperationGuard::acquire()?;
        let initialized =
            unsafe { windows_sys::Win32::System::Com::CoInitializeEx(std::ptr::null(), 2 | 4) };
        if initialized < 0 {
            return Err(format!("Initialisation COM impossible : {initialized:#x}"));
        }
        struct Com;
        impl Drop for Com {
            fn drop(&mut self) {
                unsafe {
                    windows_sys::Win32::System::Com::CoUninitialize();
                }
            }
        }
        let _com = Com;
        let executable: Vec<u16> = super::wsl_path()?
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect();
        let verb: Vec<u16> = "runas\0".encode_utf16().collect();
        let parameters: Vec<u16> = "--update --web-download\0".encode_utf16().collect();
        let mut info: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
        info.cbSize = std::mem::size_of_val(&info) as u32;
        info.fMask = SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC;
        info.lpVerb = verb.as_ptr();
        info.lpFile = executable.as_ptr();
        info.lpParameters = parameters.as_ptr();
        info.nShow = 1;
        if unsafe { ShellExecuteExW(&mut info) } == 0 {
            return Err(format!("UAC: {}", std::io::Error::last_os_error()));
        }
        if info.hProcess.is_null() {
            return Err("UAC: handle du processus indisponible.".into());
        }
        struct Process(windows_sys::Win32::Foundation::HANDLE);
        impl Drop for Process {
            fn drop(&mut self) {
                unsafe {
                    CloseHandle(self.0);
                }
            }
        }
        let process = Process(info.hProcess);
        loop {
            let result = unsafe { WaitForSingleObject(process.0, 500) };
            if result == 0 {
                break;
            }
            if result == u32::MAX {
                return Err(std::io::Error::last_os_error().to_string());
            }
        }
        let mut code = 0;
        if unsafe { GetExitCodeProcess(process.0, &mut code) } == 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        Ok(dootty::management::CommandResult {
            code: Some(code as i32),
            success: code == 0,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
