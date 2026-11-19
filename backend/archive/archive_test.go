package archive

import (
	"archive/zip"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/martes/modkeeper/backend"
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

func TestExtractMalformedAndUnsupportedLeaveDestinationUntouched(t *testing.T) {
	root := t.TempDir()
	bad := filepath.Join(root, "bad.zip")
	if err := os.WriteFile(bad, []byte("not zip"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{bad, filepath.Join(root, "archive.rar")} {
		dest := filepath.Join(root, filepath.Base(path)+"-out")
		err := Extract(path, dest)
		if err == nil {
			t.Fatalf("Extract(%q) succeeded", path)
		}
		var be *backend.Error
		if !errors.As(err, &be) {
			t.Fatalf("expected backend error, got %T", err)
		}
		if _, statErr := os.Lstat(dest); !os.IsNotExist(statErr) {
			t.Fatalf("destination changed: %v", statErr)
		}
	}
}

func TestExtractSevenZipFixture(t *testing.T) {
	dest := filepath.Join(t.TempDir(), "out")
	if err := Extract(filepath.Join("testdata", "fixture.7z"), dest); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(dest)
	if err != nil || len(entries) == 0 {
		t.Fatalf("fixture extracted no entries: %v", err)
	}
}
