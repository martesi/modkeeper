package deployment

import (
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

func TestTestCopyDeploymentReusesOwnedDirectoriesAndNormalizesLegacyPaths(t *testing.T) {
	testCopyDeploymentReusesOwnedDirectoriesAndNormalizesLegacyPaths(t)
}

func TestTestLegacyCopyDeploymentFingerprintsAreMigratedOnLoad(t *testing.T) {
	testLegacyCopyDeploymentFingerprintsAreMigratedOnLoad(t)
}

func TestTestCopyDeploymentMergesIntoExistingGameDirectory(t *testing.T) {
	testCopyDeploymentMergesIntoExistingGameDirectory(t)
}

func TestTestUnownedDeploymentTargetIsPreservedAndBlocksSync(t *testing.T) {
	testUnownedDeploymentTargetIsPreservedAndBlocksSync(t)
}

func TestTestUntrackedFileSafetyInSharedFolder(t *testing.T) {
	testUntrackedFileSafetyInSharedFolder(t)
}

func TestTestRecursiveLinkingLogic(t *testing.T) {
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
