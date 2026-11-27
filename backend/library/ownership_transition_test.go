package library

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/martes/modkeeper/backend/config"
	"github.com/martes/modkeeper/backend/deployment"
	"github.com/martes/modkeeper/backend/models"
	"github.com/martes/modkeeper/backend/spt"
)

func TestFailedLibraryTransitionsKeepActiveDeploymentPins(t *testing.T) {
	service, env := newServiceFixture(t)
	active := createFixtureLibrary(t, service, env)
	secondRoot := filepath.Join(env.Root, "second-library")
	second, err := Create(env.GameRoot, secondRoot, "second")
	if err != nil {
		t.Fatal(err)
	}
	if err := service.updateConfigAndSave(func(cfg *config.AppConfig) {
		cfg.UpsertLibrary(config.KnownLibrary{ID: second.manifest.ID, LibraryRoot: second.Root})
	}); err != nil {
		t.Fatal(err)
	}
	if err := service.ActivateLibrary(second.manifest.ID); err != nil {
		t.Fatal(err)
	}
	if err := service.ActivateLibrary(active.manifest.ID); err != nil {
		t.Fatal(err)
	}
	active = service.active

	if err := os.MkdirAll(filepath.Join(active.ModsDir, "owned", "BepInEx", "plugins"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(active.ModsDir, "owned", "BepInEx", "plugins", "owned.dll"), []byte("owned"), 0644); err != nil {
		t.Fatal(err)
	}
	mod := models.Mod{ID: "owned", Enabled: true}
	rules, err := spt.Discover(active.GameRoot)
	if err != nil {
		t.Fatal(err)
	}
	layout := deployment.Layout{LibraryRoot: active.Root, GameRoot: active.GameRoot, Rules: rules}
	if _, err := deployment.Sync(t.Context(), layout, []models.Mod{mod}, nil); err != nil {
		t.Fatal(err)
	}
	state, err := deployment.LoadState(layout)
	if err != nil {
		t.Fatal(err)
	}
	if len(state.Artifacts) != 1 {
		t.Fatalf("deployment state = %+v", state.Artifacts)
	}
	assertPin := func() {
		t.Helper()
		if err := deployment.VerifyOwnership(layout); err != nil {
			t.Fatalf("active library ownership verification failed: %v", err)
		}
	}

	blocked := filepath.Join(env.Root, "not-a-directory")
	if err := os.WriteFile(blocked, []byte("block"), 0600); err != nil {
		t.Fatal(err)
	}
	service.Store.Path = filepath.Join(blocked, "config.toml")
	if err := service.ActivateLibrary(second.manifest.ID); err == nil {
		t.Fatal("failed config save activated another library")
	}
	if service.active != active {
		t.Fatal("failed switch changed the active library")
	}
	assertPin()
	if _, err := deployment.Sync(t.Context(), layout, []models.Mod{mod}, nil); err != nil {
		t.Fatalf("active library could not sync after failed switch: %v", err)
	}
	assertPin()

	thirdRoot := filepath.Join(env.Root, "third-library")
	if err := service.CreateLibrary(models.CreateLibraryInput{GameRoot: env.GameRoot, LibraryRoot: &thirdRoot, Name: ptr("third")}); err == nil {
		t.Fatal("create-and-activate with failing config save succeeded")
	}
	if service.active != active {
		t.Fatal("failed create-and-activate changed the active library")
	}
	assertPin()
	if _, err := deployment.Sync(t.Context(), layout, []models.Mod{mod}, nil); err != nil {
		t.Fatalf("active library could not sync after failed create-and-activate: %v", err)
	}
}

func ptr(value string) *string { return &value }
