package archive

import (
	"archive/zip"
	"os"
	"path/filepath"
	"testing"
)

func TestExtractNestedAndRejectTraversalTransactionally(t *testing.T) {
	root := t.TempDir()
	makeZip := func(path, name, body string) {
		t.Helper()
		f, err := os.Create(path)
		if err != nil {
			t.Fatal(err)
		}
		w := zip.NewWriter(f)
		entry, err := w.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = entry.Write([]byte(body))
		if err := w.Close(); err != nil {
			t.Fatal(err)
		}
		if err := f.Close(); err != nil {
			t.Fatal(err)
		}
	}
	good := filepath.Join(root, "good.zip")
	makeZip(good, "nested/mod.dll", "ok")
	dest := filepath.Join(root, "out")
	if err := Extract(good, dest); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(filepath.Join(dest, "nested/mod.dll"))
	if err != nil || string(got) != "ok" {
		t.Fatalf("got %q, %v", got, err)
	}
	bad := filepath.Join(root, "bad.zip")
	makeZip(bad, "../escape", "no")
	failedDest := filepath.Join(root, "failed")
	if err := Extract(bad, failedDest); err == nil {
		t.Fatal("expected traversal rejection")
	}
	if _, err := os.Stat(failedDest); !os.IsNotExist(err) {
		t.Fatalf("destination changed: %v", err)
	}
}
