//go:build !server

package backend

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/martes/modkeeper/backend/models"
)

func TestOpenPathReportsMissingWailsApp(t *testing.T) {
	// A unit test has no running Wails application, so an existing path must
	// fail with a typed error instead of panicking on a nil application.
	err := (&App{}).OpenPath(t.TempDir())
	assertErrorCode(t, err, models.Unexpected)
}

func TestOpenPathDispatchesDirectoriesAndFilesDifferently(t *testing.T) {
	original := openPathTarget
	defer func() { openPathTarget = original }()

	type target struct {
		path  string
		isDir bool
	}
	var targets []target
	openPathTarget = func(path string, isDir bool) error {
		targets = append(targets, target{path: path, isDir: isDir})
		return nil
	}

	dir := t.TempDir()
	file := filepath.Join(dir, "tool.exe")
	if err := os.WriteFile(file, []byte("fixture"), 0o600); err != nil {
		t.Fatal(err)
	}

	app := &App{}
	if err := app.OpenPath(dir); err != nil {
		t.Fatalf("open directory: %v", err)
	}
	if err := app.OpenPath(file); err != nil {
		t.Fatalf("open file: %v", err)
	}
	if len(targets) != 2 {
		t.Fatalf("expected two dispatch calls, got %d", len(targets))
	}
	if targets[0].path != dir || !targets[0].isDir {
		t.Fatalf("directory dispatch = %+v", targets[0])
	}
	if targets[1].path != file || targets[1].isDir {
		t.Fatalf("file dispatch = %+v", targets[1])
	}
}
