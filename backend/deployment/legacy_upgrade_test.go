package deployment

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/martes/modkeeper/backend/models"
)

func TestSyncUpgradesLegacyDeploymentWithoutAdoptingGameFiles(t *testing.T) {
	for _, recorded := range []bool{false, true} {
		t.Run(fmt.Sprintf("recorded-target=%t", recorded), func(t *testing.T) {
			l := fixture(t)
			oldDir := filepath.Join(l.GameRoot, "BepInEx", "plugins", "old")
			must(t, os.MkdirAll(oldDir, 0700))
			legacy := "artifacts = []\ncreated_dirs = []\n"
			if recorded {
				legacy = `created_dirs = ['BepInEx/plugins/old']
[[artifacts]]
target = 'BepInEx/plugins/old/old.dll'
source = 'mods/old/BepInEx/plugins/old/old.dll'
kind = 'copy'
fingerprint = 'legacy-fingerprint'
`
			}
			path := filepath.Join(l.LibraryRoot, legacyDeploymentFilename)
			write(t, path, legacy)
			m := mod(t, l, "new", map[string]string{"BepInEx/plugins/new.dll": "new payload"})
			_, err := Sync(context.Background(), l, []models.Mod{m}, nil)
			must(t, err)
			content(t, path, legacy)
			content(t, filepath.Join(l.GameRoot, "BepInEx/plugins/new.dll"), "new payload")
			if _, err := os.Stat(oldDir); err != nil {
				t.Fatalf("legacy directory changed: %v", err)
			}
			must(t, releasePinsForMissingLibrary(l))
			_, err = Sync(context.Background(), l, []models.Mod{m}, nil)
			must(t, err)
			content(t, path, legacy)
		})
	}
}

func TestSyncLeavesExistingLegacyArtifactsAndRecordUntouched(t *testing.T) {
	l := fixture(t)
	target := filepath.Join(l.GameRoot, "BepInEx", "plugins", "a.dll")
	write(t, target, "same bytes")
	path := filepath.Join(l.LibraryRoot, legacyDeploymentFilename)
	legacy := `created_dirs = []
[[artifacts]]
target = 'BepInEx/plugins/a.dll'
source = 'mods/a/BepInEx/plugins/a.dll'
kind = 'copy'
`
	write(t, path, legacy)
	m := mod(t, l, "a", map[string]string{"BepInEx/plugins/a.dll": "same bytes"})
	_, err := Sync(context.Background(), l, []models.Mod{m}, nil)
	code(t, err, models.InvalidLibrary)
	content(t, target, "same bytes")
	content(t, path, legacy)
	absent(t, l.Paths().Deployment)
	absent(t, l.Paths().SyncIntent)
}

func TestSyncRejectsPartiallySignedLegacyRecord(t *testing.T) {
	l := fixture(t)
	path := filepath.Join(l.LibraryRoot, legacyDeploymentFilename)
	partial := `created_dirs = []
[[artifacts]]
target = 'BepInEx/plugins/a.dll'
source = 'mods/a/BepInEx/plugins/a.dll'
kind = 'copy'
file_id = ''
`
	write(t, path, partial)
	m := mod(t, l, "a", map[string]string{"BepInEx/plugins/a.dll": "payload"})
	_, err := Sync(context.Background(), l, []models.Mod{m}, nil)
	code(t, err, models.InvalidLibrary)
	content(t, path, partial)
	absent(t, l.Paths().Deployment)
	absent(t, l.Paths().SyncIntent)
}

func TestForeignV2RecordDoesNotBypassLegacySafety(t *testing.T) {
	l := fixture(t)
	target := filepath.Join(l.GameRoot, "BepInEx", "plugins", "old.dll")
	write(t, target, "old bytes")
	old := filepath.Join(l.LibraryRoot, legacyDeploymentFilename)
	legacy := `created_dirs = []
[[artifacts]]
target = 'BepInEx/plugins/old.dll'
source = 'mods/old/BepInEx/plugins/old.dll'
kind = 'copy'
`
	write(t, old, legacy)
	foreign := "artifacts = []\ncreated_dirs = []\n"
	write(t, l.Paths().Deployment, foreign)
	m := mod(t, l, "new", map[string]string{"BepInEx/plugins/new.dll": "new bytes"})
	_, err := Sync(context.Background(), l, []models.Mod{m}, nil)
	code(t, err, models.FileCollision)
	code(t, VerifyOwnership(l), models.FileCollision)
	content(t, target, "old bytes")
	content(t, old, legacy)
	content(t, l.Paths().Deployment, foreign)
	absent(t, l.Paths().SyncIntent)
	absent(t, filepath.Join(l.GameRoot, "BepInEx", "plugins", "new.dll"))
}

func TestFirstUpgradeSyncRecoversAfterIntentOnlyCrash(t *testing.T) {
	l := fixture(t)
	old := filepath.Join(l.LibraryRoot, legacyDeploymentFilename)
	legacy := "artifacts = []\ncreated_dirs = []\n"
	write(t, old, legacy)
	m := mod(t, l, "a", map[string]string{"BepInEx/plugins/a.dll": "payload"})
	killSyncChildAt(t, l, "intent-persisted")
	absent(t, l.Paths().Deployment)
	content(t, old, legacy)
	_, err := Sync(context.Background(), l, []models.Mod{m}, nil)
	must(t, err)
	content(t, old, legacy)
	content(t, filepath.Join(l.GameRoot, "BepInEx/plugins/a.dll"), "payload")
}

func TestSyncPreservesUnexpectedBytesInSignedV2State(t *testing.T) {
	l := fixture(t)
	m := mod(t, l, "a", map[string]string{"BepInEx/plugins/a.dll": "payload"})
	syncMods(t, l, m)
	path := l.Paths().Deployment
	state, err := LoadState(l)
	must(t, err)
	before, err := os.ReadFile(path)
	must(t, err)
	untrusted := append(before, []byte("\n# external edit must stay untouched\n")...)
	f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0600)
	must(t, err)
	_, err = f.Write(untrusted[len(before):])
	must(t, err)
	must(t, f.Close())

	code(t, SaveState(l, state), models.FileCollision)
	_, err = Sync(context.Background(), l, []models.Mod{m}, nil)
	code(t, err, models.FileCollision)
	content(t, path, string(untrusted))
	content(t, filepath.Join(l.GameRoot, "BepInEx/plugins/a.dll"), "payload")
}

func TestEmptyPlanStateRemainsCanonicalAfterClearingDeployment(t *testing.T) {
	l := fixture(t)
	m := mod(t, l, "a", map[string]string{"BepInEx/plugins/a.dll": "payload"})
	syncMods(t, l, m)
	must(t, Deploy(l, DeploymentPlan{}))
	state, err := LoadState(l)
	must(t, err)
	if len(state.Artifacts) != 0 {
		t.Fatal("cleared deployment retained artifacts")
	}
}
