//! Per-data-directory single instance and path-scoped, graceful installer shutdown.
use std::{
    ffi::OsStr,
    os::windows::ffi::OsStrExt,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use tauri::Manager;
use windows_sys::core::BOOL;
use windows_sys::Win32::{
    Foundation::*,
    System::{Diagnostics::ToolHelp::*, Threading::*},
    UI::WindowsAndMessaging::*,
};
fn wide(value: impl AsRef<OsStr>) -> Vec<u16> {
    value.as_ref().encode_wide().chain(Some(0)).collect()
}
struct Handle(HANDLE);
impl Drop for Handle {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}
unsafe impl Send for Handle {}
unsafe impl Sync for Handle {}
pub struct Instance {
    mutex: Handle,
    focus: Arc<Handle>,
    stop: Arc<AtomicBool>,
}
impl Instance {
    pub fn acquire(key: &str) -> Result<Option<Self>, String> {
        unsafe {
            let event = CreateEventW(
                std::ptr::null(),
                0,
                0,
                wide(format!("{key}.focus")).as_ptr(),
            );
            if event.is_null() {
                return Err(std::io::Error::last_os_error().to_string());
            }
            let focus = Arc::new(Handle(event));
            let mutex = CreateMutexW(std::ptr::null(), 1, wide(key).as_ptr());
            if mutex.is_null() {
                return Err(std::io::Error::last_os_error().to_string());
            }
            let exists = GetLastError() == ERROR_ALREADY_EXISTS;
            let mutex = Handle(mutex);
            if exists {
                // Transfer foreground permission from this user-launched process.
                if let Ok(executable) = std::env::current_exe() {
                    if let Ok(processes) = matching_processes(&executable) {
                        for process in processes {
                            let pid = GetProcessId(process.0);
                            if pid != GetCurrentProcessId() {
                                AllowSetForegroundWindow(pid);
                            }
                        }
                    }
                }
                SetEvent(focus.0);
                return Ok(None);
            }
            Ok(Some(Self {
                mutex,
                focus,
                stop: Arc::new(AtomicBool::new(false)),
            }))
        }
    }
    pub fn watch(&self, app: tauri::AppHandle) {
        let focus = self.focus.clone();
        let stop = self.stop.clone();
        std::thread::spawn(move || {
            while !stop.load(Ordering::Acquire) {
                if unsafe { WaitForSingleObject(focus.0, 500) } == 0 {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.unminimize();
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
        });
    }
}
impl Drop for Instance {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        unsafe {
            ReleaseMutex(self.mutex.0);
        }
    }
}
fn normalized(path: &Path) -> String {
    std::fs::canonicalize(path)
        .unwrap_or_else(|_| path.to_owned())
        .to_string_lossy()
        .trim_start_matches(r"\\?\")
        .replace('/', "\\")
        .to_lowercase()
}
struct CloseWindows {
    pid: u32,
}
unsafe extern "system" fn close_window(hwnd: HWND, param: LPARAM) -> BOOL {
    let target = &*(param as *const CloseWindows);
    let mut pid = 0;
    GetWindowThreadProcessId(hwnd, &mut pid);
    if pid == target.pid && IsWindowVisible(hwnd) != 0 {
        ShowWindow(hwnd, SW_RESTORE);
        SetForegroundWindow(hwnd);
        PostMessageW(hwnd, WM_CLOSE, 0, 0);
    }
    1
}
/// Only the exact executable being replaced is targeted. No TerminateProcess/taskkill.
fn matching_processes(target: &Path) -> Result<Vec<Handle>, String> {
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return Err(std::io::Error::last_os_error().to_string());
        }
        let snapshot = Handle(snapshot);
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of_val(&entry) as u32;
        let mut found = Vec::new();
        let target = normalized(target);
        let mut available = Process32FirstW(snapshot.0, &mut entry) != 0;
        while available {
            let raw = OpenProcess(
                PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
                0,
                entry.th32ProcessID,
            );
            if !raw.is_null() {
                let handle = Handle(raw);
                let mut buffer = vec![0u16; 32768];
                let mut length = buffer.len() as u32;
                if QueryFullProcessImageNameW(handle.0, 0, buffer.as_mut_ptr(), &mut length) != 0
                    && normalized(Path::new(&String::from_utf16_lossy(
                        &buffer[..length as usize],
                    ))) == target
                {
                    found.push(handle);
                }
            }
            available = Process32NextW(snapshot.0, &mut entry) != 0;
        }
        Ok(found)
    }
}
pub fn installer_control(target: PathBuf, request_close: bool) -> i32 {
    let Ok(processes) = matching_processes(&target) else {
        return 11;
    };
    if processes.is_empty() {
        return 0;
    }
    if !request_close {
        return 10;
    }
    for process in &processes {
        unsafe {
            let target = CloseWindows {
                pid: GetProcessId(process.0),
            };
            EnumWindows(Some(close_window), &target as *const _ as LPARAM);
        }
    }
    let deadline = Instant::now() + Duration::from_secs(45);
    loop {
        if processes
            .iter()
            .all(|p| unsafe { WaitForSingleObject(p.0, 0) } == 0)
        {
            return 0;
        }
        if Instant::now() >= deadline {
            return 10;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn windows_single_instance_releases_its_namespace_after_exit() {
        let key = format!("Local\\DooTTY.test.instance.{}", std::process::id());
        let first = Instance::acquire(&key).unwrap().expect("First instance");
        assert!(Instance::acquire(&key).unwrap().is_none());
        let different = Instance::acquire(&format!("{key}.portable"))
            .unwrap()
            .expect("Independent data directory");
        drop(different);
        drop(first);
        assert!(Instance::acquire(&key).unwrap().is_some());
    }
    #[test]
    fn installer_process_detection_matches_the_full_executable_path() {
        let current = std::env::current_exe().unwrap();
        assert_eq!(installer_control(current.clone(), false), 10);
        assert_eq!(
            installer_control(current.with_file_name("not-dootty.exe"), false),
            0
        );
    }
}
