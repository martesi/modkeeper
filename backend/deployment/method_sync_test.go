package deployment

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/martes/modkeeper/backend/linker"
	"github.com/martes/modkeeper/backend/models"
)

func TestSyncUsesSelectedDeploymentMethod(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("native Linux consumer fixture")
	}
	for _, test := range []struct {
		name   string
		method models.DeploymentMethod
		kind   linker.ArtifactKind
	}{
		{name: "copy", method: models.DeploymentMethodCopy, kind: linker.Copy},
		{name: "link", method: models.DeploymentMethodLink, kind: linker.Symlink},
	} {
		t.Run(test.name, func(t *testing.T) {
			l := fixture(t)
			m := mod(t, l, "enabled", map[string]string{"SPT/user/mods/Sentinel/file.txt": "sentinel"})
			unrelated := filepath.Join(l.GameRoot, "unrelated-user-file.txt")
			write(t, unrelated, "keep")
			if _, err := SyncWithMethod(context.Background(), l, []models.Mod{m}, test.method, nil); err != nil {
				t.Fatal(err)
			}
			target := filepath.Join(l.GameRoot, "SPT/user/mods/Sentinel/file.txt")
			content(t, target, "sentinel")
			content(t, unrelated, "keep")
			source := filepath.Join(l.Paths().Mods, "enabled/SPT/user/mods/Sentinel/file.txt")
			content(t, source, "sentinel")
			state, err := LoadState(l)
			must(t, err)
			if len(state.Artifacts) != 1 || state.Artifacts[0].Kind != test.kind || state.Method != test.method || state.TargetRuntime != models.TargetLinux {
				t.Fatalf("deployment state = %#v, want Linux runtime, method %q, and artifact kind %q", state, test.method, test.kind)
			}
			deployedArtifact := filepath.Join(l.GameRoot, state.Artifacts[0].Target)
			info, err := os.Lstat(deployedArtifact)
			must(t, err)
			if test.kind == linker.Symlink && info.Mode()&os.ModeSymlink == 0 {
				t.Fatalf("deployed artifact is not a symlink: %s", deployedArtifact)
			}
			if test.kind == linker.Copy && !info.Mode().IsRegular() {
				t.Fatalf("deployed artifact is not a regular copy: %s", deployedArtifact)
			}
		})
	}
}

func TestSyncCanSwitchCopyDeploymentToLink(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("native Linux consumer fixture")
	}
	l := fixture(t)
	m := mod(t, l, "enabled", map[string]string{"BepInEx/plugins/FixtureMod/fixture.dll": "fixture payload"})
	if _, err := SyncWithMethod(context.Background(), l, []models.Mod{m}, models.DeploymentMethodCopy, nil); err != nil {
		t.Fatal(err)
	}
	userFile := filepath.Join(l.GameRoot, "BepInEx/plugins/FixtureMod/user.txt")
	write(t, userFile, "preserve me")
	if _, err := SyncWithMethod(context.Background(), l, []models.Mod{m}, models.DeploymentMethodLink, nil); err == nil {
		t.Fatal("switch to Link succeeded despite an untracked file in the owned directory")
	} else {
		code(t, err, models.FileCollision)
	}
	content(t, userFile, "preserve me")
	content(t, filepath.Join(l.GameRoot, "BepInEx/plugins/FixtureMod/fixture.dll"), "fixture payload")
	must(t, os.Remove(userFile))
	if _, err := SyncWithMethod(context.Background(), l, []models.Mod{m}, models.DeploymentMethodLink, nil); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(l.GameRoot, "BepInEx/plugins/FixtureMod")
	info, err := os.Lstat(target)
	must(t, err)
	if info.Mode()&os.ModeSymlink == 0 {
		t.Fatalf("deployed mod directory is not a symlink: %s", target)
	}
	content(t, filepath.Join(target, "fixture.dll"), "fixture payload")
}

func TestLegacySyncPersistsCopyFirstCompatibilityPolicy(t *testing.T) {
	l := fixture(t)
	m := mod(t, l, "enabled", map[string]string{"SPT/user/mods/Sentinel/file.txt": "sentinel"})
	if _, err := Sync(context.Background(), l, []models.Mod{m}, nil); err != nil {
		t.Fatal(err)
	}
	state, err := LoadState(l)
	must(t, err)
	if state.Method != models.DeploymentMethodCopyFirst || state.TargetRuntime != models.TargetWindows {
		t.Fatalf("legacy Sync policy = %s/%s", state.TargetRuntime, state.Method)
	}
	content(t, filepath.Join(l.GameRoot, "SPT/user/mods/Sentinel/file.txt"), "sentinel")
}
