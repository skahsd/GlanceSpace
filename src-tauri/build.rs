fn main() {
    #[cfg(feature = "desktop")]
    {
        println!("cargo:rerun-if-changed=icons/icon.ico");
        tauri_build::build();
    }
}
