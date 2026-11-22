package semverreq

import "strings"

func matchesImpl(comparator Comparator, version Version) bool {
	switch comparator.Op {
	case OpExact, OpWildcard:
		return matchesExact(comparator, version)
	case OpGreater:
		return matchesGreater(comparator, version)
	case OpGreaterEq:
		return matchesExact(comparator, version) || matchesGreater(comparator, version)
	case OpLess:
		return matchesLess(comparator, version)
	case OpLessEq:
		return matchesExact(comparator, version) || matchesLess(comparator, version)
	case OpTilde:
		return matchesTilde(comparator, version)
	case OpCaret:
		return matchesCaret(comparator, version)
	}
	return false
}

func matchesExact(comparator Comparator, version Version) bool {
	if version.Major != comparator.Major {
		return false
	}
	if comparator.Minor != nil && version.Minor != *comparator.Minor {
		return false
	}
	if comparator.Patch != nil && version.Patch != *comparator.Patch {
		return false
	}
	return version.Pre == comparator.Pre
}

func matchesGreater(comparator Comparator, version Version) bool {
	if version.Major != comparator.Major {
		return version.Major > comparator.Major
	}
	if comparator.Minor == nil {
		return false
	}
	if version.Minor != *comparator.Minor {
		return version.Minor > *comparator.Minor
	}
	if comparator.Patch == nil {
		return false
	}
	if version.Patch != *comparator.Patch {
		return version.Patch > *comparator.Patch
	}
	return comparePre(version.Pre, comparator.Pre) > 0
}

func matchesLess(comparator Comparator, version Version) bool {
	if version.Major != comparator.Major {
		return version.Major < comparator.Major
	}
	if comparator.Minor == nil {
		return false
	}
	if version.Minor != *comparator.Minor {
		return version.Minor < *comparator.Minor
	}
	if comparator.Patch == nil {
		return false
	}
	if version.Patch != *comparator.Patch {
		return version.Patch < *comparator.Patch
	}
	return comparePre(version.Pre, comparator.Pre) < 0
}

func matchesTilde(comparator Comparator, version Version) bool {
	if version.Major != comparator.Major {
		return false
	}
	if comparator.Minor != nil && version.Minor != *comparator.Minor {
		return false
	}
	if comparator.Patch != nil && version.Patch != *comparator.Patch {
		return version.Patch > *comparator.Patch
	}
	return comparePre(version.Pre, comparator.Pre) >= 0
}

func matchesCaret(comparator Comparator, version Version) bool {
	if version.Major != comparator.Major {
		return false
	}
	if comparator.Minor == nil {
		return true
	}
	if comparator.Patch == nil {
		if comparator.Major > 0 {
			return version.Minor >= *comparator.Minor
		}
		return version.Minor == *comparator.Minor
	}
	if comparator.Major > 0 {
		if version.Minor != *comparator.Minor {
			return version.Minor > *comparator.Minor
		}
		if version.Patch != *comparator.Patch {
			return version.Patch > *comparator.Patch
		}
	} else if *comparator.Minor > 0 {
		if version.Minor != *comparator.Minor {
			return false
		}
		if version.Patch != *comparator.Patch {
			return version.Patch > *comparator.Patch
		}
	} else if version.Minor != *comparator.Minor || version.Patch != *comparator.Patch {
		return false
	}
	return comparePre(version.Pre, comparator.Pre) >= 0
}

func preIsCompatible(comparator Comparator, version Version) bool {
	return comparator.Major == version.Major &&
		comparator.Minor != nil && *comparator.Minor == version.Minor &&
		comparator.Patch != nil && *comparator.Patch == version.Patch &&
		comparator.Pre != ""
}

// comparePre orders prerelease identifiers like semver::Prerelease. A release
// (empty prerelease) sorts after every prerelease.
func comparePre(left, right string) int {
	if left == right {
		return 0
	}
	if left == "" {
		return 1
	}
	if right == "" {
		return -1
	}
	leftParts := strings.Split(left, ".")
	rightParts := strings.Split(right, ".")
	for index, leftPart := range leftParts {
		if index == len(rightParts) {
			return 1
		}
		rightPart := rightParts[index]
		leftNumeric, rightNumeric := allDigits(leftPart), allDigits(rightPart)
		switch {
		case leftNumeric && rightNumeric:
			if len(leftPart) != len(rightPart) {
				if len(leftPart) < len(rightPart) {
					return -1
				}
				return 1
			}
			if leftPart != rightPart {
				if leftPart < rightPart {
					return -1
				}
				return 1
			}
		case leftNumeric:
			return -1
		case rightNumeric:
			return 1
		case leftPart != rightPart:
			if leftPart < rightPart {
				return -1
			}
			return 1
		}
	}
	if len(leftParts) < len(rightParts) {
		return -1
	}
	return 0
}

func allDigits(value string) bool {
	if value == "" {
		return false
	}
	for index := 0; index < len(value); index++ {
		if value[index] < '0' || value[index] > '9' {
			return false
		}
	}
	return true
}

func trimSpaces(input string) string { return strings.TrimLeft(input, " ") }
