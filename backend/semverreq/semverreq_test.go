package semverreq

import "testing"

// These cases come from the Rust semver fixture used by
// library_service::addon_parent_constraints_are_evaluated_with_semver.
func TestRustAddonFixture(t *testing.T) {
	for _, test := range []struct {
		version    string
		constraint string
		want       bool
	}{
		{"1.21.0", "1.21", true},
		{"1.20.9", "1.21", false},
		{"1.22.0", "1.21", true},
		{"1.99.0", "1.21", true},
	} {
		assertMatch(t, test.version, test.constraint, test.want)
	}
}

func TestRequirementOperators(t *testing.T) {
	for _, test := range []struct {
		version    string
		constraint string
		want       bool
	}{
		{"1.0.0", "^1.0", true},
		{"1.5.0", "^1.0", true},
		{"2.0.0", "^1.0", false},
		{"0.9.0", "^1.0", false},
		{"1.2.0", "~1.2", true},
		{"1.2.9", "~1.2", true},
		{"1.3.0", "~1.2", false},
		{"1.1.9", "~1.2", false},
		{"1.0.0", ">=1.0, <2.0", true},
		{"1.9.9", ">=1.0, <2.0", true},
		{"2.0.0", ">=1.0, <2.0", false},
		{"0.9.0", ">=1.0, <2.0", false},
		{"1.2.3", "=1.2.3", true},
		{"1.2.4", "=1.2.3", false},
		{"1.9.9", ">=1.2", true},
		{"1.1.9", ">=1.2", false},
		{"0.2.9", "0.2", true},
		{"0.3.0", "0.2", false},
		{"0.0.3", "0.0.3", true},
		{"0.0.4", "0.0.3", false},
		{"0.9.0", "0", true},
		{"1.0.0", "0", false},
		{"2.5.0", "*", true},
		{"2.5.0", "2.*", true},
		{"3.0.0", "2.*", false},
		{"2.5.9", "2.5.*", true},
		{"2.6.0", "2.5.*", false},
	} {
		assertMatch(t, test.version, test.constraint, test.want)
	}
}

func TestPrereleaseRules(t *testing.T) {
	for _, test := range []struct {
		version    string
		constraint string
		want       bool
	}{
		{"1.2.3-alpha", "1.2.3-alpha", true},
		{"1.2.3-beta", "1.2.3-alpha", true},
		{"1.2.3-alpha.0", "1.2.3-alpha", true},
		{"1.2.3-alpha", "1.2.3-beta", false},
		{"1.2.3", "1.2.3-alpha", true},
		{"1.2.3-alpha", "*", false},
		{"1.2.3-alpha", ">=1.0.0", false},
		{"1.5.0-alpha", ">=1.0.0, <2.0.0", false},
	} {
		assertMatch(t, test.version, test.constraint, test.want)
	}
}

func TestRustRejectedSyntax(t *testing.T) {
	for _, constraint := range []string{
		"",
		"||",
		"1.0 - 2.0",
		">=1.0 <2.0",
		"1.0,",
		"*, 1.0",
		"1.*.2",
		"1.2-alpha",
		"1.0.0-alpha.01",
		"1.2.3.4",
		"01.0",
	} {
		if _, err := ParseRequirement(constraint); err == nil {
			t.Errorf("constraint %q was accepted", constraint)
		}
	}
}

func TestVersionParsing(t *testing.T) {
	for _, text := range []string{"1.2.3", "1.2.3-alpha.1", "1.2.3+build.5", "1.2.3-rc.1+build"} {
		if _, err := ParseVersion(text); err != nil {
			t.Errorf("version %q: %v", text, err)
		}
	}
	for _, text := range []string{"", "1", "1.2", "01.2.3", "1.02.3", "1.2.03", "1.2.3-", "1.2.3-01", "1.2.3+", "1.2.3.4"} {
		if _, err := ParseVersion(text); err == nil {
			t.Errorf("version %q was accepted", text)
		}
	}
}

func assertMatch(t *testing.T, version, constraint string, want bool) {
	t.Helper()
	requirement, err := ParseRequirement(constraint)
	if err != nil {
		t.Fatalf("parse %q: %v", constraint, err)
	}
	parsed, err := ParseVersion(version)
	if err != nil {
		t.Fatalf("parse version %q: %v", version, err)
	}
	if got := requirement.Matches(parsed); got != want {
		t.Errorf("%s matches %q = %v; want %v", version, constraint, got, want)
	}
}
