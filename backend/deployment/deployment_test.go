package deployment

import (
	"context"
	"errors"
	"github.com/martes/modkeeper/backend/linker"
	"github.com/martes/modkeeper/backend/models"
	"github.com/martes/modkeeper/backend/spt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func fixture(t *testing.T) Layout {
	t.Helper()
	root := t.TempDir()
	l := Layout{LibraryRoot: filepath.Join(root, "repo"), GameRoot: filepath.Join(root, "game")}
	for _, p := range []string{l.LibraryRoot, l.GameRoot, l.Paths().Mods, l.Paths().Staging, l.Paths().Backups} {
		must(t, os.MkdirAll(p, 0755))
	}
	var e error
	l.Rules, e = spt.Discover(l.GameRoot)
	must(t, e)
	return l
}
func must(t *testing.T, e error) {
	t.Helper()
	if e != nil {
		t.Fatal(e)
	}
}
func write(t *testing.T, p, data string) {
	t.Helper()
	must(t, os.MkdirAll(filepath.Dir(p), 0755))
	must(t, os.WriteFile(p, []byte(data), 0644))
}
func mod(t *testing.T, l Layout, id string, files map[string]string) models.Mod {
	t.Helper()
	for p, data := range files {
		write(t, filepath.Join(l.Paths().Mods, id, p), data)
	}
	return models.Mod{ID: id, Enabled: true}
}
func syncMods(t *testing.T, l Layout, mods ...models.Mod) {
	t.Helper()
	_, e := Sync(context.Background(), l, mods, nil)
	must(t, e)
}
func absent(t *testing.T, p string) {
	t.Helper()
	if _, e := os.Lstat(p); !os.IsNotExist(e) {
		t.Fatalf("expected absent %s: %v", p, e)
	}
}
func content(t *testing.T, p, want string) {
	t.Helper()
	b, e := os.ReadFile(p)
	must(t, e)
	if string(b) != want {
		t.Fatalf("%s = %q, want %q", p, b, want)
	}
}
func code(t *testing.T, e error, want string) {
	t.Helper()
	var got *Error
	if !errors.As(e, &got) || got.Code != want {
		t.Fatalf("error %v, want %s", e, want)
	}
}
func TestTestCollisionDetection(t *testing.T) {
	l := fixture(t)
	a := mod(t, l, "a", map[string]string{"BepInEx/plugins/conflict.dll": "a"})
	b := mod(t, l, "b", map[string]string{"BepInEx/plugins/conflict.dll": "b"})
	_, e := Plan([]models.Mod{a, b}, l)
	code(t, e, "FileCollision")
	absent(t, filepath.Join(l.GameRoot, "BepInEx"))
}
func testRecursiveLinkingLogic(t *testing.T) {
	l := fixture(t)
	a := mod(t, l, "a", map[string]string{"SPT/user/mods/CommonDir/A.txt": "a"})
	b := mod(t, l, "b", map[string]string{"SPT/user/mods/CommonDir/B.txt": "b"})
	p, e := PlanWithKinds([]models.Mod{a, b}, l, linker.Symlink, linker.Symlink)
	must(t, e)
	must(t, Deploy(l, p))
	for _, name := range []string{"A.txt", "B.txt"} {
		info, e := os.Lstat(filepath.Join(l.GameRoot, "SPT/user/mods/CommonDir", name))
		must(t, e)
		if info.Mode()&os.ModeSymlink == 0 {
			t.Fatal("expected file links in shared real directory")
		}
	}
}
func TestTestPurgeRemovesDeactivatedMods(t *testing.T) {
	l := fixture(t)
	m := mod(t, l, "a", map[string]string{"SPT/user/mods/A/file": "a"})
	syncMods(t, l, m)
	m.Enabled = false
	syncMods(t, l, m)
	absent(t, filepath.Join(l.GameRoot, "SPT/user/mods/A"))
	content(t, filepath.Join(l.Paths().Mods, "a/SPT/user/mods/A/file"), "a")
	s, e := LoadState(l)
	must(t, e)
	if len(s.Artifacts) != 0 {
		t.Fatal(s)
	}
}
func testCopyDeploymentReusesOwnedDirectoriesAndNormalizesLegacyPaths(t *testing.T) {
	l := fixture(t)
	m := mod(t, l, "a", map[string]string{"SPT/user/mods/A/file": "a"})
	syncMods(t, l, m)
	syncMods(t, l, m)
	s, e := LoadState(l)
	must(t, e)
	if len(s.CreatedDirs) == 0 {
		t.Fatal("ownership lost")
	}
	for i, p := range s.CreatedDirs {
		s.CreatedDirs[i] = filepath.Join(l.GameRoot, p)
	}
	must(t, SaveState(l, s))
	syncMods(t, l, m)
	s, e = LoadState(l)
	must(t, e)
	for _, p := range s.CreatedDirs {
		if filepath.IsAbs(p) {
			t.Fatal(p)
		}
	}
}
func testLegacyCopyDeploymentFingerprintsAreMigratedOnLoad(t *testing.T) {
	l := fixture(t)
	m := mod(t, l, "a", map[string]string{"SPT/user/mods/A/file": "a"})
	syncMods(t, l, m)
	s, e := LoadState(l)
	must(t, e)
	for i := range s.Artifacts {
		s.Artifacts[i].Fingerprint = nil
	}
	must(t, SaveState(l, s))
	s, e = LoadState(l)
	must(t, e)
	for _, a := range s.Artifacts {
		if a.Fingerprint == nil || len(*a.Fingerprint) != 64 {
			t.Fatal(a)
		}
	}
	syncMods(t, l, m)
}
func testCopyDeploymentMergesIntoExistingGameDirectory(t *testing.T) {
	l := fixture(t)
	write(t, filepath.Join(l.GameRoot, "EscapeFromTarkov_Data/Managed/game.dll"), "game")
	m := mod(t, l, "a", map[string]string{"SPT/user/mods/A/file": "a", "EscapeFromTarkov_Data/Managed/mod.dll": "mod"})
	syncMods(t, l, m)
	syncMods(t, l, m)
	content(t, filepath.Join(l.GameRoot, "EscapeFromTarkov_Data/Managed/game.dll"), "game")
	s, e := LoadState(l)
	must(t, e)
	for _, d := range s.CreatedDirs {
		if d == "EscapeFromTarkov_Data" {
			t.Fatal("claimed existing game directory")
		}
	}
}
func testUnownedDeploymentTargetIsPreservedAndBlocksSync(t *testing.T) {
	l := fixture(t)
	m := mod(t, l, "a", map[string]string{"SPT/user/mods/A/file": "a"})
	write(t, filepath.Join(l.GameRoot, "SPT/user/mods/A/keep"), "user")
	_, e := Sync(context.Background(), l, []models.Mod{m}, nil)
	code(t, e, "FileCollision")
	content(t, filepath.Join(l.GameRoot, "SPT/user/mods/A/keep"), "user")
}
func testUntrackedFileSafetyInSharedFolder(t *testing.T) {
	l := fixture(t)
	a := mod(t, l, "a", map[string]string{"BepInEx/plugins/SharedDir/a.dll": "a"})
	b := mod(t, l, "b", map[string]string{"BepInEx/plugins/SharedDir/b.dll": "b"})
	syncMods(t, l, a, b)
	write(t, filepath.Join(l.GameRoot, "BepInEx/plugins/SharedDir/notes"), "user")
	a.Enabled = false
	b.Enabled = false
	syncMods(t, l, a, b)
	content(t, filepath.Join(l.GameRoot, "BepInEx/plugins/SharedDir/notes"), "user")
	absent(t, filepath.Join(l.GameRoot, "BepInEx/plugins/SharedDir/a.dll"))
}
func TestTestUpgradeSuccessLeavesNoSnapshot(t *testing.T) {
	l := fixture(t)
	m := mod(t, l, "a", map[string]string{"SPT/user/mods/A/file": "v1"})
	syncMods(t, l, m)
	write(t, filepath.Join(l.Paths().Mods, "a/SPT/user/mods/A/file"), "v2")
	syncMods(t, l, m)
	content(t, filepath.Join(l.GameRoot, "SPT/user/mods/A/file"), "v2")
	absent(t, filepath.Join(l.Paths().Backups, "a"))
}
func testUpdatingADeployedModRefreshesAndRemovalUnlinksStaleCopies(t *testing.T) {
	l := fixture(t)
	m := mod(t, l, "a", map[string]string{"SPT/user/mods/A/file": "v1"})
	syncMods(t, l, m)
	target := filepath.Join(l.GameRoot, "SPT/user/mods/A/file")
	write(t, target, "user")
	_, e := Sync(context.Background(), l, []models.Mod{m}, nil)
	code(t, e, "FileCollision")
	content(t, target, "user")
	write(t, target, "v1")
	write(t, filepath.Join(l.Paths().Mods, "a/SPT/user/mods/A/file"), "v2")
	stale, e := DeployStale(l, []models.Mod{m})
	must(t, e)
	if !stale {
		t.Fatal("updated copy not stale")
	}
	syncMods(t, l, m)
	content(t, target, "v2")
	syncMods(t, l)
	absent(t, target)
}
func testSyncPreflightsChangedRemovalsBeforePurgingRecordedLinks(t *testing.T) {
	l := fixture(t)
	a := mod(t, l, "a", map[string]string{"SPT/user/mods/Keep/file": "a"})
	b := mod(t, l, "b", map[string]string{"SPT/user/mods/Drop/file": "b"})
	syncMods(t, l, a, b)
	s, e := LoadState(l)
	must(t, e)
	for i := range s.Artifacts {
		if strings.Contains(s.Artifacts[i].Target, "Keep") {
			x := &s.Artifacts[i]
			p := filepath.Join(l.GameRoot, x.Target)
			must(t, os.Remove(p))
			must(t, os.Symlink(filepath.Join(l.LibraryRoot, x.Source), p))
			x.Kind = linker.Symlink
			x.Fingerprint = nil
		}
	}
	must(t, SaveState(l, s))
	write(t, filepath.Join(l.GameRoot, "SPT/user/mods/Drop/file"), "user")
	b.Enabled = false
	_, e = Sync(context.Background(), l, []models.Mod{a, b}, nil)
	code(t, e, "FileCollision")
	info, e := os.Lstat(filepath.Join(l.GameRoot, "SPT/user/mods/Keep/file"))
	must(t, e)
	if info.Mode()&os.ModeSymlink == 0 {
		t.Fatal("purged before preflight")
	}
}
func TestRemovingAModRefusesADeploymentPathRedirectedWithinTheGameRoot(t *testing.T) {
	l := fixture(t)
	m := mod(t, l, "a", map[string]string{"SPT/user/mods/A/file": "a"})
	syncMods(t, l, m)
	p := filepath.Join(l.GameRoot, "SPT/user/mods/A")
	must(t, os.Rename(p, p+"-old"))
	other := filepath.Join(l.GameRoot, "other")
	write(t, filepath.Join(other, "file"), "foreign")
	must(t, os.Symlink(other, p))
	mustCollisionPreflight(t, l)
	content(t, filepath.Join(other, "file"), "foreign")
}
func mustCollisionPreflight(t *testing.T, l Layout) {
	t.Helper()
	code(t, Preflight(l, DeploymentPlan{}), "FileCollision")
}
func testSyncRefusesRedirectedRecordedDirectoriesWhenArtifactsAreMissing(t *testing.T) {
	l := fixture(t)
	m := mod(t, l, "a", map[string]string{"SPT/user/mods/A/Nested/file": "a"})
	syncMods(t, l, m)
	s, e := LoadState(l)
	must(t, e)
	s.Artifacts = nil
	must(t, SaveState(l, s))
	p := filepath.Join(l.GameRoot, "SPT/user/mods/A")
	must(t, os.Rename(p, p+"-old"))
	outside := t.TempDir()
	must(t, os.Symlink(outside, p))
	mustCollisionPreflight(t, l)
}
func TestDurableRustRecordsRoundTrip(t *testing.T) {
	l := fixture(t)
	c := Cache{map[string]CachedMod{"a": {ID: "a", ModType: "server", Files: []string{"SPT/user/mods/A/file"}, Executables: []string{}}}}
	must(t, SaveCache(l, c))
	loaded, e := LoadCache(l)
	must(t, e)
	if loaded.Mods["a"].ModType != "server" {
		t.Fatal(loaded)
	}
	data, e := os.ReadFile(l.Paths().Cache)
	must(t, e)
	if !strings.Contains(string(data), "modType =") {
		t.Fatal(string(data))
	}
	m := mod(t, l, "a", map[string]string{"SPT/user/mods/A/file": "a"})
	syncMods(t, l, m)
	data, e = os.ReadFile(l.Paths().Deployment)
	must(t, e)
	if !strings.Contains(string(data), "created_dirs =") || !strings.Contains(string(data), "fingerprint =") {
		t.Fatal(string(data))
	}
}
func TestRuntimeTargetResolution(t *testing.T) {
	l := fixture(t)
	l.Rules.ServerExe = "SPT_Runtime/SPT.Server.exe"
	l.Rules.ServerMods = "SPT_Runtime/user/mods"
	m := mod(t, l, "a", map[string]string{"SPT/user/mods/A/file": "a"})
	syncMods(t, l, m)
	content(t, filepath.Join(l.GameRoot, "SPT_Runtime/user/mods/A/file"), "a")
	absent(t, filepath.Join(l.GameRoot, "SPT/user/mods/A/file"))
}
