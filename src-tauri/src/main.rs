#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(windows)]
mod desktop;

#[cfg(windows)]
fn main() {
    desktop::run();
}

#[cfg(not(windows))]
fn main() {
    eprintln!("DooTTY est un client Windows pour WSL. Compilez et lancez DooTTY.exe sous Windows.");
    std::process::exit(1);
}
