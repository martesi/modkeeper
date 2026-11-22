package backend

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/martes/modkeeper/backend/config"
	"github.com/martes/modkeeper/backend/library"
	"github.com/martes/modkeeper/backend/models"
	"github.com/martes/modkeeper/backend/testenv"
)

// Rust hands the startup warning only to get_library_workspace. Plain commands
// that return a workspace must not consume it.
func TestPendingConfigWarningSurvivesPlainWorkspaceCommands(t *testing.T) {
	env := testenv.New(t)
	app := NewAppAt(filepath.Join(env.Root, "config.toml"))
	if err := app.Start(); err != nil {
		t.Fatal(err)
	}
	activeRoot := filepath.Join(env.Root, "active-library")
	active, err := app.CreateLibrary(models.CreateLibraryInput{GameRoot: env.GameRoot, LibraryRoot: &activeRoot})
	if err != nil {
		t.Fatal(err)
	}
	if active.ActiveLibraryID == nil {
		t.Fatal("create did not activate a library")
	}

	inactiveRoot := filepath.Join(env.Root, "inactive-library")
	inactive, err := library.Create(env.GameRoot, inactiveRoot, "Inactive")
	if err != nil {
		t.Fatal(err)
	}
	inactiveID := inactive.DTO().ID
	app.Library.Store.Config.UpsertLibrary(config.KnownLibrary{ID: inactiveID, LibraryRoot: inactiveRoot})
	if err := app.Library.Store.Save(); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(inactive.BackupsDir, "Broken.install.pending"), []byte("pending\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := app.ActivateLibrary(models.ActivateLibraryInput{LibraryID: inactiveID}); err == nil {
		t.Fatal("activation accepted an invalid recovery marker")
	}

	renamed, err := app.RenameLibrary(models.RenameLibraryInput{LibraryID: *active.ActiveLibraryID, Name: "Renamed"})
	if err != nil {
		t.Fatal(err)
	}
	if renamed.ConfigWarning != nil {
		t.Fatalf("rename consumed the pending warning: %q", *renamed.ConfigWarning)
	}

	workspace, err := app.GetLibraryWorkspace()
	if err != nil {
		t.Fatal(err)
	}
	if workspace.ConfigWarning == nil || !strings.Contains(*workspace.ConfigWarning, "Preserve the library and backups") {
		t.Fatalf("workspace warning = %v; want the pending recovery warning", workspace.ConfigWarning)
	}
	again, err := app.GetLibraryWorkspace()
	if err != nil {
		t.Fatal(err)
	}
	if again.ConfigWarning != nil {
		t.Fatalf("second workspace warning = %q; want it consumed", *again.ConfigWarning)
	}
}
