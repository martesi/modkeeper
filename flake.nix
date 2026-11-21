{
  description = "Modkeeper development shell";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    rust-overlay = {
      url = "github:oxalica/rust-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { nixpkgs, rust-overlay, ... }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      shells = system:
        let
          pkgs = import nixpkgs {
            inherit system;
            overlays = [ (import rust-overlay) ];
          };
          rustToolchain = pkgs.rust-bin.stable.latest.default.override {
            extensions = [ "rust-src" "rust-analyzer" "clippy" "rustfmt" ];
          };
          # Webview stack. nixpkgs' wails3 already brings the GTK4 graphics
          # half and WebKitGTK 6.0 into the build environment, plus pkg-config,
          # so none of those are declared here. This list is the load-time
          # closure for the shell hook's library path.
          tauriLibs = with pkgs; [
            dbus
            gtk3
            libsoup_3
            openssl
            webkitgtk_4_1
            webkitgtk_6_0
          ];
          # wails3 bundles its own go-task, but the Taskfile entry points are
          # also run directly from the shell, which needs the CLI.
          goPackages = [ pkgs.go pkgs.go-task pkgs.wails3 pkgs.xvfb-run ];
          # curl: the Taskfile readiness polls and the CI server smoke test use
          # it, and the dev shell must not depend on a host-provided curl.
          basePackages = [ rustToolchain pkgs.bun pkgs.curl ] ++ tauriLibs ++ goPackages;
          cargoCacheHook = ''
            if [ -z "''${CARGO_HOME:-}" ] && [ -d /agt/xdg/cache ]; then
              export CARGO_HOME=/agt/xdg/cache/rust
            fi
          '';
          tauriHook = ''
            export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath tauriLibs}:$LD_LIBRARY_PATH"
            export __EGL_VENDOR_LIBRARY_DIRS="''${__EGL_VENDOR_LIBRARY_DIRS:-${pkgs.mesa}/share/glvnd/egl_vendor.d}"
            export XDG_DATA_DIRS="${pkgs.gtk3}/share/gsettings-schemas/${pkgs.gtk3.name}:${pkgs.gsettings-desktop-schemas}/share/gsettings-schemas/${pkgs.gsettings-desktop-schemas.name}:$XDG_DATA_DIRS"
            export GIO_MODULE_DIR="${pkgs.glib-networking}/lib/gio/modules/"
            export WEBKIT_DISABLE_COMPOSITING_MODE=1
          '';
          commonHook = cargoCacheHook + tauriHook;
          winCrossToolchain = pkgs.rust-bin.stable.latest.default.override {
            extensions = [ "rust-src" ];
            targets = [ "x86_64-pc-windows-gnu" ];
          };
          mingw = pkgs.pkgsCross.mingwW64;
        in
        {
          default = pkgs.mkShell {
            packages = basePackages;
            shellHook = commonHook;
          };

          e2e = pkgs.mkShell {
            packages = basePackages ++ (with pkgs; [
              imagemagick
              xdpyinfo
              xdotool
              xvfb
            ]);
            shellHook = commonHook + ''
              export PLAYWRIGHT_FIREFOX_EXECUTABLE="''${PLAYWRIGHT_FIREFOX_EXECUTABLE:-${pkgs.firefox}/bin/firefox}"
              export DISPLAY="''${DISPLAY:-:99}"
              export FONTCONFIG_FILE="''${FONTCONFIG_FILE:-${
                pkgs.makeFontsConf {
                  fontDirectories = with pkgs; [ dejavu_fonts liberation_ttf ];
                }
              }}"
            '';
          };

          windows = pkgs.mkShell {
            packages = [
              winCrossToolchain
              mingw.stdenv.cc
              pkgs.go
              pkgs.wails3
              pkgs.bun
              pkgs.nsis
              pkgs.python3
            ];
            shellHook = cargoCacheHook + ''
              export CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER=${mingw.stdenv.cc.targetPrefix}cc
              export CARGO_TARGET_X86_64_PC_WINDOWS_GNU_RUSTFLAGS="-L ${mingw.windows.pthreads}/lib -C link-args=-lwinpthread"
              export CFLAGS_x86_64_pc_windows_gnu="-I ${mingw.windows.pthreads}/include"
            '';
          };
        };
    in
    {
      devShells = nixpkgs.lib.genAttrs systems shells;
    };
}
