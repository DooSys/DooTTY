//! Real WebView2 layout regression: use the production CSS, xterm and FitAddon.
//! No WSL sessions, user configuration, or application IPC commands are started.
use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, POINT, RECT},
    Graphics::Gdi::{
        EnumDisplayMonitors, GetMonitorInfoW, MapWindowPoints, HDC, HMONITOR, MONITORINFO,
    },
    UI::WindowsAndMessaging::GetClientRect,
};

#[allow(deprecated)] // Bounded message pump for this test, never used by the application.
fn pump(app: &mut tauri::App, duration: Duration) {
    let end = Instant::now() + duration;
    while Instant::now() < end {
        app.run_iteration(|_, _| {});
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[derive(Default)]
struct MonitorEnumeration {
    areas: Vec<RECT>,
    failed: bool,
}

// Own the application before any fallible window setup or assertion, so an
// unwinding test cannot leave a window or its WebView2 data directory behind.
struct TestEnvironment {
    app: Option<tauri::App>,
    window: Option<tauri::WebviewWindow>,
    cache: std::path::PathBuf,
}
impl Drop for TestEnvironment {
    fn drop(&mut self) {
        if let Some(window) = self.window.take() {
            let _ = window.destroy();
        }
        if let Some(app) = self.app.take() {
            app.cleanup_before_exit();
            drop(app);
        }
        // WebView2 can release its file handles shortly after window destruction.
        for _ in 0..10 {
            if std::fs::remove_dir_all(&self.cache).is_ok() || !self.cache.exists() {
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }
}

unsafe extern "system" fn collect_monitors(
    monitor: HMONITOR,
    _: HDC,
    _: *mut RECT,
    data: LPARAM,
) -> i32 {
    let mut info = MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    let result = &mut *(data as *mut MonitorEnumeration);
    if GetMonitorInfoW(monitor, &mut info) == 0 {
        result.failed = true;
        return 0;
    }
    result.areas.push(info.rcWork);
    1
}

#[test]
fn terminal_last_row_remains_visible_on_each_monitor() {
    let measurements = Arc::new(Mutex::new(Vec::<serde_json::Value>::new()));
    let received = measurements.clone();
    let cache = std::env::temp_dir().join(format!("dootty-layout-test-{}", std::process::id()));
    let mut environment = TestEnvironment {
        app: None,
        window: None,
        cache: cache.clone(),
    };
    environment.app = Some(
        tauri::Builder::default()
            .any_thread()
            .build(tauri::generate_context!())
            .unwrap(),
    );
    let app = environment.app.as_mut().unwrap();
    let window = tauri::WebviewWindowBuilder::new(
        app.handle(),
        "terminal-layout-test",
        tauri::WebviewUrl::External("about:blank".parse().unwrap()),
    )
    .title("DooTTY terminal layout regression test")
    .decorations(false)
    .shadow(true)
    .focused(false)
    .inner_size(800.0, 500.0)
    .data_directory(cache.clone())
    .on_document_title_changed(move |_, title| {
        if let Ok(value) = serde_json::from_str(&title) {
            received.lock().unwrap().push(value);
        }
    })
    .build()
    .unwrap();
    environment.window = Some(window.clone());
    super::window_bounds_windows::install(&window).unwrap();
    pump(app, Duration::from_millis(300));
    let css = include_str!("../../src/style.css")
        .lines()
        .filter(|line| !line.starts_with("@import "))
        .collect::<Vec<_>>()
        .join("\n");
    let styles = format!(
        "{}\n{css}",
        include_str!("../../node_modules/@xterm/xterm/css/xterm.css")
    );
    let fixture = format!(
        r#"
        {};
        {};
        const style = document.createElement('style');
        style.textContent = {};
        document.head.append(style);
        document.body.innerHTML = '<header></header><main id="workspace"><aside id="monitoring" class="expanded"><div style="height:2000px"></div></aside><div id="terminal-panes"><div class="terminal-pane"></div></div></main>';
        const terminal = new Terminal({{fontFamily:'Consolas, monospace',fontSize:14,scrollback:500}});
        const fit = new FitAddon.FitAddon(); terminal.loadAddon(fit);
        terminal.open(document.querySelector('.terminal-pane'));
        let sequence = 0;
        window.measureLayout = () => {{
            const background = document.documentElement.dataset.theme === 'light' ? '#f7f7f7' : '#0c0c0c';
            document.querySelector('.terminal-pane').style.setProperty('--terminal-background', background);
            terminal.options.theme = {{background}};
            fit.fit();
            terminal.write('test prompt\r\n'.repeat(200), () => requestAnimationFrame(() => {{
                const pane = document.querySelector('.terminal-pane');
                const scrollbar = pane.querySelector('.scrollbar.vertical');
                const slider = scrollbar.querySelector('.slider');
                const monitoring = document.querySelector('#monitoring');
                document.title = JSON.stringify({{
                    sequence: ++sequence, height: innerHeight, dpr: devicePixelRatio, rows: terminal.rows, rowHeight: pane.querySelector('.xterm-rows').lastElementChild.getBoundingClientRect().height,
                    paneBottom: pane.getBoundingClientRect().bottom,
                    viewportBottom: pane.querySelector('.xterm-viewport').getBoundingClientRect().bottom,
                    lastRowBottom: pane.querySelector('.xterm-rows').lastElementChild.getBoundingClientRect().bottom,
                    separator: parseFloat(getComputedStyle(document.body).borderBottomWidth),
                    legacyOverflow: getComputedStyle(pane.querySelector('.xterm-viewport')).overflowY,
                    viewportBackground: getComputedStyle(pane.querySelector('.xterm-viewport')).backgroundColor,
                    paneBackground: getComputedStyle(pane).backgroundColor,
                    scrollbarTop: scrollbar.getBoundingClientRect().top,
                    scrollbarBottom: scrollbar.getBoundingClientRect().bottom,
                    scrollbarWidth: getComputedStyle(scrollbar).width,
                    monitoringWidth: getComputedStyle(monitoring, '::-webkit-scrollbar').width,
                    thumbColor: getComputedStyle(slider).backgroundColor,
                    monitoringColor: getComputedStyle(monitoring, '::-webkit-scrollbar-thumb').backgroundColor,
                    thumbRadius: getComputedStyle(slider).borderRadius,
                    monitoringRadius: getComputedStyle(monitoring, '::-webkit-scrollbar-thumb').borderRadius
                }});
            }}));
        }};
        document.title = 'layout-ready';
        "#,
        include_str!("../../node_modules/@xterm/xterm/lib/xterm.js"),
        include_str!("../../node_modules/@xterm/addon-fit/lib/addon-fit.js"),
        serde_json::to_string(&styles).unwrap(),
    );
    window.eval(fixture).unwrap();
    let mut monitors = MonitorEnumeration::default();
    let enumerated = unsafe {
        EnumDisplayMonitors(
            std::ptr::null_mut(),
            std::ptr::null(),
            Some(collect_monitors),
            &mut monitors as *mut MonitorEnumeration as LPARAM,
        )
    };
    assert!(!monitors.failed, "GetMonitorInfoW failed for a display");
    assert_ne!(enumerated, 0, "EnumDisplayMonitors failed");
    assert!(!monitors.areas.is_empty(), "No Windows work area available");
    let mut native_bounds = Vec::new();
    for work in monitors.areas {
        window.unmaximize().unwrap();
        window
            .set_position(tauri::PhysicalPosition::new(work.left + 30, work.top + 30))
            .unwrap();
        pump(app, Duration::from_millis(300));
        for maximized in [false, true, false, true] {
            if maximized {
                window.maximize().unwrap();
            } else {
                window.unmaximize().unwrap();
            }
            pump(app, Duration::from_millis(300));
            for theme in ["dark", "light"] {
                let count = measurements.lock().unwrap().len();
                window
                    .eval(format!(
                        "document.documentElement.dataset.theme='{theme}'; window.measureLayout();"
                    ))
                    .unwrap();
                let deadline = Instant::now() + Duration::from_secs(10);
                while measurements.lock().unwrap().len() == count && Instant::now() < deadline {
                    pump(app, Duration::from_millis(20));
                }
                assert!(
                    measurements.lock().unwrap().len() > count,
                    "WebView2 did not report layout"
                );
            }
            if maximized {
                let mut client = RECT::default();
                let hwnd = window.hwnd().unwrap().0 as HWND;
                unsafe {
                    assert_ne!(GetClientRect(hwnd, &mut client), 0);
                    // The outer resize frame may extend off-screen; the client must not.
                    MapWindowPoints(
                        hwnd,
                        std::ptr::null_mut(),
                        &mut client as *mut RECT as *mut POINT,
                        2,
                    );
                }
                native_bounds.push((client, work));
            }
        }
    }
    window.destroy().unwrap();
    pump(app, Duration::from_millis(100));
    drop(window);
    drop(environment);
    for (client, work) in native_bounds {
        assert!(
            client.left >= work.left
                && client.top >= work.top
                && client.right <= work.right
                && client.bottom <= work.bottom,
            "Native client crosses the work area"
        );
    }
    for result in measurements.lock().unwrap().iter() {
        println!("{result}");
    }
    for result in measurements.lock().unwrap().iter() {
        let value = |key: &str| result[key].as_f64().unwrap();
        assert!(
            value("lastRowBottom") <= value("viewportBottom") + 0.5,
            "Last terminal row is clipped: {result}"
        );
        assert!(
            value("paneBottom") <= value("height") - value("separator") + 0.5,
            "Terminal overlaps the bottom separator: {result}"
        );
        assert!(
            value("separator") > 0.0 && value("separator") <= 1.0,
            "Bottom separator missing: {result}"
        );
        assert_eq!(
            result["legacyOverflow"], "hidden",
            "A second native scrollbar is visible"
        );
        assert!(
            value("scrollbarTop") >= 0.0 && value("scrollbarBottom") <= value("paneBottom") + 0.5,
            "Scrollbar is clipped: {result}"
        );
        assert_eq!(
            result["viewportBackground"], result["paneBackground"],
            "Terminal padding ignores its console theme"
        );
        assert_eq!(result["scrollbarWidth"], result["monitoringWidth"]);
        assert_eq!(result["thumbColor"], result["monitoringColor"]);
        assert_eq!(result["thumbRadius"], result["monitoringRadius"]);
    }
}
