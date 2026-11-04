//! Keep a maximized borderless window inside the current monitor's work area.
//! All coordinates come from Win32 in physical pixels, including negative origins.
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM},
    Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST},
    UI::{
        Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
        WindowsAndMessaging::{MINMAXINFO, WM_GETMINMAXINFO, WM_NCDESTROY},
    },
};

const SUBCLASS_ID: usize = 0x4454_5942;

fn apply_work_area(info: &mut MINMAXINFO, monitor: RECT, work: RECT) {
    let width = work.right - work.left;
    let height = work.bottom - work.top;
    if width <= 0 || height <= 0 {
        return;
    }
    // ptMaxPosition is relative to the monitor, not the virtual desktop.
    info.ptMaxPosition.x = work.left - monitor.left;
    info.ptMaxPosition.y = work.top - monitor.top;
    info.ptMaxSize.x = width;
    info.ptMaxSize.y = height;
    // Do not replace Tauri's minimum/maximum tracking constraints.
}

unsafe extern "system" fn window_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    id: usize,
    _: usize,
) -> LRESULT {
    // Let Tauri apply its DPI-aware tracking limits before setting maximized bounds.
    let result = DefSubclassProc(hwnd, message, wparam, lparam);
    if message == WM_GETMINMAXINFO && lparam != 0 {
        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !monitor.is_null() && GetMonitorInfoW(monitor, &mut info) != 0 {
            // WM_GETMINMAXINFO guarantees a writable MINMAXINFO for this call.
            apply_work_area(
                &mut *(lparam as *mut MINMAXINFO),
                info.rcMonitor,
                info.rcWork,
            );
        }
    } else if message == WM_NCDESTROY {
        RemoveWindowSubclass(hwnd, Some(window_proc), id);
    }
    result
}

/// Called on the window's creating thread, as required by SetWindowSubclass.
pub fn install(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    let hwnd = window.hwnd()?.0 as HWND;
    if unsafe { SetWindowSubclass(hwnd, Some(window_proc), SUBCLASS_ID, 0) } == 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(left: i32, top: i32, right: i32, bottom: i32) -> RECT {
        RECT {
            left,
            top,
            right,
            bottom,
        }
    }

    #[test]
    fn excludes_taskbar_on_every_edge_and_preserves_tracking_limits() {
        let monitor = rect(0, 0, 1920, 1080);
        for (work, position, size) in [
            (rect(0, 0, 1920, 1040), (0, 0), (1920, 1040)),
            (rect(0, 40, 1920, 1080), (0, 40), (1920, 1040)),
            (rect(40, 0, 1920, 1080), (40, 0), (1880, 1080)),
            (rect(0, 0, 1880, 1080), (0, 0), (1880, 1080)),
        ] {
            let mut info = MINMAXINFO::default();
            info.ptMinTrackSize.x = 640;
            info.ptMinTrackSize.y = 360;
            info.ptMaxTrackSize.x = 9000;
            apply_work_area(&mut info, monitor, work);
            assert_eq!((info.ptMaxPosition.x, info.ptMaxPosition.y), position);
            assert_eq!((info.ptMaxSize.x, info.ptMaxSize.y), size);
            assert_eq!((info.ptMinTrackSize.x, info.ptMinTrackSize.y), (640, 360));
            assert_eq!(info.ptMaxTrackSize.x, 9000);
        }
    }

    #[test]
    fn secondary_monitors_use_physical_coordinates_without_origin_or_dpi_scaling() {
        for origin in [(-2560, -400), (1920, 200)] {
            let (x, y) = origin;
            let mut info = MINMAXINFO::default();
            apply_work_area(
                &mut info,
                rect(x, y, x + 2560, y + 1440),
                rect(x, y + 60, x + 2560, y + 1440),
            );
            assert_eq!((info.ptMaxPosition.x, info.ptMaxPosition.y), (0, 60));
            assert_eq!((info.ptMaxSize.x, info.ptMaxSize.y), (2560, 1380));
        }
    }
}
