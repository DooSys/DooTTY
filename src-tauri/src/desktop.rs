use dootty::{
    config::{Config, LaunchProfile},
    session::{Event, Session},
};
use portable_pty::CommandBuilder;
#[path = "lifecycle_windows.rs"]
mod lifecycle_windows;
#[path = "platform.rs"]
mod platform;
#[path = "query_windows.rs"]
mod query_windows;
#[path = "updates_windows.rs"]
mod updates_windows;
#[path = "window_bounds_windows.rs"]
mod window_bounds_windows;
#[path = "windows_util.rs"]
mod windows_util;
use std::collections::HashMap;
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{ipc::Channel, Emitter, Manager, State};

#[derive(Default)]
struct Sessions(Arc<Mutex<HashMap<u64, (Arc<Session>, LaunchProfile)>>>);
static NEXT_ID: AtomicU64 = AtomicU64::new(1);
static CLOSING: AtomicBool = AtomicBool::new(false);
static LIFECYCLE: Mutex<()> = Mutex::new(());
static WSL_QUERY_GATE: std::sync::RwLock<()> = std::sync::RwLock::new(());

static STORAGE: std::sync::OnceLock<dootty::storage::Layout> = std::sync::OnceLock::new();
pub(super) fn config_path() -> Result<PathBuf, String> {
    STORAGE
        .get()
        .map(|layout| layout.config.clone())
        .ok_or("Storage not initialized".into())
}
fn config() -> Result<Config, String> {
    Config::read(&config_path()?)
}

fn wsl_path() -> Result<PathBuf, String> {
    use windows_sys::Win32::System::SystemInformation::GetSystemDirectoryW;
    let mut buffer = vec![0u16; 32768];
    let length = unsafe { GetSystemDirectoryW(buffer.as_mut_ptr(), buffer.len() as u32) } as usize;
    if length == 0 || length >= buffer.len() {
        return Err("Le répertoire système Windows est introuvable.".into());
    }
    let path = PathBuf::from(String::from_utf16_lossy(&buffer[..length])).join("wsl.exe");
    if !path.is_file() {
        return Err(
            "WSL est introuvable sur ce poste. Aucune installation automatique n’a été effectuée."
                .into(),
        );
    }
    Ok(path)
}

#[tauri::command]
fn session_config() -> Result<Config, String> {
    config()
}

#[tauri::command]
async fn save_config(config: Config) -> Result<Config, String> {
    static WRITING: Mutex<()> = Mutex::new(());
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = WRITING.lock().map_err(|e| e.to_string())?;
        config.write(&config_path()?)?;
        Ok(config)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn start_session(
    state: State<'_, Sessions>,
    cols: u16,
    rows: u16,
    output: Channel<Event>,
    profile: Option<LaunchProfile>,
) -> Result<u64, String> {
    if CLOSING.load(Ordering::Acquire) {
        return Err("DooTTY est en cours de fermeture.".into());
    }
    // Serialize starts and bound the number of owned sessions.
    let sessions = state.inner().0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _lifecycle = LIFECYCLE.lock().map_err(|e| e.to_string())?;
        let mut slot = sessions.lock().map_err(|e| e.to_string())?;
        if CLOSING.load(Ordering::Acquire) {
            return Err("DooTTY est en cours de fermeture.".into());
        }
        slot.retain(|_, (session, _)| session.is_alive());
        if slot.len() >= 32 {
            return Err("La limite de 32 sessions ouvertes est atteinte.".into());
        }
        let config = config()?;
        let profile = profile.unwrap_or_else(|| config.launch_profile());
        profile.validate()?;
        let mut command = CommandBuilder::new(wsl_path()?);
        command.args(profile.args());
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");
        let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        let session = Session::spawn(
            command,
            cols,
            rows,
            Arc::new(move |event| output.send(event).is_ok()),
        )?;
        slot.insert(id, (Arc::new(session), profile));
        Ok(id)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn get_session(state: &Sessions, session_id: u64) -> Result<Arc<Session>, String> {
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .get(&session_id)
        .map(|(session, _)| session.clone())
        .ok_or("La session est fermée.".into())
}

#[tauri::command]
fn close_session(state: State<'_, Sessions>, session_id: u64) -> Result<(), String> {
    if let Some((session, _)) = state
        .inner()
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&session_id)
    {
        session.close();
    }
    Ok(())
}

#[tauri::command]
async fn monitoring_snapshot(
    state: State<'_, Sessions>,
    session_id: u64,
) -> Result<dootty::monitor::Snapshot, String> {
    static SAMPLING: Mutex<()> = Mutex::new(());
    let (session, profile) = state
        .inner()
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .get(&session_id)
        .cloned()
        .ok_or("Session closed")?;
    tauri::async_runtime::spawn_blocking(move || {
        let _sample = SAMPLING
            .try_lock()
            .map_err(|_| "Monitoring query already running")?;
        let _query = WSL_QUERY_GATE.try_read().map_err(|_| "Monitoring paused")?;
        dootty::monitor::collect(
            &profile,
            || {
                session.is_alive()
                    && !session.is_stopping()
                    && !CLOSING.load(Ordering::Acquire)
                    && !platform::WSL_OPERATION_BUSY.load(Ordering::Acquire)
            },
            query_windows::query,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn open_profile_folder(state: State<'_, Sessions>, session_id: u64) -> Result<(), String> {
    let (session, profile) = state
        .inner()
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .get(&session_id)
        .cloned()
        .ok_or("Session closed")?;
    tauri::async_runtime::spawn_blocking(move || {
        use std::os::windows::process::CommandExt;
        let _query = WSL_QUERY_GATE
            .try_read()
            .map_err(|_| "WSL operation in progress")?;
        if !session.is_alive()
            || session.is_stopping()
            || platform::WSL_OPERATION_BUSY.load(Ordering::Acquire)
        {
            return Err("Session closed or WSL operation in progress".into());
        }
        let mut args = profile.args();
        args.extend([
            "--exec".into(),
            "/bin/sh".into(),
            "-c".into(),
            "pwd -P".into(),
        ]);
        let path = query_windows::query(&args, Duration::from_secs(4))?;
        let folder = dootty::paths::profile_folder(
            &profile.distribution,
            path.trim_end_matches(['\r', '\n']),
        )?;
        let explorer = wsl_path()?
            .parent()
            .and_then(|p| p.parent())
            .ok_or("Windows directory unavailable")?
            .join("explorer.exe");
        std::process::Command::new(explorer)
            .arg(folder)
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn write_session(
    state: State<'_, Sessions>,
    session_id: u64,
    bytes: Vec<u8>,
) -> Result<(), String> {
    let session = get_session(&state, session_id)?;
    tauri::async_runtime::spawn_blocking(move || session.write(bytes))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn resize_session(
    state: State<'_, Sessions>,
    session_id: u64,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let session = get_session(&state, session_id)?;
    tauri::async_runtime::spawn_blocking(move || session.resize(cols, rows))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
fn ack_output(state: State<'_, Sessions>, session_id: u64, bytes: usize) -> Result<(), String> {
    // Late acks from a completed session are harmless.
    if let Ok(session) = get_session(&state, session_id) {
        session.ack(bytes);
    }
    Ok(())
}
#[tauri::command]
async fn clipboard_read() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        arboard::Clipboard::new()
            .and_then(|mut c| c.get_text())
            .map_err(|e| e.to_string())
            .and_then(|text| {
                if text.len() <= 4 * 1024 * 1024 {
                    Ok(text)
                } else {
                    Err("Le presse-papiers dépasse 4 Mio.".into())
                }
            })
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn clipboard_write(text: String) -> Result<(), String> {
    if text.len() > 4 * 1024 * 1024 {
        return Err("Le presse-papiers dépasse 4 Mio.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        arboard::Clipboard::new()
            .and_then(|mut c| c.set_text(text))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn confirm_close_window(app: tauri::AppHandle, state: State<'_, Sessions>) -> Result<(), String> {
    let _lifecycle = LIFECYCLE.lock().map_err(|e| e.to_string())?;
    if platform::WSL_OPERATION_BUSY.load(Ordering::Acquire) {
        return Err(
            "Une opération WSL est en cours. Attendez son résultat avant de fermer DooTTY.".into(),
        );
    }
    if CLOSING.swap(true, Ordering::AcqRel) {
        return Ok(());
    }
    let sessions = state.inner().0.clone();
    std::thread::spawn(move || {
        let owned: Vec<_> = sessions
            .lock()
            .map(|slot| slot.values().map(|(session, _)| session.clone()).collect())
            .unwrap_or_default();
        for session in &owned {
            session.close();
        }
        let deadline = Instant::now() + Duration::from_secs(5);
        while owned.iter().any(|session| session.is_alive()) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        app.exit(0);
    });
    Ok(())
}

pub fn run() {
    if let Err(error) = run_inner() {
        let text: Vec<u16> = error.encode_utf16().chain(Some(0)).collect();
        unsafe {
            windows_sys::Win32::UI::WindowsAndMessaging::MessageBoxW(
                std::ptr::null_mut(),
                text.as_ptr(),
                windows_sys::core::w!("DooTTY"),
                0x10,
            );
        }
    }
}
fn run_inner() -> Result<(), String> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if args.first().is_some_and(|a| a == "--create-shortcut") {
        let result = args
            .get(1)
            .zip(args.get(2))
            .ok_or("Missing shortcut arguments".to_string())
            .and_then(|(link, target)| {
                windows_util::create_shortcut(PathBuf::from(link), PathBuf::from(target))
            });
        std::process::exit(if result.is_ok() { 0 } else { 12 });
    }
    if args.first().is_some_and(|a| a == "--check-webview") {
        std::process::exit(if windows_util::webview_available() {
            0
        } else {
            20
        });
    }
    if args
        .first()
        .is_some_and(|a| a == "--installer-close" || a == "--installer-check")
    {
        let target = args.get(1).map(PathBuf::from).filter(|p| {
            p.is_absolute()
                && p.file_name()
                    .is_some_and(|n| n.eq_ignore_ascii_case("DooTTY.exe"))
        });
        let code = target
            .map(|p| lifecycle_windows::installer_control(p, args[0] == "--installer-close"))
            .unwrap_or(11);
        std::process::exit(code);
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let roaming = std::env::var_os("APPDATA").map(PathBuf::from);
    let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
    let layout = dootty::storage::Layout::resolve(&exe, roaming.as_deref(), local.as_deref())?;
    layout.prepare()?;
    let Some(instance) = lifecycle_windows::Instance::acquire(&layout.instance_key())? else {
        return Ok(());
    };
    let _ = STORAGE.set(layout.clone());
    let mut context = tauri::generate_context!();
    if layout.portable {
        context.config_mut().app.app_directories_override =
            Some(tauri::utils::config::AppDirectoriesOverride::Root(
                layout.config.parent().unwrap().to_path_buf(),
            ));
    }
    let webview = layout.webview.clone();
    let identity: Vec<u16> = "DooSys.DooTTY\0".encode_utf16().collect();
    unsafe {
        windows_sys::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID(identity.as_ptr());
    }
    let app = tauri::Builder::default()
        .plugin(
            tauri::plugin::Builder::<tauri::Wry, ()>::new("navigation-guard")
                .on_navigation(|_, url| {
                    (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
                        || (matches!(url.scheme(), "http" | "https")
                            && url.host_str() == Some("tauri.localhost")
                            && url.port().is_none())
                        || (cfg!(debug_assertions)
                            && url.scheme() == "http"
                            && url.host_str() == Some("127.0.0.1")
                            && url.port() == Some(1420))
                })
                .build(),
        )
        .manage(layout)
        .setup(move |app| {
            let window = tauri::WebviewWindowBuilder::from_config(
                app.handle(),
                &app.config().app.windows[0],
            )?
            .data_directory(webview.clone())
            .build()?;
            window_bounds_windows::install(&window)?;
            Ok(())
        })
        .manage(Sessions::default())
        .invoke_handler(tauri::generate_handler![
            session_config,
            save_config,
            start_session,
            close_session,
            write_session,
            resize_session,
            ack_output,
            monitoring_snapshot,
            open_profile_folder,
            clipboard_read,
            clipboard_write,
            confirm_close_window,
            platform::list_distributions,
            platform::open_storage_folder,
            platform::open_wsl_settings,
            platform::wsl_config_info,
            platform::open_wsl_config,
            platform::open_wsl_config_help,
            platform::list_terminal_fonts,
            platform::open_distribution_files,
            platform::wsl_overview,
            platform::wsl_online_catalogue,
            platform::run_wsl_action,
            platform::update_wsl_elevated,
            platform::open_external_url,
            updates_windows::wsl_latest_release,
            updates_windows::wsl_system_info,
            updates_windows::open_wsl_release_notes
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if platform::WSL_OPERATION_BUSY.load(Ordering::Acquire) {
                    let _ = window.emit("wsl-operation-active", ());
                    return;
                }
                if CLOSING.load(Ordering::Acquire) {
                    return;
                }
                let _ = window.emit("close-window-requested", ());
            }
        })
        .build(context)
        .map_err(|e| e.to_string())?;
    instance.watch(app.handle().clone());
    app.run(|app, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            if let Ok(slot) = app.state::<Sessions>().inner().0.lock() {
                for (session, _) in slot.values() {
                    session.close();
                }
            }
        }
    });
    Ok(())
}
