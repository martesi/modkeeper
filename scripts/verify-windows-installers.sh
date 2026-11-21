#!/bin/sh
# Verify the NSIS outputs and the expanded installer contract.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
nsis_dir="$root/build/windows/nsis"
project="$nsis_dir/project.nsi"
tools="$nsis_dir/wails_tools.nsh"

if [ "${MODKEEPER_WINDOWS_SHELL:-0}" != 1 ] && ! command -v makensis >/dev/null 2>&1 && command -v nix >/dev/null 2>&1; then
  exec nix develop .#windows -c env MODKEEPER_WINDOWS_SHELL=1 sh scripts/verify-windows-installers.sh "$@"
fi

contains() {
  file=$1
  needle=$2
  if ! grep -Fq -- "$needle" "$file"; then
    echo "missing expected text in $file: $needle" >&2
    exit 1
  fi
}

contains "$tools" 'File "MicrosoftEdgeWebview2Setup.exe"'
contains "$tools" 'WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\${PRODUCT_EXECUTABLE}"'
contains "$tools" 'WriteRegStr HKLM "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\${PRODUCT_EXECUTABLE}"'
contains "$tools" 'WriteRegStr HKCU "${UNINST_KEY}" "UninstallString"'
contains "$tools" 'WriteRegStr HKLM "${UNINST_KEY}" "UninstallString"'
contains "$project" 'OutFile "..\..\..\build\bin\${INFO_PROJECTNAME}-${ARCH}-${WAILS_INSTALL_SCOPE}-installer.exe"'

bootstrapper="$nsis_dir/MicrosoftEdgeWebview2Setup.exe"
if [ ! -s "$bootstrapper" ]; then
  echo "missing or empty WebView2 bootstrapper: $bootstrapper" >&2
  exit 1
fi

for arch in amd64 arm64; do
  case "$arch" in
    amd64) define=ARG_WAILS_AMD64_BINARY ;;
    arm64) define=ARG_WAILS_ARM64_BINARY ;;
  esac

  binary="$root/build/bin/modkeeper-$arch.exe"
  for scope in machine user; do
    installer="$root/build/bin/modkeeper-$arch-$scope-installer.exe"
    if [ ! -s "$installer" ]; then
      echo "missing or empty installer: $installer" >&2
      exit 1
    fi

    preprocessed=$(mktemp)
    trap 'rm -f "$preprocessed"' EXIT HUP INT TERM
    makensis -PPO "-D$define=$binary" "-DWAILS_INSTALL_SCOPE=$scope" "$project" > "$preprocessed"
    contains "$preprocessed" 'MicrosoftEdgeWebview2Setup.exe'
    contains "$preprocessed" 'File "/oname=modkeeper.exe"'
    contains "$preprocessed" 'DisplayIcon" "$INSTDIR\modkeeper.exe"'
    contains "$preprocessed" 'UninstallString" "$\"$INSTDIR\uninstall.exe$\"'
    rm -f "$preprocessed"
    trap - EXIT HUP INT TERM

    echo "OK $installer: $(wc -c < "$installer") bytes; scope=$scope; arch=$arch"
  done
done
