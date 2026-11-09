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

pub fn export_terminal_text(parent: isize, text: String) -> Result<bool, String> {
    use windows::{
        core::{w, HRESULT},
        Win32::{
            Foundation::HWND,
            System::Com::{
                CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize,
                CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
            },
            UI::Shell::{
                Common::COMDLG_FILTERSPEC, FileSaveDialog, IFileSaveDialog, FOS_FORCEFILESYSTEM,
                FOS_NOCHANGEDIR, FOS_OVERWRITEPROMPT, FOS_STRICTFILETYPES, SIGDN_FILESYSPATH,
            },
        },
    };
    if text.len() > dootty::terminal_export::MAX_BYTES {
        return Err("Export supérieur à 8 Mio.".into());
    }
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED)
            .ok()
            .map_err(|e| e.to_string())?;
        let result = (|| -> Result<bool, String> {
            let dialog: IFileSaveDialog =
                CoCreateInstance(&FileSaveDialog, None, CLSCTX_INPROC_SERVER)
                    .map_err(|e| e.to_string())?;
            dialog
                .SetOptions(
                    dialog.GetOptions().map_err(|e| e.to_string())?
                        | FOS_FORCEFILESYSTEM
                        | FOS_OVERWRITEPROMPT
                        | FOS_STRICTFILETYPES
                        | FOS_NOCHANGEDIR,
                )
                .map_err(|e| e.to_string())?;
            dialog
                .SetFileTypes(&[COMDLG_FILTERSPEC {
                    pszName: w!("Texte / Text (*.txt)"),
                    pszSpec: w!("*.txt"),
                }])
                .map_err(|e| e.to_string())?;
            dialog
                .SetDefaultExtension(w!("txt"))
                .map_err(|e| e.to_string())?;
            dialog
                .SetFileName(w!("DooTTY-terminal.txt"))
                .map_err(|e| e.to_string())?;
            if let Err(e) = dialog.Show(Some(HWND(parent as _))) {
                if e.code() == HRESULT(0x800704c7u32 as i32) {
                    return Ok(false);
                }
                return Err(e.to_string());
            }
            let name = dialog
                .GetResult()
                .and_then(|item| item.GetDisplayName(SIGDN_FILESYSPATH))
                .map_err(|e| e.to_string())?;
            let path = name.to_string();
            CoTaskMemFree(Some(name.0.cast()));
            dootty::terminal_export::write_text(
                std::path::Path::new(&path.map_err(|e| e.to_string())?),
                &text,
            )?;
            Ok(true)
        })();
        CoUninitialize();
        result
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
