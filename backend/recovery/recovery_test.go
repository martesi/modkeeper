package recovery

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/BurntSushi/toml"
	"github.com/martes/modkeeper/backend/config"
	"github.com/martes/modkeeper/backend/deployment"
	"github.com/martes/modkeeper/backend/linker"
	"github.com/martes/modkeeper/backend/spt"
)

func fixture(t *testing.T) (string, string, string) {
	t.Helper()
	root := t.TempDir()
	cfgDir := filepath.Join(root, "app")
	if err := os.MkdirAll(cfgDir, 0700); err != nil {
		t.Fatal(err)
	}
	return root, cfgDir, filepath.Join(cfgDir, "config.toml")
}

func journalFile(t *testing.T, cfg, root, id string, phase Phase, original, quarantine string) string {
	t.Helper()
	j := Journal{Version: 1, Token: "test", LibraryID: id, LibraryRoot: root, Phase: phase,
		Entries: []Entry{{Original: original, Quarantine: quarantine}}}
	path := filepath.Join(cfg, journalPrefix+"test"+journalSuffix)
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	if err = toml.NewEncoder(f).Encode(j); err != nil {
		t.Fatal(err)
	}
	if err = f.Close(); err != nil {
		t.Fatal(err)
	}
	return path
}
func configFile(t *testing.T, path string, libs ...config.KnownLibrary) {
	t.Helper()
	if err := os.WriteFile(path, []byte(""), 0600); err != nil {
		t.Fatal(err)
	}
	if len(libs) != 0 {
		if err := os.WriteFile(path, []byte(""), 0600); err != nil {
			t.Fatal(err)
		}
		// Persist using the same TOML representation read by the app store.
		f, err := os.Create(path)
		if err != nil {
			t.Fatal(err)
		}
		if err = toml.NewEncoder(f).Encode(config.AppConfig{KnownLibraries: libs}); err != nil {
			t.Fatal(err)
		}
		if err = f.Close(); err != nil {
			t.Fatal(err)
		}
	}
}

func TestRecoveryRestoresStagedObjectsForRegisteredLibrary(t *testing.T) {
	root, cfg, cp := fixture(t)
	original, quarantine := filepath.Join(root, "thing"), filepath.Join(root, ".mkd-test-0")
	if err := os.WriteFile(quarantine, []byte("data"), 0600); err != nil {
		t.Fatal(err)
	}
	journal := journalFile(t, cfg, root, "lib", Staged, "thing", filepath.Base(quarantine))
	configFile(t, cp, config.KnownLibrary{ID: "lib", LibraryRoot: root})
	if err := Recover(cp); err != nil {
		t.Fatal(err)
	}
	if b, err := os.ReadFile(original); err != nil || string(b) != "data" {
		t.Fatalf("restored data=%q err=%v", b, err)
	}
	if _, err := os.Stat(journal); !os.IsNotExist(err) {
		t.Fatalf("journal remains: %v", err)
	}
}

func TestRecoveryFinishesCommittedCleanupForUnregisteredLibrary(t *testing.T) {
	root, cfg, cp := fixture(t)
	q := filepath.Join(root, ".mkd-test-0")
	if err := os.WriteFile(q, []byte("data"), 0600); err != nil {
		t.Fatal(err)
	}
	j := journalFile(t, cfg, root, "lib", Committed, "thing", filepath.Base(q))
	configFile(t, cp)
	if err := Recover(cp); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(q); !os.IsNotExist(err) {
		t.Fatalf("quarantine remains: %v", err)
	}
	if _, err := os.Stat(j); !os.IsNotExist(err) {
		t.Fatalf("journal remains: %v", err)
	}
}

func TestRecoveryBlocksADifferentLibraryClaimingTheSameRoot(t *testing.T) {
	root, cfg, cp := fixture(t)
	q := filepath.Join(root, ".mkd-test-0")
	if err := os.WriteFile(q, []byte("data"), 0600); err != nil {
		t.Fatal(err)
	}
	j := journalFile(t, cfg, root, "old", Committed, "thing", filepath.Base(q))
	configFile(t, cp, config.KnownLibrary{ID: "new", LibraryRoot: root})
	if err := Recover(cp); err == nil {
		t.Fatal("expected conflict")
	}
	for _, p := range []string{q, j} {
		if _, err := os.Lstat(p); err != nil {
			t.Fatalf("evidence %s removed: %v", p, err)
		}
	}
}

func TestRecoveryIgnoresAMissingConfigDirectory(t *testing.T) {
	if err := Recover(filepath.Join(t.TempDir(), "missing", "config.toml")); err != nil {
		t.Fatal(err)
	}
}

func TestRecoveryBlocksAJournalWhenTheConfigFileIsMissing(t *testing.T) {
	root, cfg, cp := fixture(t)
	q := filepath.Join(root, ".mkd-test-0")
	if err := os.WriteFile(q, []byte("data"), 0600); err != nil {
		t.Fatal(err)
	}
	j := journalFile(t, cfg, root, "lib", Committed, "thing", filepath.Base(q))
	if err := Recover(cp); err == nil {
		t.Fatal("expected missing config error")
	}
	for _, p := range []string{q, j} {
		if _, err := os.Lstat(p); err != nil {
			t.Fatalf("evidence %s removed: %v", p, err)
		}
	}
}

func TestPurgeBlocksAnOrphanedQuarantineLinkOnRetry(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "target")
	q := filepath.Join(root, ".mkp-orphan")
	if err := os.WriteFile(target, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, q); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	err := ensureNoOrphanQuarantine(root)
	if err == nil || !strings.Contains(err.Error(), "quarantine") {
		t.Fatalf("expected quarantine guard, got %v", err)
	}
	if _, err := os.Lstat(q); err != nil {
		t.Fatal("quarantine link was removed")
	}
}

func TestPurgeBlocksARetainedRecoveryManifestOnRetry(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, ".modkeeper-purge-recovery.toml"), []byte("evidence"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := ensureNoOrphanQuarantine(root); err == nil {
		t.Fatal("expected retained manifest guard")
	}
}

func TestPurgeKeepsARecoveryManifestWhenItsQuarantineIsMissing(t *testing.T) {
	root := t.TempDir()
	p := filepath.Join(root, ".modkeeper-purge-recovery.toml")
	if err := os.WriteFile(p, []byte("evidence"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := ensureNoOrphanQuarantine(root); err == nil {
		t.Fatal("expected retained manifest guard")
	}
	if _, err := os.Stat(p); err != nil {
		t.Fatal("manifest was removed")
	}
}

func TestPurgeHandlesChainedJunctionsDuringQuarantine(t *testing.T) {
	if err := ensureNoLinkedParent(t.TempDir(), "a/b/object"); err != nil {
		t.Fatal(err)
	}
}

func TestPurgeHandlesNonUtf8LinkTargetsWithoutRecreatingThem(t *testing.T) {
	root := t.TempDir()
	if err := ensureNoLinkedParent(root, "object"); err != nil {
		t.Fatal(err)
	}
}

func TestRetiringReconciledRecordsPreventsOldLibraryReplay(t *testing.T) {
	root, cfg, cp := fixture(t)
	q := filepath.Join(root, ".mkd-test-0")
	if err := os.WriteFile(q, []byte("old"), 0600); err != nil {
		t.Fatal(err)
	}
	j := journalFile(t, cfg, root, "old", Committed, "thing", filepath.Base(q))
	configFile(t, cp)
	if err := Recover(cp); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(q); !os.IsNotExist(err) {
		t.Fatalf("old record replayed: %v", err)
	}
	if _, err := os.Stat(j); !os.IsNotExist(err) {
		t.Fatalf("journal remains: %v", err)
	}
}

func TestDeletingACrossMajorLibraryBlocksOnAnUnverifiableCopy(t *testing.T) {
	layout := deploymentLayout(t)
	target := filepath.Join(layout.GameRoot, "SPT", "user", "mods", "A", "file")
	writeFile(t, target, "deployed")
	// A copy artifact without a fingerprint cannot be proven owned.
	must(t, deployment.SaveState(layout, deployment.DeploymentState{Artifacts: []deployment.DeploymentArtifact{{
		Target: target, Source: filepath.Join(layout.LibraryRoot, "mods", "a"), Kind: linker.Copy,
	}}, CreatedDirs: []string{}}))
	if err := deployment.VerifyOwnership(layout); err == nil {
		t.Fatal("unverifiable copy accepted")
	}
}

func TestDeletingACrossMajorLibraryRefusesAReplacedDeployment(t *testing.T) {
	layout := deploymentLayout(t)
	target := filepath.Join(layout.GameRoot, "SPT", "user", "mods", "A", "file")
	writeFile(t, target, "user-replaced")
	source := filepath.Join(layout.LibraryRoot, "mods", "a", "SPT", "user", "mods", "A", "file")
	writeFile(t, source, "owned")
	must(t, deployment.SaveState(layout, deployment.DeploymentState{Artifacts: []deployment.DeploymentArtifact{{
		Target: target, Source: source, Kind: linker.Copy,
		Fingerprint: strPtr(testFingerprint(t, source)),
	}}, CreatedDirs: []string{}}))
	if err := deployment.VerifyOwnership(layout); err == nil {
		t.Fatal("replaced deployment accepted")
	}
}

func deploymentLayout(t *testing.T) deployment.Layout {
	t.Helper()
	game := t.TempDir()
	must(t, os.MkdirAll(filepath.Join(game, "SPT", "user", "mods"), 0755))
	writeFile(t, filepath.Join(game, "SPT", "SPT.Server.exe"), "exe")
	writeFile(t, filepath.Join(game, "EscapeFromTarkov.exe"), "exe")
	rules, err := spt.Discover(game)
	must(t, err)
	root := filepath.Join(game, ".mod_keeper")
	must(t, os.MkdirAll(root, 0755))
	return deployment.Layout{LibraryRoot: root, GameRoot: game, Rules: rules}
}

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	must(t, os.MkdirAll(filepath.Dir(path), 0755))
	must(t, os.WriteFile(path, []byte(content), 0644))
}

func testFingerprint(t *testing.T, path string) string {
	t.Helper()
	state, err := deployment.SnapshotFingerprint(path)
	must(t, err)
	return state
}

func strPtr(value string) *string { return &value }

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}
