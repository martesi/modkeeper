package library

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/martes/modkeeper/backend/forge"
	"github.com/martes/modkeeper/backend/models"
	"github.com/martes/modkeeper/backend/testenv"
)

func TestForgeVersionMatchesUsesRequirementSyntax(t *testing.T) {
	for _, test := range []struct {
		version    string
		constraint string
		want       bool
	}{
		// A bare version is a compatible caret requirement.
		{"1.21.0", "1.21", true},
		{"1.20.9", "1.21", false},
		{"1.22.0", "1.21", true},
		{"1.99.0", "1.21", true},
		{"1.5.0", "^1.0", true},
		{"2.0.0", "^1.0", false},
		{"1.2.9", "~1.2", true},
		{"1.3.0", "~1.2", false},
		{"1.5.0", ">=1.0, <2.0", true},
		{"2.1.0", ">=1.0, <2.0", false},
	} {
		got, err := forgeVersionMatches(test.version, test.constraint)
		if err != nil || got != test.want {
			t.Errorf("%s <= %s: got %v, %v", test.version, test.constraint, got, err)
		}
	}
	for _, constraint := range []string{"||", "1.0 - 2.0", ">=1.0 <2.0"} {
		var coded *models.Error
		if _, err := forgeVersionMatches("1.0.0", constraint); !errors.As(err, &coded) || coded.Code != models.ParseError {
			t.Errorf("rejected constraint %q: %v", constraint, err)
		}
	}
	var coded *models.Error
	if _, err := forgeVersionMatches("one", "^1"); !errors.As(err, &coded) || coded.Code != models.ParseError {
		t.Fatalf("invalid version: %v", err)
	}
}

func TestValidateForgeAddonParentChecksInstalledForgeMod(t *testing.T) {
	str := func(v string) *string { return &v }
	id := func(v uint64) *uint64 { return &v }
	kind := models.ForgeKindMod
	service := &Service{active: &Library{manifest: manifest{Mods: map[string]models.Mod{
		"parent": {
			ID:        "parent",
			Name:      "Parent",
			Source:    models.ModSourceForge,
			Version:   str("1.4.0"),
			ForgeKind: &kind,
			ForgeID:   id(3),
			ForgeGUID: str("parent-guid"),
		},
	}}}}

	if err := service.validateForgeAddonParent(&forge.AddonConstraint{IsDetached: true}); err != nil {
		t.Fatalf("detached addon: %v", err)
	}
	if err := service.validateForgeAddonParent(nil); err == nil {
		t.Fatal("missing constraint accepted")
	}
	if err := service.validateForgeAddonParent(&forge.AddonConstraint{}); err == nil {
		t.Fatal("missing parent identity accepted")
	}
	satisfied := &forge.AddonConstraint{ParentForgeID: id(3), ParentGUID: str("parent-guid"), VersionConstraint: str("^1.0")}
	if err := service.validateForgeAddonParent(satisfied); err != nil {
		t.Fatalf("satisfied constraint: %v", err)
	}
	mismatch := &forge.AddonConstraint{ParentForgeID: id(3), ParentGUID: str("parent-guid"), VersionConstraint: str("^2.0")}
	var coded *models.Error
	if err := service.validateForgeAddonParent(mismatch); !errors.As(err, &coded) || coded.Code != models.ParseError {
		t.Fatalf("mismatched constraint: %v", err)
	}
	missing := &forge.AddonConstraint{ParentForgeID: id(4), ParentGUID: str("other-guid"), VersionConstraint: str("^1.0")}
	if err := service.validateForgeAddonParent(missing); !errors.As(err, &coded) || coded.Code != models.ParseError {
		t.Fatalf("missing parent: %v", err)
	}
}

// TestInterruptedForgeInstallRecoveryKeepsModType proves a Forge install
// records the scanned mod type in its transaction, because committed-install
// recovery writes transaction.NewMod back into the manifest and strict Load
// rejects an empty type.
func TestInterruptedForgeInstallRecoveryKeepsModType(t *testing.T) {
	env := testenv.New(t)
	s, err := New(filepath.Join(env.Root, "forge-recovery-config.toml"))
	if err != nil {
		t.Fatal(err)
	}
	root := filepath.Join(env.Root, "forge-recovery-library")
	if err := s.CreateLibrary(models.CreateLibraryInput{GameRoot: env.GameRoot, LibraryRoot: &root}); err != nil {
		t.Fatal(err)
	}
	archive := writeInstallTestArchive(t, "ForgeRecoveryMod", "payload")
	metadata := forge.InstallMetadata{
		Kind:      string(models.ForgeKindMod),
		ForgeID:   41,
		ForgeGUID: "forge-recovery-guid",
		Version:   "1.2.3",
		VersionID: 42,
		CachedAt:  "2026-01-01T00:00:00Z",
	}
	var prepared installTransaction
	s.installTransactionHook = func(boundary string) {
		if boundary != "after-prepared-marker" {
			return
		}
		entries, readErr := os.ReadDir(s.active.BackupsDir)
		if readErr != nil {
			t.Fatalf("backups: %v", readErr)
		}
		for _, entry := range entries {
			name := entry.Name()
			if !strings.HasSuffix(name, ".install.prepared") {
				continue
			}
			id := strings.TrimSuffix(name, ".install.prepared")
			prepared, readErr = readInstallTransaction(filepath.Join(s.active.BackupsDir, name), id)
			if readErr != nil {
				t.Fatalf("prepared marker: %v", readErr)
			}
		}
	}
	input := forge.ForgeDownloadVersionInput{TaskID: "forge-recovery", LibraryID: s.active.manifest.ID, Kind: models.ForgeKindMod, ItemID: 41, VersionID: 42}
	if err := s.installForgeArchive(input, archive, metadata, nil, func(models.TaskProgressStage, *float64) {}); err != nil {
		t.Fatal(err)
	}
	if prepared.ID == "" {
		t.Fatal("Forge install did not prepare an install transaction")
	}
	if prepared.NewMod.Type != models.ModTypeServer {
		t.Fatalf("prepared type = %q; want %q", prepared.NewMod.Type, models.ModTypeServer)
	}

	// Simulate a crash after commit: the manifest entry is gone and only the
	// committed marker records the new mod.
	delete(s.active.manifest.Mods, prepared.ID)
	if err := s.active.Persist(); err != nil {
		t.Fatal(err)
	}
	prepared.Phase = installCommitted
	if err := writeInstallTransaction(installCommittedMarkerPath(s.active, prepared.ID), prepared); err != nil {
		t.Fatal(err)
	}

	restarted, err := Load(root)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if err := recoverInterruptedInstall(restarted); err != nil {
		t.Fatalf("recovery: %v", err)
	}
	recovered, ok := restarted.manifest.Mods[prepared.ID]
	if !ok {
		t.Fatal("recovery dropped the committed mod")
	}
	if recovered.Type == "" {
		t.Fatal("recovery persisted an empty type")
	}
	if recovered.ForgeID == nil || *recovered.ForgeID != metadata.ForgeID {
		t.Fatalf("recovered forge id: %v", recovered.ForgeID)
	}
	if _, err := Load(root); err != nil {
		t.Fatalf("strict Load after recovery: %v", err)
	}
}
