//! Standalone binary to export TypeScript bindings.
//!
//! Run with: `cargo run --bin export_types --features export-types`
//!
//! This avoids the STATUS_ENTRYPOINT_NOT_FOUND error on Windows that occurs
//! when running type exports as a test, because the test binary links against
//! Tauri's GUI DLLs which fail in console mode.

fn main() {
    // Call the library's export function directly
    mod_keeper_lib::export_bindings();
    println!("TypeScript bindings exported successfully!");
}
