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
    if GetMonitorInfoW(monitor, &mut info) != 0 {
        (*(data as *mut Vec<RECT>)).push(info.rcWork);
    }
    1
}

#[test]
fn terminal_last_row_remains_visible_on_each_monitor() {
    let measurements = Arc::new(Mutex::new(Vec::<serde_json::Value>::new()));
    let received = measurements.clone();
    let cache = std::env::temp_dir().join(format!("dootty-layout-test-{}", std::process::id()));
    let mut app = tauri::Builder::default()
        .any_thread()
        .build(tauri::generate_context!())
        .unwrap();
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
    super::window_bounds_windows::install(&window).unwrap();
    pump(&mut app, Duration::from_millis(300));
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
    let mut monitors = Vec::<RECT>::new();
    unsafe {
        EnumDisplayMonitors(
            std::ptr::null_mut(),
            std::ptr::null(),
            Some(collect_monitors),
            &mut monitors as *mut Vec<RECT> as LPARAM,
        );
    }
    assert!(!monitors.is_empty(), "No Windows work area available");
    let mut native_bounds = Vec::new();
    for work in monitors {
        window.unmaximize().unwrap();
        window
            .set_position(tauri::PhysicalPosition::new(work.left + 30, work.top + 30))
            .unwrap();
        pump(&mut app, Duration::from_millis(300));
        for maximized in [false, true, false, true] {
            if maximized {
                window.maximize().unwrap();
            } else {
                window.unmaximize().unwrap();
            }
            pump(&mut app, Duration::from_millis(300));
            for theme in ["dark", "light"] {
                let count = measurements.lock().unwrap().len();
                window
                    .eval(format!(
                        "document.documentElement.dataset.theme='{theme}'; window.measureLayout();"
                    ))
                    .unwrap();
                let deadline = Instant::now() + Duration::from_secs(10);
                while measurements.lock().unwrap().len() == count && Instant::now() < deadline {
                    pump(&mut app, Duration::from_millis(20));
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
    pump(&mut app, Duration::from_millis(100));
    app.cleanup_before_exit();
    drop(app);
    let _ = std::fs::remove_dir_all(cache);
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
        assert_eq!(result["scrollbarWidth"], result["monitoringWidth"]);
        assert_eq!(result["thumbColor"], result["monitoringColor"]);
        assert_eq!(result["thumbRadius"], result["monitoringRadius"]);
    }
}
