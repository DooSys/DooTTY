fn main() {
    println!("cargo:rerun-if-changed=icons/icon.ico");
    // Build scripts run on the host. Check the target, so cross builds also
    // generate the Windows manifest, icon resources and Tauri permissions.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        tauri_build::build();
    }
}
