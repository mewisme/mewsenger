use tauri::AppHandle;

/// Registers a Windows AppUserModelID so toasts from an installed build are
/// attributed to Messenger. Failures are logged and never block startup.
#[cfg(windows)]
pub fn register(app: &AppHandle) {
    use std::ptr::{null, null_mut};
    use tauri::Manager;
    use windows_sys::Win32::{
        Foundation::ERROR_SUCCESS,
        System::Registry::{
            RegCloseKey, RegCreateKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_WRITE,
            REG_OPTION_NON_VOLATILE, REG_SZ,
        },
        UI::Shell::SetCurrentProcessExplicitAppUserModelID,
    };

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }

    let id = app.config().identifier.clone();
    let name = app
        .config()
        .product_name
        .clone()
        .unwrap_or_else(|| "Mewsenger".into());

    let wide_id = wide(&id);
    // SAFETY: wide_id is a NUL-terminated UTF-16 string that outlives the call.
    let hr = unsafe { SetCurrentProcessExplicitAppUserModelID(wide_id.as_ptr()) };
    if hr < 0 {
        eprintln!("could not set AppUserModelID: HRESULT {hr:#x}");
        return;
    }

    let icon = app
        .path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join("notification-icon.png"))
        .and_then(|path| {
            std::fs::create_dir_all(path.parent()?).ok()?;
            std::fs::write(&path, include_bytes!("../icons/128x128@2x.png")).ok()?;
            Some(path)
        });

    let subkey = wide(&format!("Software\\Classes\\AppUserModelId\\{id}"));
    let mut key: HKEY = null_mut();
    // SAFETY: subkey is NUL-terminated and `key` is a valid out pointer.
    let status = unsafe {
        RegCreateKeyExW(
            HKEY_CURRENT_USER,
            subkey.as_ptr(),
            0,
            null(),
            REG_OPTION_NON_VOLATILE,
            KEY_WRITE,
            null(),
            &mut key,
            null_mut(),
        )
    };
    if status != ERROR_SUCCESS {
        eprintln!("could not register notification identity: error {status}");
        return;
    }

    let set = |value: &str, data: &str| {
        let value = wide(value);
        let data = wide(data);
        // SAFETY: `key` is open for writing; buffers are NUL-terminated UTF-16 and the
        // byte length includes the terminator.
        let status = unsafe {
            RegSetValueExW(
                key,
                value.as_ptr(),
                0,
                REG_SZ,
                data.as_ptr().cast(),
                (data.len() * 2) as u32,
            )
        };
        if status != ERROR_SUCCESS {
            eprintln!("could not write notification identity value: error {status}");
        }
    };
    set("DisplayName", &name);
    if let Some(icon) = icon {
        set("IconUri", &icon.to_string_lossy());
    }
    // SAFETY: `key` was opened above and is closed exactly once.
    unsafe { RegCloseKey(key) };
}

#[cfg(not(windows))]
pub fn register(_app: &AppHandle) {}
