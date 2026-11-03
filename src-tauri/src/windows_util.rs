pub fn webview_available() -> bool {
    #[link(name = "WebView2LoaderStatic", kind = "static")]
    extern "system" {
        fn GetAvailableCoreWebView2BrowserVersionString(
            folder: *const u16,
            version: *mut *mut u16,
        ) -> i32;
    }
    unsafe {
        let mut version = std::ptr::null_mut();
        let hr = GetAvailableCoreWebView2BrowserVersionString(std::ptr::null(), &mut version);
        let available = hr >= 0 && !version.is_null();
        if !version.is_null() {
            windows_sys::Win32::System::Com::CoTaskMemFree(version.cast());
        }
        available
    }
}

/// A matching AppUserModelID lets Windows associate the running window and shortcut.
pub fn create_shortcut(link: std::path::PathBuf, target: std::path::PathBuf) -> Result<(), String> {
    use windows::{
        core::{Interface, GUID, PCWSTR},
        Win32::{
            Foundation::PROPERTYKEY,
            System::Com::{
                CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile,
                StructuredStorage::{PropVariantChangeType, PROPVARIANT, PVCHF_DEFAULT},
                CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
            },
            UI::Shell::{IShellLinkW, PropertiesSystem::IPropertyStore, ShellLink},
        },
    };
    if !link.is_absolute() || !target.is_absolute() || !target.is_file() {
        return Err("Invalid shortcut paths".into());
    }
    let wide = |p: &std::path::Path| -> Vec<u16> {
        use std::os::windows::ffi::OsStrExt;
        p.as_os_str().encode_wide().chain(Some(0)).collect()
    };
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED)
            .ok()
            .map_err(|e| e.to_string())?;
        let result = (|| -> windows::core::Result<()> {
            let shell: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
            shell.SetPath(PCWSTR(wide(&target).as_ptr()))?;
            shell.SetWorkingDirectory(PCWSTR(wide(target.parent().unwrap()).as_ptr()))?;
            shell.SetIconLocation(PCWSTR(wide(&target).as_ptr()), 0)?;
            let properties: IPropertyStore = shell.cast()?;
            let key = PROPERTYKEY {
                fmtid: GUID::from_u128(0x9f4c2855_9f79_4b39_a8d0_e1d42de1d5f3),
                pid: 5,
            };
            let mut identity = PROPVARIANT::default();
            PropVariantChangeType(
                &mut identity,
                &PROPVARIANT::from("DooSys.DooTTY"),
                PVCHF_DEFAULT,
                windows::Win32::System::Variant::VT_LPWSTR,
            )?;
            properties.SetValue(&key, &identity)?;
            properties.Commit()?;
            let file: IPersistFile = shell.cast()?;
            file.Save(PCWSTR(wide(&link).as_ptr()), true)?;
            Ok(())
        })();
        CoUninitialize();
        result.map_err(|e| e.to_string())
    }
}
