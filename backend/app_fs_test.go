package backend

import (
	"os"
	"path/filepath"
	"testing"
)

func TestListDirectory(t *testing.T) {
	dir := t.TempDir()
	if err := os.Mkdir(filepath.Join(dir, "folder"), 0o755); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(dir, "archive.zip")
	if err := os.WriteFile(file, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	entries, err := (&App{}).ListDirectory(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 || entries[0].Name != "archive.zip" || entries[0].IsDir || entries[1].Name != "folder" || !entries[1].IsDir {
		t.Fatalf("unexpected entries: %+v", entries)
	}
	for _, path := range []string{"relative", file, filepath.Join(dir, "missing")} {
		if _, err := (&App{}).ListDirectory(path); err == nil {
			t.Errorf("expected error for %q", path)
		}
	}
}
