{
  description = "Modkeeper development shell";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { nixpkgs, ... }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      shells = system:
        let
          pkgs = import nixpkgs {
            inherit system;
          };
          # Webview stack. nixpkgs' wails3 already brings the GTK4 graphics
          # half and WebKitGTK 6.0 into the build environment, plus pkg-config,
          # so none of those are declared here. This list is the load-time
          # closure for the shell hook's library path.
          webviewLibs = with pkgs; [
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
          basePackages = [ pkgs.bun pkgs.curl ] ++ webviewLibs ++ goPackages;
          webviewHook = ''
            export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath webviewLibs}:$LD_LIBRARY_PATH"
            export __EGL_VENDOR_LIBRARY_DIRS="''${__EGL_VENDOR_LIBRARY_DIRS:-${pkgs.mesa}/share/glvnd/egl_vendor.d}"
            export XDG_DATA_DIRS="${pkgs.gtk3}/share/gsettings-schemas/${pkgs.gtk3.name}:${pkgs.gsettings-desktop-schemas}/share/gsettings-schemas/${pkgs.gsettings-desktop-schemas.name}:$XDG_DATA_DIRS"
            export GIO_MODULE_DIR="${pkgs.glib-networking}/lib/gio/modules/"
            export WEBKIT_DISABLE_COMPOSITING_MODE=1
          '';
          commonHook = webviewHook;
          e2ePackages = basePackages ++ (with pkgs; [
            chromium
            imagemagick
            xdpyinfo
            xdotool
            xvfb
          ]);
          e2eHook = commonHook + ''
            export PLAYWRIGHT_FIREFOX_EXECUTABLE="''${PLAYWRIGHT_FIREFOX_EXECUTABLE:-${pkgs.firefox}/bin/firefox}"
            export PLAYWRIGHT_CHROMIUM_EXECUTABLE="''${PLAYWRIGHT_CHROMIUM_EXECUTABLE:-${pkgs.chromium}/bin/chromium}"
            export DISPLAY="''${DISPLAY:-:99}"
            export FONTCONFIG_FILE="''${FONTCONFIG_FILE:-${
              pkgs.makeFontsConf {
                fontDirectories = with pkgs; [ dejavu_fonts liberation_ttf ];
              }
            }}"
          '';
          wslGpuChromium = pkgs.writeShellScript "chromium-wsl-gpu" ''
            exec ${pkgs.chromium}/bin/chromium --ozone-platform=x11 --use-gl=angle --use-angle=gl "$@"
          '';
        in
        {
          default = pkgs.mkShell {
            packages = basePackages;
            shellHook = commonHook;
          };

          windows-release = pkgs.mkShell {
            packages = basePackages ++ [ pkgs.nsis ];
            shellHook = commonHook;
          };

          e2e = pkgs.mkShell {
            packages = e2ePackages;
            shellHook = e2eHook;
          };

          e2e-wsl-gpu = pkgs.mkShell {
            packages = e2ePackages;
            shellHook = e2eHook + ''
              export GALLIUM_DRIVER=d3d12
              export LD_LIBRARY_PATH="/run/opengl-driver/lib:/usr/lib/wsl/lib:$LD_LIBRARY_PATH"
              export __EGL_VENDOR_LIBRARY_DIRS=/run/opengl-driver/share/glvnd/egl_vendor.d
              unset WAYLAND_DISPLAY
              export PLAYWRIGHT_CHROMIUM_EXECUTABLE=${wslGpuChromium}
            '';
          };

        };
    in
    {
      devShells = nixpkgs.lib.genAttrs systems shells;
    };
}
