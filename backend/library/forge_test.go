package library

import (
	"errors"
	"testing"

	"github.com/martes/modkeeper/backend/forge"
	"github.com/martes/modkeeper/backend/models"
)

func TestForgeVersionMatchesUsesRustRequirementSyntax(t *testing.T) {
	for _, test := range []struct {
		version    string
		constraint string
		want       bool
	}{
		// Rust fixture: a bare version is a caret requirement.
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
			t.Errorf("Rust-rejected constraint %q: %v", constraint, err)
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
