// Package spt discovers SPT installation paths and versions.
package spt

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// Rules are paths relative to a game root.
type Rules struct {
	ServerMods, ServerExe, ServerRegistry, ClientPlugins, ClientConfig string
}

func defaults(server string) Rules {
	return Rules{
		ServerMods:     filepath.Join(server, "user", "mods"),
		ServerExe:      filepath.Join(server, "SPT.Server.exe"),
		ServerRegistry: filepath.Join(server, "user", "sptRegistry", "registry.json"),
		ClientPlugins:  filepath.Join("BepInEx", "plugins"),
		ClientConfig:   filepath.Join("BepInEx", "config"),
	}
}

// Discover recognizes exactly the standard and SPT_Runtime server layouts.
func Discover(gameRoot string) (Rules, error) {
	standard := filepath.Join(gameRoot, "SPT", "SPT.Server.exe")
	runtime := filepath.Join(gameRoot, "SPT_Runtime", "SPT.Server.exe")
	_, se := os.Stat(standard)
	_, re := os.Stat(runtime)
	s, r := se == nil, re == nil
	if s && r {
		return Rules{}, fail("ParseError", "Both SPT and SPT_Runtime contain a server; select an installation with only one server")
	}
	if r {
		return defaults("SPT_Runtime"), nil
	}
	return defaults("SPT"), nil
}

// Fail is a local error type kept independent of the foundation models package.
type Fail struct {
	Code string
	Data any
}

func (e *Fail) Error() string          { return fmt.Sprintf("%s: %v", e.Code, e.Data) }
func fail(code string, data any) error { return &Fail{Code: code, Data: data} }

var versionRE = regexp.MustCompile(`(\d+\.\d+\.\d+)`)

func extract(s string) (string, error) {
	m := versionRE.FindStringSubmatch(s)
	if len(m) == 0 {
		return "", fail("ParseError", "Could not extract version number from: "+s)
	}
	return m[1], nil
}

// ReadVersion prefers server dependency metadata, falling back to registry only if absent.
func ReadVersion(gameRoot string) (string, error) {
	rules, err := Discover(gameRoot)
	if err != nil {
		return "", err
	}
	deps := filepath.Join(gameRoot, filepath.Dir(rules.ServerExe), "SPT.Server.deps.json")
	content, err := os.ReadFile(deps)
	if err == nil {
		var doc struct {
			RuntimeTarget struct {
				Name string `json:"name"`
			} `json:"runtimeTarget"`
			Targets map[string]map[string]json.RawMessage `json:"targets"`
		}
		if json.Unmarshal(content, &doc) != nil {
			return "", fail("ParseError", "Failed to parse server dependencies")
		}
		if doc.RuntimeTarget.Name == "" {
			return "", fail("ParseError", "Server dependencies missing runtime target")
		}
		target, ok := doc.Targets[doc.RuntimeTarget.Name]
		if !ok {
			return "", fail("ParseError", "Server dependencies missing target data")
		}
		found := ""
		for key := range target {
			if strings.HasPrefix(key, "SPT.Server/") {
				if found != "" {
					return "", fail("ParseError", "Multiple server versions in dependencies")
				}
				found = strings.TrimPrefix(key, "SPT.Server/")
			}
		}
		if found == "" {
			return "", fail("ParseError", "Server version missing from dependencies")
		}
		return extract(found)
	}
	if !os.IsNotExist(err) {
		return "", fail("IOError", "Failed to read "+deps+": "+err.Error())
	}
	content, err = os.ReadFile(filepath.Join(gameRoot, rules.ServerRegistry))
	if err != nil {
		return "", fail("IOError", "Failed to read registry file: "+err.Error())
	}
	var registry map[string]any
	if json.Unmarshal(content, &registry) != nil {
		return "", fail("ParseError", "Failed to parse registry JSON")
	}
	text, ok := registry["SPT_Version"].(string)
	if !ok {
		return "", fail("ParseError", "SPT_Version field not found in registry.json")
	}
	return extract(text)
}

// ValidateVersion accepts SPT 4.x and 5.0.x only.
func ValidateVersion(_ Rules, version string) error {
	parts := strings.Split(version, ".")
	if len(parts) < 3 {
		return fail("ParseError", "invalid semantic version")
	}
	major, e1 := strconv.Atoi(parts[0])
	minor, e2 := strconv.Atoi(parts[1])
	patch, e3 := strconv.Atoi(strings.SplitN(parts[2], "-", 2)[0])
	if e1 != nil || e2 != nil || e3 != nil {
		return fail("ParseError", "invalid semantic version")
	}
	canonical := fmt.Sprintf("%d.%d.%d", major, minor, patch)
	if major == 4 || major == 5 && minor == 0 {
		return nil
	}
	return fail("UnsupportedSPTVersion", canonical)
}

// MetadataDirs returns server roots that contain metadata, rejecting ambiguous roots.
func MetadataDirs(gameRoot string) []string {
	var dirs []string
	for _, name := range []string{"SPT", "SPT_Runtime"} {
		if _, err := os.Stat(filepath.Join(gameRoot, name, "SPT.Server.exe")); err == nil {
			dirs = append(dirs, filepath.Join(gameRoot, name))
		}
	}
	return dirs
}

// NormalizeStagingRoot reports the canonical staged layout without changing the source.
func NormalizeStagingRoot(root string) (string, error) {
	old := filepath.Join(root, "SPT")
	new := filepath.Join(root, "SPT_Runtime")
	_, oe := os.Stat(old)
	_, ne := os.Stat(new)
	if oe == nil && ne == nil {
		return "", fail("ParseError", "Mod package contains both SPT and SPT_Runtime folders")
	}
	if ne == nil {
		return old, nil
	}
	return old, nil
}
