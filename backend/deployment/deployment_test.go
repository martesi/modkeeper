package deployment

import (
	"context"
	"errors"
	"github.com/martes/modkeeper/backend/linker"
	"github.com/martes/modkeeper/backend/models"
	"github.com/martes/modkeeper/backend/spt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func fixture(t *testing.T) Layout {
	t.Helper()
	root := t.TempDir()
	l := Layout{LibraryRoot: filepath.Join(root, "repo"), GameRoot: filepath.Join(root, "game")}
	t.Cleanup(func() {
		if err := releasePinsForMissingLibrary(l); err != nil {
			t.Errorf("release live deployment state: %v", err)
		}
	})
	for _, p := range []string{l.LibraryRoot, l.GameRoot, l.Paths().Mods, l.Paths().Staging, l.Paths().Backups} {
		must(t, os.MkdirAll(p, 0755))
	}
	var e error
	l.Rules, e = spt.Discover(l.GameRoot)
	must(t, e)
	return l
}

func TestCloseLiveDeploymentStatesClosesPinnedFiles(t *testing.T) {
	l := fixture(t)
	l.LibraryRoot = filepath.Join(t.TempDir(), "alternate-library")
	must(t, os.MkdirAll(l.LibraryRoot, 0755))
	t.Cleanup(func() {
		if err := releaseLiveDeploymentState(l); err != nil {
			t.Errorf("release live deployment state: %v", err)
		}
	})
	if err := saveState(l, DeploymentState{Artifacts: []DeploymentArtifact{}, CreatedDirs: []string{}}); err != nil {
		t.Fatal(err)
	}
	if err := CloseLiveDeploymentStates(); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(l.Paths().Deployment); err != nil {
		t.Fatalf("remove state file after releasing its live pin: %v", err)
	}
}

func TestReleaseLibraryPinsIsScopedAndKeepsOtherLibraryPins(t *testing.T) {
	first := fixture(t)
	second := fixture(t)
	firstMod := mod(t, first, "first", map[string]string{"BepInEx/plugins/first.dll": "first"})
	secondMod := mod(t, second, "second", map[string]string{"BepInEx/plugins/second.dll": "second"})
	syncMods(t, first, firstMod)
	syncMods(t, second, secondMod)
	if err := ReleaseLibraryPins(first); err != nil {
		t.Fatal(err)
	}
	if owned, err := verifyLiveDeploymentState(first); err != nil || owned {
		t.Fatalf("released state ownership = (%v, %v), want false", owned, err)
	}
	if owned, err := verifyLiveDeploymentState(second); err != nil || !owned {
		t.Fatalf("other library state ownership = (%v, %v), want true", owned, err)
	}
	if owned, err := liveObjectMatches(first, DeploymentArtifact{Target: "BepInEx/plugins/first.dll"}, filepath.Join(first.GameRoot, "BepInEx/plugins/first.dll")); err != nil || owned {
		t.Fatalf("released artifact pin = (%v, %v), want false", owned, err)
	}
	if owned, err := liveObjectMatches(second, DeploymentArtifact{Target: "BepInEx/plugins/second.dll"}, filepath.Join(second.GameRoot, "BepInEx/plugins/second.dll")); err != nil || !owned {
		t.Fatalf("other artifact pin = (%v, %v), want true", owned, err)
	}
	if liveSyncJournalFor(first.Paths().SyncIntent) != nil {
		t.Fatal("released library retained a journal pin")
	}
	if liveSyncJournalFor(second.Paths().SyncIntent) == nil {
		t.Fatal("release closed another library's journal pin")
	}
	if err := ReleaseLibraryPins(second); err != nil {
		t.Fatal(err)
	}
}

func TestReleaseLibraryPinsRefusesAnActiveSyncTransaction(t *testing.T) {
	l := fixture(t)
	m := mod(t, l, "active", map[string]string{"BepInEx/plugins/active.dll": "payload"})
	_, err := syncWithHooks(context.Background(), l, []models.Mod{m}, nil, nil, func(boundary string) error {
		if boundary == "pre-publication" {
			return errors.New("interrupt before publication")
		}
		return nil
	})
	if err == nil {
		t.Fatal("interrupted Sync unexpectedly succeeded")
	}
	if err := ReleaseLibraryPins(l); err == nil {
		t.Fatal("released pins while a Sync transaction was pending")
	}
	if liveSyncJournalFor(l.Paths().SyncIntent) == nil {
		t.Fatal("pending transaction journal pin was released")
	}
	key := syncJournalKey(l.Paths().SyncIntent)
	liveSyncJournals.Lock()
	journal := liveSyncJournals.byPath[key]
	delete(liveSyncJournals.byPath, key)
	liveSyncJournals.Unlock()
	if journal != nil {
		if err := journal.object.close(); err != nil {
			t.Error(err)
		}
		if err := journal.file.Close(); err != nil {
			t.Error(err)
		}
	}
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
	var got *models.Error
	if !errors.As(e, &got) || got.Code != want {
		t.Fatalf("error %v, want %s", e, want)
	}
}
func TestCollisionDetection(t *testing.T) {
	l := fixture(t)
	a := mod(t, l, "a", map[string]string{"BepInEx/plugins/conflict.dll": "a"})
	b := mod(t, l, "b", map[string]string{"BepInEx/plugins/conflict.dll": "b"})
	_, e := Plan([]models.Mod{a, b}, l)
	code(t, e, "FileCollision")
	absent(t, filepath.Join(l.GameRoot, "BepInEx"))
}
func testRecursiveDeploymentLogic(t *testing.T) {
	l := fixture(t)
	a := mod(t, l, "a", map[string]string{"SPT/user/mods/CommonDir/A.txt": "a"})
	b := mod(t, l, "b", map[string]string{"SPT/user/mods/CommonDir/B.txt": "b"})
	p, e := PlanWithKinds([]models.Mod{a, b}, l, linker.Copy, linker.Copy)
	must(t, e)
	must(t, Deploy(l, p))
	for _, name := range []string{"A.txt", "B.txt"} {
		info, e := os.Lstat(filepath.Join(l.GameRoot, "SPT/user/mods/CommonDir", name))
		must(t, e)
		if info.Mode()&os.ModeSymlink != 0 {
			t.Fatal("copy deployment unexpectedly created a symlink")
		}
	}
}

func TestDeploymentPublishesSymlinkWithoutReplacingTargets(t *testing.T) {
	l := fixture(t)
	m := mod(t, l, "a", map[string]string{"SPT/user/mods/A/file": "source"})
	plan, err := PlanWithKinds([]models.Mod{m}, l, linker.Symlink, linker.Symlink)
	must(t, err)
	must(t, Deploy(l, plan))
	target := filepath.Join(l.GameRoot, "SPT/user/mods/A")
	if info, err := os.Lstat(target); err != nil || info.Mode()&os.ModeSymlink == 0 {
		t.Fatalf("target is not a published symlink: info=%v err=%v", info, err)
	}
	content(t, filepath.Join(target, "file"), "source")
}

func TestRuntimeProbeSelectsOnlySafePublicationKinds(t *testing.T) {
	l := fixture(t)
	fileKind, directoryKind, err := probeMethods(l)
	must(t, err)
	if fileKind != linker.Copy && fileKind != linker.Hardlink {
		t.Fatalf("file probe selected unsafe publication kind %q", fileKind)
	}
	if directoryKind != linker.Copy {
		t.Fatalf("directory probe selected unsupported publication kind %q", directoryKind)
	}
}
func TestPurgeRemovesDeactivatedMods(t *testing.T) {
	l := fixture(t)
	m := mod(t, l, "a", map[string]string{"SPT/user/mods/A/file": "a"})
	syncMods(t, l, m)
	m.Enabled = false
	syncMods(t, l, m)
	modDir := filepath.Join(l.GameRoot, "SPT/user/mods/A")
	entries, err := os.ReadDir(modDir)
	if err != nil && !os.IsNotExist(err) {
		t.Fatal(err)
	}
	if err == nil && len(entries) != 0 {
		t.Fatalf("deactivated mod directory is not empty: %v", entries)
	}
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
func testLegacyCopyDeploymentFingerprintsAreNotAdoptedOnLoad(t *testing.T) {
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
		if a.Fingerprint != nil {
			t.Fatalf("legacy copy was adopted from matching bytes: %#v", a)
		}
	}
	_, e = Sync(context.Background(), l, []models.Mod{m}, nil)
	code(t, e, "FileCollision")
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

func TestSameByteReplacementIsNotAdoptedByRecordedDeploymentState(t *testing.T) {
	l := fixture(t)
	m := mod(t, l, "a", map[string]string{"BepInEx/plugins/a.dll": "identical bytes"})
	syncMods(t, l, m)
	target := filepath.Join(l.GameRoot, "BepInEx/plugins/a.dll")
	stateBefore, err := os.ReadFile(l.Paths().Deployment)
	must(t, err)
	must(t, os.Remove(target))
	write(t, target, "identical bytes")
	_, err = Sync(context.Background(), l, []models.Mod{m}, nil)
	code(t, err, "FileCollision")
	content(t, target, "identical bytes")
	stateAfter, err := os.ReadFile(l.Paths().Deployment)
	must(t, err)
	if string(stateAfter) != string(stateBefore) {
		t.Fatal("same-byte replacement changed persisted deployment state")
	}
}

func TestLiveOwnershipPinRejectsSameAndDifferentByteMetadataClones(t *testing.T) {
	for _, replacement := range []string{"original bytes", "different bytes"} {
		t.Run(replacement, func(t *testing.T) {
			l := fixture(t)
			m := mod(t, l, "a", map[string]string{"BepInEx/plugins/a.dll": "original bytes"})
			syncMods(t, l, m)
			target := filepath.Join(l.GameRoot, "BepInEx/plugins/a.dll")
			originalInfo, err := os.Stat(target)
			must(t, err)
			stateBefore, err := os.ReadFile(l.Paths().Deployment)
			must(t, err)
			must(t, os.Remove(target))
			write(t, target, replacement)
			must(t, os.Chmod(target, originalInfo.Mode().Perm()))
			must(t, os.Chtimes(target, originalInfo.ModTime(), originalInfo.ModTime()))

			_, err = Sync(context.Background(), l, []models.Mod{m}, nil)
			code(t, err, "FileCollision")
			content(t, target, replacement)
			stateAfter, err := os.ReadFile(l.Paths().Deployment)
			must(t, err)
			if string(stateAfter) != string(stateBefore) {
				t.Fatal("replacement changed deployment state")
			}
		})
	}
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
func TestUpgradeSuccessLeavesNoSnapshot(t *testing.T) {
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
	forgetLiveArtifact(l, "SPT/user/mods/A/file")
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
	for _, artifact := range s.Artifacts {
		forgetLiveArtifact(l, artifact.Target)
	}
	s.Artifacts = nil
	must(t, SaveState(l, s))
	p := filepath.Join(l.GameRoot, "SPT/user/mods/A")
	must(t, releaseLiveArtifactsForLibrary(l))
	must(t, os.Rename(p, p+"-old"))
	outside := t.TempDir()
	must(t, os.Symlink(outside, p))
	mustCollisionPreflight(t, l)
}
func TestDurableRecordsRoundTrip(t *testing.T) {
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

func TestWindowsReconcilesLegacyBackslashCopyState(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("legacy native-separator state is Windows-specific")
	}
	l := fixture(t)
	m := mod(t, l, "a", map[string]string{"SPT/user/mods/A/file": "owned"})
	plan, err := PlanWithKinds([]models.Mod{m}, l, linker.Copy, linker.Copy)
	must(t, err)
	must(t, Deploy(l, plan))

	state, err := LoadState(l)
	must(t, err)
	if len(state.CreatedDirs) == 0 {
		t.Fatal("expected the copy deployment to record created directories")
	}
	for i := range state.Artifacts {
		state.Artifacts[i].Target = filepath.FromSlash(state.Artifacts[i].Target)
		state.Artifacts[i].Source = filepath.FromSlash(state.Artifacts[i].Source)
	}
	for i := range state.CreatedDirs {
		state.CreatedDirs[i] = filepath.FromSlash(state.CreatedDirs[i])
	}
	legacyDirs := append([]string(nil), state.CreatedDirs...)
	if !strings.Contains(strings.Join(legacyDirs, ""), `\`) {
		t.Fatalf("expected native backslashes in legacy directories: %#v", legacyDirs)
	}
	must(t, SaveState(l, state))

	target := filepath.Join(l.GameRoot, filepath.FromSlash(plan.Artifacts[0].Target))
	write(t, target, "foreign replacement")
	code(t, Preflight(l, plan), "FileCollision")
	content(t, target, "foreign replacement")
	write(t, target, "owned")
	must(t, Preflight(l, plan))
	must(t, Deploy(l, plan))
	content(t, target, "owned")
	state, err = LoadState(l)
	must(t, err)
	for _, legacyDir := range legacyDirs {
		if !containsPath(state.CreatedDirs, legacyDir) {
			t.Fatalf("created directory %q was lost after reconciliation: %#v", legacyDir, state.CreatedDirs)
		}
		if _, err := os.Stat(filepath.Join(l.GameRoot, legacyDir)); err != nil {
			t.Fatalf("created directory %q disappeared: %v", legacyDir, err)
		}
	}

	wantForeign := "do not adopt"
	write(t, target, wantForeign)
	code(t, Preflight(l, plan), "FileCollision")
	content(t, target, wantForeign)

	state, err = LoadState(l)
	must(t, err)
	for i := range state.Artifacts {
		state.Artifacts[i].Target = filepath.FromSlash(state.Artifacts[i].Target)
		state.Artifacts[i].Source = filepath.FromSlash(state.Artifacts[i].Source)
	}
	for i := range state.CreatedDirs {
		state.CreatedDirs[i] = filepath.FromSlash(state.CreatedDirs[i])
	}
	// Restore the known bytes before sealing the legacy-path record. Saving
	// while the contents are foreign correctly drops the artifact's receipt.
	write(t, target, "owned")
	must(t, SaveState(l, state))
	// No live directory identity survives a restart of a legacy deployment.
	must(t, releaseLiveArtifactsForLibrary(l))
	state, err = LoadState(l)
	must(t, err)
	if !verifyOwnershipReceipt(l, state.Artifacts[0], target) {
		t.Fatal("legacy-path copy did not retain valid durable ownership")
	}
	must(t, Deploy(l, DeploymentPlan{}))
	absent(t, target)
	state, err = LoadState(l)
	must(t, err)
	if len(state.Artifacts) != 0 || len(state.CreatedDirs) != 0 {
		t.Fatalf("cleanup retained deployment ownership: %+v", state)
	}
	leafDir := filepath.Dir(filepath.FromSlash(plan.Artifacts[0].Target))
	if !containsPath(legacyDirs, leafDir) {
		t.Fatalf("expected created leaf directory %q in legacy records: %#v", leafDir, legacyDirs)
	}
	if info, err := os.Lstat(filepath.Join(l.GameRoot, leafDir)); err != nil || !info.IsDir() {
		t.Fatalf("ambiguous empty directory was not preserved after cleanup: %q (%v)", leafDir, err)
	}
}

func TestPreflightRefusesRecordedDanglingLink(t *testing.T) {
	l, root, _ := purgeFixture(t)
	source := filepath.Join(l.Paths().Mods, "a", "SPT", "user", "mods", "A", "file")
	write(t, source, "library source")
	link := filepath.Join(root, "A", "file")
	must(t, os.MkdirAll(filepath.Dir(link), 0755))
	danglingTarget := filepath.Join(t.TempDir(), "missing-target")
	must(t, os.Symlink(danglingTarget, link))
	must(t, SaveState(l, DeploymentState{
		Artifacts: []DeploymentArtifact{{
			Target: filepath.ToSlash(filepath.Join(l.Rules.ServerMods, "A", "file")),
			Source: filepath.ToSlash(filepath.Join("a", "SPT", "user", "mods", "A", "file")),
			Kind:   linker.Symlink,
		}},
		CreatedDirs: []string{filepath.ToSlash(filepath.Join(l.Rules.ServerMods, "A"))},
	}))

	code(t, Preflight(l, DeploymentPlan{}), "FileCollision")
	must(t, Purge(l, nil))
	got, err := os.Readlink(link)
	must(t, err)
	if got != danglingTarget {
		t.Fatalf("dangling link target changed: got %q, want %q", got, danglingTarget)
	}
	absent(t, danglingTarget)
}

func TestDeployRefusesUnrecordedDanglingLink(t *testing.T) {
	l := fixture(t)
	m := mod(t, l, "a", map[string]string{"SPT/user/mods/A/file": "library"})
	plan, err := PlanWithKinds([]models.Mod{m}, l, linker.Copy, linker.Copy)
	must(t, err)
	target := filepath.Join(l.GameRoot, filepath.FromSlash(plan.Artifacts[0].Target))
	must(t, os.MkdirAll(filepath.Dir(target), 0755))
	danglingTarget := filepath.Join(t.TempDir(), "missing-target")
	must(t, os.Symlink(danglingTarget, target))

	if runtime.GOOS == "windows" {
		if _, err := os.Lstat(target); err == nil {
			t.Skip("Windows Lstat exposes dangling links directly")
		} else if !os.IsNotExist(err) {
			t.Fatalf("stat dangling Windows link: %v", err)
		}
		if !isLink(target) {
			t.Fatal("Readlink fallback did not detect the dangling Windows link")
		}
		info, kind, err := inspectLink(target)
		if err != nil || info == nil || kind != linker.Symlink {
			t.Fatalf("reparse-point inspection = (%v, %q, %v), want a symlink", info, kind, err)
		}
	}
	code(t, ensureAbsentTarget(target, plan.Artifacts[0].Target), "FileCollision")
	code(t, Deploy(l, plan), "FileCollision")
	got, err := os.Readlink(target)
	must(t, err)
	if got != danglingTarget {
		t.Fatalf("dangling link changed: got %q, want %q", got, danglingTarget)
	}
}

func TestSyncPostPreflightCollisionPreservesExistingDeploymentAndState(t *testing.T) {
	l := fixture(t)
	oldMod := mod(t, l, "old", map[string]string{"SPT/user/mods/Old/file.dll": "old contents"})
	syncMods(t, l, oldMod)
	oldTarget := filepath.Join(l.GameRoot, "SPT/user/mods/Old/file.dll")
	state, err := LoadState(l)
	must(t, err)
	if len(state.Artifacts) == 0 || len(state.CreatedDirs) == 0 {
		t.Fatalf("initial Sync did not record an artifact and created directories: %+v", state)
	}
	stateBefore, err := os.ReadFile(l.Paths().Deployment)
	must(t, err)
	compatSource := filepath.Join(l.Paths().Mods, "legacy", "compat.txt")
	write(t, compatSource, "legacy source")
	compatLink := filepath.Join(l.GameRoot, "SPT/user/mods/Legacy/compat.txt")
	must(t, os.MkdirAll(filepath.Dir(compatLink), 0755))
	must(t, os.Symlink(compatSource, compatLink))
	newMod := mod(t, l, "new", map[string]string{"SPT/user/mods/New/file.dll": "new contents"})
	foreignTarget := filepath.Join(t.TempDir(), "foreign-missing-target")
	var inserted string
	_, err = syncWithBoundary(context.Background(), l, []models.Mod{newMod}, nil, func(path string) error {
		inserted = path
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			return err
		}
		return os.Symlink(foreignTarget, path)
	})
	code(t, err, "FileCollision")
	got, err := os.Readlink(inserted)
	must(t, err)
	if got != foreignTarget {
		t.Fatalf("inserted link target = %q, want %q", got, foreignTarget)
	}
	compatGot, err := os.Readlink(compatLink)
	must(t, err)
	if compatGot != compatSource {
		t.Fatalf("purgeable compatibility link changed: got %q, want %q", compatGot, compatSource)
	}
	content(t, oldTarget, "old contents")
	for _, dir := range state.CreatedDirs {
		info, err := os.Stat(filepath.Join(l.GameRoot, dir))
		if err != nil || !info.IsDir() {
			t.Fatalf("pre-existing created directory %q was not preserved: %v", dir, err)
		}
	}
	stateAfter, err := os.ReadFile(l.Paths().Deployment)
	must(t, err)
	if string(stateAfter) != string(stateBefore) {
		t.Fatalf("deployment state changed after target collision: before %q, after %q", stateBefore, stateAfter)
	}
}

func containsPath(paths []string, target string) bool {
	for _, path := range paths {
		if pathKey(path) == pathKey(target) {
			return true
		}
	}
	return false
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
