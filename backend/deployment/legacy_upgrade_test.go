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
			path := l.Paths().Deployment
			write(t, path, legacy)
			m := mod(t, l, "new", map[string]string{"BepInEx/plugins/new.dll": "new payload"})
			_, err := Sync(context.Background(), l, []models.Mod{m}, nil)
			must(t, err)
			content(t, path+".pre-recovery", legacy)
			content(t, filepath.Join(l.GameRoot, "BepInEx/plugins/new.dll"), "new payload")
			if _, err := os.Stat(oldDir); err != nil {
				t.Fatalf("legacy directory changed: %v", err)
			}
			must(t, releasePinsForMissingLibrary(l))
			_, err = Sync(context.Background(), l, []models.Mod{m}, nil)
			must(t, err)
			content(t, path+".pre-recovery", legacy)
		})
	}
}

func TestSyncLeavesExistingLegacyArtifactsAndRecordUntouched(t *testing.T) {
	l := fixture(t)
	target := filepath.Join(l.GameRoot, "BepInEx", "plugins", "a.dll")
	write(t, target, "same bytes")
	path := l.Paths().Deployment
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
	absent(t, path+".pre-recovery")
	absent(t, l.Paths().SyncIntent)
}

func TestSyncDoesNotOverwriteExistingLegacyArchive(t *testing.T) {
	l := fixture(t)
	path := l.Paths().Deployment
	legacy := "artifacts = []\ncreated_dirs = []\n"
	write(t, path, legacy)
	write(t, path+".pre-recovery", "keep me")
	m := mod(t, l, "a", map[string]string{"BepInEx/plugins/a.dll": "payload"})
	_, err := Sync(context.Background(), l, []models.Mod{m}, nil)
	code(t, err, models.IOError)
	content(t, path, legacy)
	content(t, path+".pre-recovery", "keep me")
	absent(t, l.Paths().SyncIntent)
}
