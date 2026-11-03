use dootty::updates::{installed_version, parse_release, release_url, StableRelease};
use std::{
    ffi::c_void,
    time::{Duration, Instant},
};
use windows_sys::Win32::Networking::WinHttp::*;

struct InternetHandle(*mut c_void);
impl InternetHandle {
    fn new(value: *mut c_void) -> Result<Self, String> {
        if value.is_null() {
            Err(format!("WinHTTP: {}", std::io::Error::last_os_error()))
        } else {
            Ok(Self(value))
        }
    }
}
impl Drop for InternetHandle {
    fn drop(&mut self) {
        unsafe {
            WinHttpCloseHandle(self.0);
        }
    }
}
fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
}
fn checked(value: i32) -> Result<(), String> {
    if value == 0 {
        Err(format!("WinHTTP: {}", std::io::Error::last_os_error()))
    } else {
        Ok(())
    }
}

fn fetch_stable_release() -> Result<StableRelease, String> {
    // Fixed public endpoint; no token, installer download, redirects or remote UI.
    unsafe {
        let agent = wide(concat!("DooTTY/", env!("CARGO_PKG_VERSION")));
        let session = InternetHandle::new(WinHttpOpen(
            agent.as_ptr(),
            WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
            std::ptr::null(),
            std::ptr::null(),
            0,
        ))?;
        checked(WinHttpSetTimeouts(session.0, 5000, 5000, 5000, 10000))?;
        let host = wide("api.github.com");
        let connection = InternetHandle::new(WinHttpConnect(session.0, host.as_ptr(), 443, 0))?;
        let verb = wide("GET");
        let path = wide("/repos/microsoft/WSL/releases/latest");
        let request = InternetHandle::new(WinHttpOpenRequest(
            connection.0,
            verb.as_ptr(),
            path.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            WINHTTP_FLAG_SECURE,
        ))?;
        let policy = WINHTTP_OPTION_REDIRECT_POLICY_NEVER;
        checked(WinHttpSetOption(
            request.0,
            WINHTTP_OPTION_REDIRECT_POLICY,
            &policy as *const _ as *const c_void,
            std::mem::size_of_val(&policy) as u32,
        ))?;
        let headers = wide("Accept: application/vnd.github+json\r\n");
        checked(WinHttpSendRequest(
            request.0,
            headers.as_ptr(),
            (headers.len() - 1) as u32,
            std::ptr::null(),
            0,
            0,
            0,
        ))?;
        checked(WinHttpReceiveResponse(request.0, std::ptr::null_mut()))?;
        let mut status = 0u32;
        let mut size = std::mem::size_of_val(&status) as u32;
        checked(WinHttpQueryHeaders(
            request.0,
            WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
            std::ptr::null(),
            &mut status as *mut _ as *mut c_void,
            &mut size,
            std::ptr::null_mut(),
        ))?;
        if status != 200 {
            return Err(format!("GitHub HTTP {status}"));
        }
        let mut bytes = Vec::new();
        let mut buffer = [0u8; 8192];
        let deadline = Instant::now() + Duration::from_secs(30);
        loop {
            if Instant::now() >= deadline {
                return Err("GitHub response timed out".into());
            }
            let mut count = 0;
            checked(WinHttpReadData(
                request.0,
                buffer.as_mut_ptr() as *mut c_void,
                buffer.len() as u32,
                &mut count,
            ))?;
            if count == 0 {
                break;
            }
            if bytes.len() + count as usize > 1_048_576 {
                return Err("GitHub response exceeds 1 MiB".into());
            }
            bytes.extend_from_slice(&buffer[..count as usize]);
        }
        parse_release(&bytes)
    }
}

#[tauri::command]
pub async fn wsl_latest_release() -> Result<StableRelease, String> {
    tauri::async_runtime::spawn_blocking(fetch_stable_release)
        .await
        .map_err(|e| e.to_string())?
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    version: String,
    details: String,
    status: Option<String>,
    status_error: Option<String>,
}

#[tauri::command]
pub async fn wsl_system_info() -> Result<SystemInfo, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let details = super::query_windows::query(&["--version".into()], Duration::from_secs(15))?;
        let version = installed_version(&details).ok_or("WSL version not recognized")?;
        let status = super::query_windows::query(&["--status".into()], Duration::from_secs(15));
        Ok(SystemInfo {
            version,
            details,
            status: status.as_ref().ok().cloned(),
            status_error: status.err(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn open_wsl_release_notes(tag: String) -> Result<(), String> {
    let url = wide(&release_url(&tag)?);
    let verb = wide("open");
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
        Err("Could not open WSL release notes".into())
    } else {
        Ok(())
    }
}
