package modfs

import (
	"os"
	"path/filepath"
	"testing"
)

func TestScanTypeAndFiles(t *testing.T) {
	root := t.TempDir()
	for name, body := range map[string]string{"SPT/user/mods/example/index.js":"x", "SPT/BepInEx/plugins/a.dll":"x", "tool.exe":"x"} {
		path := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil { t.Fatal(err) }
		if err := os.WriteFile(path, []byte(body), 0o600); err != nil { t.Fatal(err) }
	}
	got, err := Scan(root, "SPT/user/mods", "SPT/BepInEx/plugins")
	if err != nil { t.Fatal(err) }
	if got.ModType != "both" || len(got.Files) != 3 || len(got.Executables) != 1 || got.ID == "" {
		t.Fatalf("unexpected scan: %+v", got)
	}
}

func TestScanWithoutRecognizedFiles(t *testing.T) {
	_, err := Scan(t.TempDir(), "SPT/user/mods", "SPT/BepInEx/plugins")
	if err == nil { t.Fatal("expected missing mod ID error") }
}
