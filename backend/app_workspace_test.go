package backend

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/martes/modkeeper/backend/config"
	"github.com/martes/modkeeper/backend/library"
	"github.com/martes/modkeeper/backend/models"
	"github.com/martes/modkeeper/backend/testenv"
)

// The workspace query returns any startup warning. Plain commands that return a
// workspace, including successful transitions, must not consume it.
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

	// A healthy registered library can be activated after the warning exists.
	healthyRoot := filepath.Join(env.Root, "healthy-library")
	healthy, err := library.Create(env.GameRoot, healthyRoot, "Healthy")
	if err != nil {
		t.Fatal(err)
	}
	app.Library.Store.Config.UpsertLibrary(config.KnownLibrary{ID: healthy.DTO().ID, LibraryRoot: healthyRoot})
	if err := app.Library.Store.Save(); err != nil {
		t.Fatal(err)
	}

	// A broken recovery marker makes activation fail and sets the warning.
	brokenRoot := filepath.Join(env.Root, "broken-library")
	broken, err := library.Create(env.GameRoot, brokenRoot, "Broken")
	if err != nil {
		t.Fatal(err)
	}
	app.Library.Store.Config.UpsertLibrary(config.KnownLibrary{ID: broken.DTO().ID, LibraryRoot: brokenRoot})
	if err := app.Library.Store.Save(); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(broken.BackupsDir, "Broken.install.pending"), []byte("pending\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := app.ActivateLibrary(models.ActivateLibraryInput{LibraryID: broken.DTO().ID}); err == nil {
		t.Fatal("activation accepted an invalid recovery marker")
	}

	if _, err := app.ActivateLibrary(models.ActivateLibraryInput{LibraryID: healthy.DTO().ID}); err != nil {
		t.Fatalf("successful activation failed: %v", err)
	}
	newRoot := filepath.Join(env.Root, "new-library")
	if _, err := app.CreateLibrary(models.CreateLibraryInput{GameRoot: env.GameRoot, LibraryRoot: &newRoot}); err != nil {
		t.Fatalf("successful create failed: %v", err)
	}

	workspace, err := app.GetLibraryWorkspace()
	if err != nil {
		t.Fatal(err)
	}
	if workspace.ConfigWarning == nil || !strings.Contains(*workspace.ConfigWarning, "Preserve the library and backups") {
		t.Fatalf("workspace warning = %v; want the pending recovery warning", workspace.ConfigWarning)
	}
	encoded, err := json.Marshal(workspace)
	if err != nil {
		t.Fatal(err)
	}
	var wire map[string]any
	if err := json.Unmarshal(encoded, &wire); err != nil {
		t.Fatal(err)
	}
	if _, ok := wire["configWarning"]; !ok {
		t.Fatalf("configWarning missing from wire workspace: %s", encoded)
	}
	again, err := app.GetLibraryWorkspace()
	if err != nil {
		t.Fatal(err)
	}
	if again.ConfigWarning != nil {
		t.Fatalf("second workspace warning = %q; want it consumed", *again.ConfigWarning)
	}
}
