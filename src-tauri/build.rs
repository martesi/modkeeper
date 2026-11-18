fn main() {
    configure_gnu_cdylib();
    tauri_build::build()
}

// windows-gnu: rustc exports every dependency rlib symbol from `cdylib`s, which
// overflows the PE/COFF 16-bit export-ordinal limit (rust-lang/rust#92212) —
// `ld: error: export ordinal too large`. Restrict the cdylib to its own symbols.
fn configure_gnu_cdylib() {
    let Ok(target) = std::env::var("TARGET") else {
        return;
    };
    if target.contains("windows") && target.contains("gnu") {
        println!("cargo::rustc-link-arg-cdylib=-Wl,--exclude-libs=ALL");
    }
}
