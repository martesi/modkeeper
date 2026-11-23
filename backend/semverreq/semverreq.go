// Package semverreq implements the subset of current implementation's semver VersionReq grammar
// that Forge addon constraints use. It intentionally omits npm-style syntax
// (OR groups, hyphen ranges, space-separated comparators) because current implementation rejects
// it. A bare version is a caret requirement, matching semver::VersionReq.
package semverreq

import (
	"errors"
	"fmt"
	"strings"
)

const maxComparators = 32

type Op uint8

const (
	OpExact Op = iota
	OpGreater
	OpGreaterEq
	OpLess
	OpLessEq
	OpTilde
	OpCaret
	OpWildcard
)

// Version is a parsed semantic version. Build metadata is validated but does
// not participate in comparisons, matching semver::Version.
type Version struct {
	Major, Minor, Patch uint64
	Pre                 string
	Build               string
}

// Comparator is one requirement term. A nil Minor or Patch means the term was
// partial or used a wildcard.
type Comparator struct {
	Op           Op
	Major        uint64
	Minor, Patch *uint64
	Pre          string
}

// Requirement is the comma-separated AND of comparators. An empty comparator
// list is the wildcard requirement `*`.
type Requirement struct {
	Comparators []Comparator
}

// ParseVersion parses a complete semantic version. Prerelease and build
// identifiers follow semver::Version rules, including numeric leading-zero
// rejection in the prerelease.
func ParseVersion(text string) (Version, error) {
	var v Version
	if text == "" {
		return v, errors.New("empty version")
	}
	rest := text
	var err error
	if v.Major, rest, err = numericIdentifier(rest); err != nil {
		return v, err
	}
	if rest, err = dot(rest); err != nil {
		return v, err
	}
	if v.Minor, rest, err = numericIdentifier(rest); err != nil {
		return v, err
	}
	if rest, err = dot(rest); err != nil {
		return v, err
	}
	if v.Patch, rest, err = numericIdentifier(rest); err != nil {
		return v, err
	}
	if strings.HasPrefix(rest, "-") {
		if v.Pre, rest, err = identifier(rest[1:], true); err != nil {
			return v, err
		}
		if v.Pre == "" {
			return v, errors.New("empty prerelease")
		}
	}
	if strings.HasPrefix(rest, "+") {
		if v.Build, rest, err = identifier(rest[1:], false); err != nil {
			return v, err
		}
		if v.Build == "" {
			return v, errors.New("empty build metadata")
		}
	}
	if rest != "" {
		return v, fmt.Errorf("unexpected character %q", rest[0])
	}
	return v, nil
}

// ParseRequirement parses a current implementation semver requirement. The default operator is
// caret, so "1.21" means >=1.21.0, <2.0.0.
func ParseRequirement(text string) (Requirement, error) {
	text = trimSpaces(text)
	if _, rest, ok := wildcard(text); ok {
		rest = trimSpaces(rest)
		if rest == "" {
			return Requirement{}, nil
		}
		return Requirement{}, errors.New("wildcard must be the only comparator")
	}
	var comparators []Comparator
	if err := versionReq(text, &comparators, 0); err != nil {
		return Requirement{}, err
	}
	return Requirement{Comparators: comparators}, nil
}

// Matches reports whether v satisfies the requirement, including current implementation's
// prerelease rule: a prerelease version only matches when a comparator carries
// a prerelease for the same major.minor.patch.
func (r Requirement) Matches(v Version) bool {
	for _, comparator := range r.Comparators {
		if !matchesImpl(comparator, v) {
			return false
		}
	}
	if v.Pre == "" {
		return true
	}
	for _, comparator := range r.Comparators {
		if preIsCompatible(comparator, v) {
			return true
		}
	}
	return false
}
