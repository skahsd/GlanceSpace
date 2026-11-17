use std::{os::windows::ffi::OsStrExt, path::Path, ptr};
use windows_sys::Win32::{
    Foundation::HWND,
    System::Com::{CoInitializeEx, CoTaskMemFree, CoUninitialize, COINIT_APARTMENTTHREADED},
    UI::Shell::{
        SHOpenFolderAndSelectItems, SHOpenWithDialog, SHParseDisplayName, ShellExecuteW, OAIF_EXEC,
        OPENASINFO,
    },
};

fn wide(path: &Path) -> Vec<u16> {
    let text = path.as_os_str().encode_wide().collect::<Vec<_>>();
    let prefix = [92, 92, 63, 92];
    let slice = text.strip_prefix(&prefix).unwrap_or(&text);
    slice.iter().copied().chain(Some(0)).collect()
}

struct Apartment;
impl Apartment {
    fn new() -> Result<Self, String> {
        let result = unsafe { CoInitializeEx(ptr::null(), COINIT_APARTMENTTHREADED as u32) };
        if result < 0 {
            return Err(format!("无法初始化系统文件操作：0x{:08X}", result as u32));
        }
        Ok(Self)
    }
}
impl Drop for Apartment {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}

pub fn open_with(path: &Path, owner: usize) -> Result<(), String> {
    let _apartment = Apartment::new()?;
    let path = wide(path);
    let info = OPENASINFO {
        pcszFile: path.as_ptr(),
        pcszClass: ptr::null(),
        oaifInFlags: OAIF_EXEC,
    };
    let result = unsafe { SHOpenWithDialog(owner as HWND, &info) };
    // Both cancellation HRESULTs are normal completion, never an Explorer fallback.
    if result >= 0 || matches!(result as u32, 0x800704C7 | 0x80004004) {
        return Ok(());
    }
    Err(format!("打开方式调用失败：0x{:08X}", result as u32))
}

pub fn reveal(path: &Path, open_directory: bool, owner: usize) -> Result<(), String> {
    let _apartment = Apartment::new()?;
    let path = wide(path);
    if open_directory {
        let verb = [111u16, 112, 101, 110, 0];
        let result = unsafe {
            ShellExecuteW(
                owner as HWND,
                verb.as_ptr(),
                path.as_ptr(),
                ptr::null(),
                ptr::null(),
                1,
            )
        };
        return if result as isize > 32 {
            Ok(())
        } else {
            Err(format!("资源管理器打开失败：{}", result as isize))
        };
    }
    let mut pidl = ptr::null_mut();
    let parsed = unsafe {
        SHParseDisplayName(
            path.as_ptr(),
            ptr::null_mut(),
            &mut pidl,
            0,
            ptr::null_mut(),
        )
    };
    if parsed < 0 {
        return Err(format!("无法定位项目：0x{:08X}", parsed as u32));
    }
    let result = unsafe { SHOpenFolderAndSelectItems(pidl, 0, ptr::null(), 0) };
    unsafe { CoTaskMemFree(pidl.cast()) };
    if result < 0 {
        return Err(format!("资源管理器定位失败：0x{:08X}", result as u32));
    }
    Ok(())
}
