package library

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/martes/modkeeper/backend/config"
	"github.com/martes/modkeeper/backend/models"
	"github.com/martes/modkeeper/backend/testenv"
)

func TestStartupAndActivationWarnOnInvalidInstallMarkers(t *testing.T) {
	markers := []struct {
		name     string
		filename string
		content  string
	}{
		{name: "truncated", filename: "BrokenMod.install.prepared", content: `{"version":1`},
		{name: "legacy", filename: "BrokenMod.install.pending", content: "pending\n"},
	}
	for _, marker := range markers {
		t.Run(marker.name, func(t *testing.T) {
			t.Run("startup", func(t *testing.T) {
				env := testenv.New(t)
				configPath := filepath.Join(env.Root, "warning-startup-config.toml")
				service, err := New(configPath)
				if err != nil {
					t.Fatal(err)
				}
				root := filepath.Join(env.Root, "warning-startup-library")
				if err := service.CreateLibrary(createInput(env.GameRoot, root)); err != nil {
					t.Fatal(err)
				}
				l := service.active
				markerPath := filepath.Join(l.BackupsDir, marker.filename)
				seedInvalidRecoveryState(t, l, markerPath, marker.content)

				restarted, err := New(configPath)
				if err != nil {
					t.Fatal(err)
				}
				if err := restarted.Start(); err != nil {
					t.Fatal(err)
				}
				if err := restarted.WaitForInitialLoad(); err != nil {
					t.Fatal(err)
				}
				assertRecoveryWarning(t, restarted, markerPath, marker.content)
			})

			t.Run("activation", func(t *testing.T) {
				env := testenv.New(t)
				service, err := New(filepath.Join(env.Root, "warning-activation-config.toml"))
				if err != nil {
					t.Fatal(err)
				}
				if err := service.CreateLibrary(createInput(env.GameRoot, filepath.Join(env.Root, "active-library"))); err != nil {
					t.Fatal(err)
				}
				activeID := service.active.manifest.ID
				inactiveRoot := filepath.Join(env.Root, "inactive-library")
				inactive, err := Create(env.GameRoot, inactiveRoot, "Inactive")
				if err != nil {
					t.Fatal(err)
				}
				service.Store.Config.UpsertLibrary(config.KnownLibrary{ID: inactive.manifest.ID, LibraryRoot: inactiveRoot})
				if err := service.Store.Save(); err != nil {
					t.Fatal(err)
				}
				markerPath := filepath.Join(inactive.BackupsDir, marker.filename)
				seedInvalidRecoveryState(t, inactive, markerPath, marker.content)

				if err := service.ActivateLibrary(inactive.manifest.ID); err == nil {
					t.Fatal("activation accepted an invalid marker")
				}
				if service.active.manifest.ID != activeID {
					t.Fatal("failed activation changed the active library")
				}
				assertRecoveryWarning(t, service, markerPath, marker.content)
			})
		})
	}
}

func TestCommittedRecoveryPreservesSnapshotWhenDestinationIsUnavailable(t *testing.T) {
	for _, destinationState := range []string{"missing", "not-directory"} {
		t.Run(destinationState, func(t *testing.T) {
			env := testenv.New(t)
			configPath := filepath.Join(env.Root, "committed-warning-config.toml")
			service, err := New(configPath)
			if err != nil {
				t.Fatal(err)
			}
			root := filepath.Join(env.Root, "committed-warning-library")
			if err := service.CreateLibrary(createInput(env.GameRoot, root)); err != nil {
				t.Fatal(err)
			}
			l := service.active
			oldMod := models.Mod{ID: "BrokenMod", Name: "old", Source: models.ModSourceLocal}
			newMod := models.Mod{ID: oldMod.ID, Name: "new", Source: models.ModSourceForge}
			l.manifest.Mods[oldMod.ID] = newMod
			if err := l.Persist(); err != nil {
				t.Fatal(err)
			}
			snapshot := installSnapshotPath(l, oldMod.ID)
			if err := os.MkdirAll(snapshot, 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(snapshot, "version"), []byte("old-only-copy"), 0600); err != nil {
				t.Fatal(err)
			}
			destination := filepath.Join(l.ModsDir, oldMod.ID)
			if destinationState == "not-directory" {
				if err := os.WriteFile(destination, []byte("user-file"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			prepared := installTransaction{
				Version: 1, ID: oldMod.ID, Phase: installPrepared,
				HadOld: true, OldMod: &oldMod, NewMod: newMod,
			}
			committed := prepared
			committed.Phase = installCommitted
			preparedPath := installPreparedMarkerPath(l, oldMod.ID)
			committedPath := installCommittedMarkerPath(l, oldMod.ID)
			if err := writeInstallTransaction(preparedPath, prepared); err != nil {
				t.Fatal(err)
			}
			if err := writeInstallTransaction(committedPath, committed); err != nil {
				t.Fatal(err)
			}
			preparedBytes, err := os.ReadFile(preparedPath)
			if err != nil {
				t.Fatal(err)
			}
			committedBytes, err := os.ReadFile(committedPath)
			if err != nil {
				t.Fatal(err)
			}

			for restart := 1; restart <= 2; restart++ {
				restarted, err := New(configPath)
				if err != nil {
					t.Fatal(err)
				}
				if err := restarted.Start(); err != nil {
					t.Fatal(err)
				}
				if err := restarted.WaitForInitialLoad(); err != nil {
					t.Fatal(err)
				}
				if warning := restarted.TakeStartupWarning(); warning == nil ||
					!strings.Contains(*warning, "Preserve the library and backups") {
					t.Fatalf("restart %d warning=%v; want repair guidance", restart, warning)
				}
				loaded, err := Load(root)
				if err != nil {
					t.Fatal(err)
				}
				if got := loaded.manifest.Mods[oldMod.ID]; !reflect.DeepEqual(got, newMod) {
					t.Fatalf("restart %d manifest=%+v; want preserved %+v", restart, got, newMod)
				}
				assertFileContents(t, filepath.Join(snapshot, "version"), "old-only-copy")
				if got, err := os.ReadFile(preparedPath); err != nil || !reflect.DeepEqual(got, preparedBytes) {
					t.Fatalf("restart %d prepared marker changed: %v", restart, err)
				}
				if got, err := os.ReadFile(committedPath); err != nil || !reflect.DeepEqual(got, committedBytes) {
					t.Fatalf("restart %d committed marker changed: %v", restart, err)
				}
				if destinationState == "missing" {
					if _, err := os.Stat(destination); !os.IsNotExist(err) {
						t.Fatalf("restart %d missing destination changed: %v", restart, err)
					}
				} else {
					assertFileContents(t, destination, "user-file")
				}
			}
		})
	}
}

func createInput(gameRoot, libraryRoot string) models.CreateLibraryInput {
	return models.CreateLibraryInput{GameRoot: gameRoot, LibraryRoot: &libraryRoot}
}

func seedInvalidRecoveryState(t *testing.T, l *Library, markerPath, marker string) {
	t.Helper()
	for path, content := range map[string]string{
		filepath.Join(l.ModsDir, "BrokenMod", "version"):             "new",
		filepath.Join(l.BackupsDir, "BrokenMod.snapshot", "version"): "old",
		markerPath: marker,
	} {
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
}

func assertRecoveryWarning(t *testing.T, service *Service, markerPath, marker string) {
	t.Helper()
	warning := service.TakeStartupWarning()
	if warning == nil ||
		!strings.Contains(*warning, "Preserve the library and backups") {
		t.Fatalf("workspace warning=%v; want actionable recovery guidance", warning)
	}
	if consumed := service.TakeStartupWarning(); consumed != nil {
		t.Fatalf("second workspace warning=%q; want it consumed", *consumed)
	}
	assertRecoveryState(t, markerPath, marker)
}

func assertRecoveryState(t *testing.T, markerPath, marker string) {
	t.Helper()
	if got, err := os.ReadFile(markerPath); err != nil || string(got) != marker {
		t.Fatalf("marker changed during failed recovery: %q %v", got, err)
	}
	assertFileContents(t, filepath.Join(filepath.Dir(filepath.Dir(markerPath)), "mods", "BrokenMod", "version"), "new")
	assertFileContents(t, filepath.Join(filepath.Dir(markerPath), "BrokenMod.snapshot", "version"), "old")
}
