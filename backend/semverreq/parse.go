package semverreq

import (
	"errors"
	"fmt"
	"strings"
)

func versionReq(input string, out *[]Comparator, depth int) error {
	comparator, rest, err := parseComparator(input)
	if err != nil {
		return err
	}
	if rest == "" {
		*out = append(*out, comparator)
		return nil
	}
	if !strings.HasPrefix(rest, ",") {
		return fmt.Errorf("expected comma before %q", rest[0])
	}
	rest = trimSpaces(rest[1:])
	if depth+1 == maxComparators {
		return errors.New("too many comparators")
	}
	if err := versionReq(rest, out, depth+1); err != nil {
		return err
	}
	*out = append(*out, comparator)
	return nil
}

func parseComparator(input string) (Comparator, string, error) {
	var comparator Comparator
	op, rest := parseOp(input)
	defaultOp := len(input) == len(rest)
	rest = trimSpaces(rest)
	major, rest, err := numericIdentifier(rest)
	if err != nil {
		return comparator, "", err
	}
	comparator.Op, comparator.Major = op, major
	hasWildcard := false
	if strings.HasPrefix(rest, ".") {
		rest = rest[1:]
		if _, after, ok := wildcard(rest); ok {
			hasWildcard = true
			if defaultOp {
				comparator.Op = OpWildcard
			}
			rest = after
		} else {
			var minor uint64
			if minor, rest, err = numericIdentifier(rest); err != nil {
				return comparator, "", err
			}
			comparator.Minor = &minor
		}
	}
	if strings.HasPrefix(rest, ".") {
		rest = rest[1:]
		if _, after, ok := wildcard(rest); ok {
			if defaultOp {
				comparator.Op = OpWildcard
			}
			rest = after
		} else if hasWildcard {
			return comparator, "", errors.New("unexpected content after wildcard")
		} else {
			var patch uint64
			if patch, rest, err = numericIdentifier(rest); err != nil {
				return comparator, "", err
			}
			comparator.Patch = &patch
		}
	}
	if comparator.Patch != nil && strings.HasPrefix(rest, "-") {
		if comparator.Pre, rest, err = identifier(rest[1:], true); err != nil {
			return comparator, "", err
		}
		if comparator.Pre == "" {
			return comparator, "", errors.New("empty prerelease")
		}
	}
	if comparator.Patch != nil && strings.HasPrefix(rest, "+") {
		var build string
		if build, rest, err = identifier(rest[1:], false); err != nil {
			return comparator, "", err
		}
		if build == "" {
			return comparator, "", errors.New("empty build metadata")
		}
	}
	return comparator, trimSpaces(rest), nil
}

func parseOp(input string) (Op, string) {
	if strings.HasPrefix(input, "=") {
		return OpExact, input[1:]
	}
	if strings.HasPrefix(input, ">=") {
		return OpGreaterEq, input[2:]
	}
	if strings.HasPrefix(input, ">") {
		return OpGreater, input[1:]
	}
	if strings.HasPrefix(input, "<=") {
		return OpLessEq, input[2:]
	}
	if strings.HasPrefix(input, "<") {
		return OpLess, input[1:]
	}
	if strings.HasPrefix(input, "~") {
		return OpTilde, input[1:]
	}
	if strings.HasPrefix(input, "^") {
		return OpCaret, input[1:]
	}
	return OpCaret, input
}

func numericIdentifier(input string) (uint64, string, error) {
	var value uint64
	length := 0
	for length < len(input) && input[length] >= '0' && input[length] <= '9' {
		if value == 0 && length > 0 {
			return 0, "", errors.New("leading zero")
		}
		digit := uint64(input[length] - '0')
		if value > (^uint64(0)-digit)/10 {
			return 0, "", errors.New("number overflow")
		}
		value = value*10 + digit
		length++
	}
	if length == 0 {
		if len(input) == 0 {
			return 0, "", errors.New("unexpected end")
		}
		return 0, "", fmt.Errorf("unexpected character %q", input[0])
	}
	return value, input[length:], nil
}

func wildcard(input string) (byte, string, bool) {
	if input == "" {
		return 0, input, false
	}
	switch input[0] {
	case '*', 'x', 'X':
		return input[0], input[1:], true
	}
	return 0, input, false
}

func dot(input string) (string, error) {
	if strings.HasPrefix(input, ".") {
		return input[1:], nil
	}
	if input == "" {
		return "", errors.New("unexpected end")
	}
	return "", fmt.Errorf("unexpected character %q", input[0])
}

// identifier scans dot-separated [0-9A-Za-z-] segments. The prerelease variant
// rejects leading zeros in all-numeric segments.
func identifier(input string, prerelease bool) (string, string, error) {
	accumulated, segmentLength := 0, 0
	segmentHasNonDigit := false
	for {
		found := accumulated+segmentLength < len(input)
		var char byte
		if found {
			char = input[accumulated+segmentLength]
		}
		alphanumeric := found && ((char >= 'A' && char <= 'Z') || (char >= 'a' && char <= 'z') || char == '-')
		digit := found && char >= '0' && char <= '9'
		switch {
		case alphanumeric:
			segmentLength++
			segmentHasNonDigit = true
		case digit:
			segmentLength++
		default:
			if segmentLength == 0 {
				if accumulated == 0 && !(found && char == '.') {
					return "", input, nil
				}
				return "", "", errors.New("empty identifier segment")
			}
			if prerelease && segmentLength > 1 && !segmentHasNonDigit && input[accumulated] == '0' {
				return "", "", errors.New("leading zero in prerelease")
			}
			accumulated += segmentLength
			if found && char == '.' {
				accumulated++
				segmentLength = 0
				segmentHasNonDigit = false
				continue
			}
			return input[:accumulated], input[accumulated:], nil
		}
	}
}
