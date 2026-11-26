package deployment

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/martes/modkeeper/backend/models"
)

func TestSyncPreflightsChangedRemovalsBeforePurgingRecordedLinks(t *testing.T) {
	testSyncPreflightsChangedRemovalsBeforePurgingRecordedLinks(t)
}

func TestSyncRefusesRedirectedRecordedDirectoriesWhenArtifactsAreMissing(t *testing.T) {
	testSyncRefusesRedirectedRecordedDirectoriesWhenArtifactsAreMissing(t)
}

func TestUpdatingADeployedModRefreshesAndRemovalUnlinksStaleCopies(t *testing.T) {
	testUpdatingADeployedModRefreshesAndRemovalUnlinksStaleCopies(t)
}

func TestCopyDeploymentReusesOwnedDirectoriesAndNormalizesLegacyPaths(t *testing.T) {
	testCopyDeploymentReusesOwnedDirectoriesAndNormalizesLegacyPaths(t)
}

func TestLegacyCopyDeploymentFingerprintsAreMigratedOnLoad(t *testing.T) {
	testLegacyCopyDeploymentFingerprintsAreMigratedOnLoad(t)
}

func TestCopyDeploymentMergesIntoExistingGameDirectory(t *testing.T) {
	testCopyDeploymentMergesIntoExistingGameDirectory(t)
}

func TestUnownedDeploymentTargetIsPreservedAndBlocksSync(t *testing.T) {
	testUnownedDeploymentTargetIsPreservedAndBlocksSync(t)
}

func TestSyncReportsOneUnmanagedConflictAndDeploysOtherMod(t *testing.T) {
	l := fixture(t)
	conflict := mod(t, l, "conflict", map[string]string{"BepInEx/plugins/Conflict/conflict.dll": "mod"})
	success := mod(t, l, "success", map[string]string{"BepInEx/plugins/Success/success.dll": "good"})
	conflictingTarget := filepath.Join(l.GameRoot, "BepInEx/plugins/Conflict/conflict.dll")
	write(t, conflictingTarget, "unmanaged")

	report, err := Sync(context.Background(), l, []models.Mod{conflict, success}, nil)
	if err != nil {
		t.Fatalf("Sync() error = %v; want per-mod conflict report", err)
	}
	if len(report.Failures) != 1 || report.Failures[0].ModID != conflict.ID {
		t.Fatalf("failures = %#v; want only mod %q", report.Failures, conflict.ID)
	}
	if report.Deployed != 1 {
		t.Fatalf("deployed = %d; want 1", report.Deployed)
	}
	content(t, conflictingTarget, "unmanaged")
	content(t, filepath.Join(l.GameRoot, "BepInEx/plugins/Success/success.dll"), "good")
	if _, err := os.Lstat(filepath.Join(l.GameRoot, "BepInEx/plugins/Conflict/conflict.dll")); err != nil {
		t.Fatalf("unmanaged conflict was removed: %v", err)
	}
}

func TestUntrackedFileSafetyInSharedFolder(t *testing.T) {
	testUntrackedFileSafetyInSharedFolder(t)
}

func TestRecursiveLinkingLogic(t *testing.T) {
	testRecursiveLinkingLogic(t)
}

func TestReloadingALibraryRefreshesDeployStale(t *testing.T) {
	l := fixture(t)
	m := mod(t, l, "a", map[string]string{"SPT/user/mods/A/file": "v1"})
	syncMods(t, l, m)
	write(t, filepath.Join(l.Paths().Mods, "a/SPT/user/mods/A/file"), "v2")
	stale, err := DeployStale(l, []models.Mod{m})
	must(t, err)
	if !stale {
		t.Fatal("expected deployment to be stale after the source tree changed")
	}
}
