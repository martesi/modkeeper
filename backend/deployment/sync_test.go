package deployment

import (
	"bytes"
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

func TestSyncExcludesEveryOwnerOfDuplicateTargetAndDeploysIndependentMods(t *testing.T) {
	for _, order := range []string{"abc", "cba"} {
		t.Run(order, func(t *testing.T) {
			l := fixture(t)
			a := mod(t, l, "a", map[string]string{"BepInEx/plugins/Shared/shared.dll": "a"})
			b := mod(t, l, "b", map[string]string{"BepInEx/plugins/Shared/shared.dll": "b"})
			c := mod(t, l, "c", map[string]string{"BepInEx/plugins/Independent/independent.dll": "c"})
			sentinel := filepath.Join(l.GameRoot, "BepInEx/plugins/User/keep.bin")
			write(t, sentinel, "unmanaged sentinel")
			before, err := os.ReadFile(sentinel)
			if err != nil {
				t.Fatal(err)
			}
			mods := []models.Mod{a, b, c}
			if order == "cba" {
				mods = []models.Mod{c, b, a}
			}

			report, err := Sync(context.Background(), l, mods, nil)
			if err != nil {
				t.Fatalf("Sync() error = %v, want partial result", err)
			}
			if len(report.Failures) != 2 || report.Failures[0].ModID != "a" || report.Failures[1].ModID != "b" {
				t.Fatalf("failures = %#v, want a and b once in ID order", report.Failures)
			}
			if report.Deployed != 1 {
				t.Fatalf("deployed = %d, want independent mod only", report.Deployed)
			}
			if _, err := os.Lstat(filepath.Join(l.GameRoot, "BepInEx/plugins/Shared/shared.dll")); !os.IsNotExist(err) {
				t.Fatalf("conflicting target exists or could not be checked: %v", err)
			}
			content(t, filepath.Join(l.GameRoot, "BepInEx/plugins/Independent/independent.dll"), "c")
			after, err := os.ReadFile(sentinel)
			if err != nil || !bytes.Equal(after, before) {
				t.Fatalf("unmanaged sentinel changed: before=%q after=%q err=%v", before, after, err)
			}
			state, err := LoadState(l)
			if err != nil {
				t.Fatal(err)
			}
			if len(state.Artifacts) != 1 || state.Artifacts[0].Source != filepath.Join("mods", "c", "BepInEx", "plugins", "Independent", "independent.dll") {
				t.Fatalf("deployment state = %#v, want only mod c artifact", state.Artifacts)
			}
		})
	}
}

func TestSyncExcludesFileDirectoryAncestorConflictsAndKeepsSharedDirectories(t *testing.T) {
	t.Run("file directory ancestor", func(t *testing.T) {
		l := fixture(t)
		a := mod(t, l, "a", map[string]string{"BepInEx/plugins/Shared": "file"})
		b := mod(t, l, "b", map[string]string{"BepInEx/plugins/Shared/child.dll": "child"})
		c := mod(t, l, "c", map[string]string{"BepInEx/plugins/Other/other.dll": "independent"})
		report, err := Sync(context.Background(), l, []models.Mod{b, c, a}, nil)
		if err != nil {
			t.Fatalf("Sync() error = %v, want independent partial deployment", err)
		}
		if len(report.Failures) != 2 || report.Failures[0].ModID != "a" || report.Failures[1].ModID != "b" || report.Deployed != 1 {
			t.Fatalf("report = %+v, want a and b failed and c deployed", report)
		}
		absent(t, filepath.Join(l.GameRoot, "BepInEx/plugins/Shared"))
		content(t, filepath.Join(l.GameRoot, "BepInEx/plugins/Other/other.dll"), "independent")
	})

	t.Run("shared directories are not conflicts", func(t *testing.T) {
		l := fixture(t)
		a := mod(t, l, "a", map[string]string{"BepInEx/plugins/Shared/a.dll": "a"})
		b := mod(t, l, "b", map[string]string{"BepInEx/plugins/Shared/b.dll": "b"})
		report, err := Sync(context.Background(), l, []models.Mod{b, a}, nil)
		if err != nil || len(report.Failures) != 0 || report.Deployed != 2 {
			t.Fatalf("report=%+v error=%v, want both shared-directory claims deployed", report, err)
		}
		content(t, filepath.Join(l.GameRoot, "BepInEx/plugins/Shared/a.dll"), "a")
		content(t, filepath.Join(l.GameRoot, "BepInEx/plugins/Shared/b.dll"), "b")
	})
}

func TestSyncExcludesAllModsInMultipleAndMappedDestinationConflicts(t *testing.T) {
	t.Run("multiple conflicts", func(t *testing.T) {
		l := fixture(t)
		a := mod(t, l, "a", map[string]string{
			"BepInEx/plugins/One/one.dll": "a1",
			"BepInEx/plugins/Two/two.dll": "a2",
		})
		b := mod(t, l, "b", map[string]string{"BepInEx/plugins/One/one.dll": "b"})
		c := mod(t, l, "c", map[string]string{"BepInEx/plugins/Two/two.dll": "c"})
		d := mod(t, l, "d", map[string]string{"BepInEx/plugins/Independent/d.dll": "d"})
		report, err := Sync(context.Background(), l, []models.Mod{d, c, a, b}, nil)
		if err != nil || len(report.Failures) != 3 || report.Deployed != 1 {
			t.Fatalf("report=%+v error=%v, want a/b/c failed and d deployed", report, err)
		}
		for i, id := range []string{"a", "b", "c"} {
			if report.Failures[i].ModID != id {
				t.Fatalf("failures = %#v, want IDs sorted", report.Failures)
			}
		}
		content(t, filepath.Join(l.GameRoot, "BepInEx/plugins/Independent/d.dll"), "d")
	})

	t.Run("mapped unmanaged destination", func(t *testing.T) {
		l := fixture(t)
		l.Rules.ServerExe = filepath.Join("SPT_Runtime", "SPT.Server.exe")
		a := mod(t, l, "a", map[string]string{"SPT/user/mods/Mapped/file.dll": "a"})
		c := mod(t, l, "c", map[string]string{"BepInEx/plugins/Independent/c.dll": "c"})
		mappedTarget := filepath.Join(l.GameRoot, "SPT_Runtime/user/mods/Mapped/file.dll")
		write(t, mappedTarget, "unmanaged mapped target")
		report, err := Sync(context.Background(), l, []models.Mod{a, c}, nil)
		if err != nil || len(report.Failures) != 1 || report.Failures[0].ModID != "a" || report.Deployed != 1 {
			t.Fatalf("report=%+v error=%v, want mapped owner failed and c deployed", report, err)
		}
		content(t, mappedTarget, "unmanaged mapped target")
		content(t, filepath.Join(l.GameRoot, "BepInEx/plugins/Independent/c.dll"), "c")
	})
}

func TestSyncWithOnlyConflictingModsKeepsFailureBehavior(t *testing.T) {
	l := fixture(t)
	a := mod(t, l, "a", map[string]string{"BepInEx/plugins/Shared/a.dll": "a"})
	b := mod(t, l, "b", map[string]string{"BepInEx/plugins/Shared/a.dll": "b"})
	_, err := Sync(context.Background(), l, []models.Mod{b, a}, nil)
	code(t, err, models.FileCollision)
	state, err := LoadState(l)
	if err != nil || len(state.Artifacts) != 0 {
		t.Fatalf("state=%+v error=%v, want no deployment", state, err)
	}
}

func TestSyncRefusesPartialReconciliationWhenExcludedModsHavePriorArtifacts(t *testing.T) {
	l := fixture(t)
	a := mod(t, l, "a", map[string]string{"BepInEx/plugins/Old/a.dll": "a"})
	b := mod(t, l, "b", map[string]string{"BepInEx/plugins/Old/b.dll": "b"})
	c := mod(t, l, "c", map[string]string{"BepInEx/plugins/Independent/c.dll": "c"})
	syncMods(t, l, a, b, c)
	stateBefore, err := os.ReadFile(l.Paths().Deployment)
	if err != nil {
		t.Fatal(err)
	}
	aConflict := filepath.Join(l.Paths().Mods, "a", "BepInEx", "plugins", "Shared", "same.dll")
	bConflict := filepath.Join(l.Paths().Mods, "b", "BepInEx", "plugins", "Shared", "same.dll")
	write(t, aConflict, "a conflict")
	write(t, bConflict, "b conflict")
	sentinel := filepath.Join(l.GameRoot, "BepInEx", "plugins", "User", "sentinel.bin")
	write(t, sentinel, "unmanaged")
	_, err = Sync(context.Background(), l, []models.Mod{a, b, c}, nil)
	if err == nil {
		t.Fatal("Sync() succeeded, want conservative pre-mutation refusal")
	}
	for _, deployed := range []struct{ path, value string }{
		{filepath.Join(l.GameRoot, "BepInEx", "plugins", "Old", "a.dll"), "a"},
		{filepath.Join(l.GameRoot, "BepInEx", "plugins", "Old", "b.dll"), "b"},
		{filepath.Join(l.GameRoot, "BepInEx", "plugins", "Independent", "c.dll"), "c"},
		{sentinel, "unmanaged"},
	} {
		content(t, deployed.path, deployed.value)
	}
	stateAfter, err := os.ReadFile(l.Paths().Deployment)
	if err != nil || string(stateAfter) != string(stateBefore) {
		t.Fatalf("deployment state changed: before=%q after=%q err=%v", stateBefore, stateAfter, err)
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
