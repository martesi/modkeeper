package modfs

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/zeebo/blake3"
)

func expectedID(value string) string {
	sum := blake3.Sum256([]byte(strings.ToLower(value)))
	return base64.RawURLEncoding.EncodeToString(sum[:16])
}
func writeFixture(t *testing.T, root, rel string) {
	t.Helper()
	p := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, nil, 0600); err != nil {
		t.Fatal(err)
	}
}
func TestTestResolveIdServerOnly(t *testing.T) {
	root := t.TempDir()
	writeFixture(t, root, "SPT/user/mods/WeatherMod/mod.dll")
	got, err := Scan(root, "SPT/user/mods", "SPT/BepInEx/plugins")
	if err != nil || got.ID != expectedID("weathermod") || got.ModType != "server" {
		t.Fatalf("%+v %v", got, err)
	}
}
func TestTestResolveIdClientOnly(t *testing.T) {
	root := t.TempDir()
	writeFixture(t, root, "SPT/BepInEx/plugins/AuthorName/Logic.dll")
	got, err := Scan(root, "SPT/user/mods", "SPT/BepInEx/plugins")
	if err != nil || got.ID != expectedID("authorname/logic.dll") || got.ModType != "client" {
		t.Fatalf("%+v %v", got, err)
	}
}
func TestTestResolveIdCombined(t *testing.T) {
	root := t.TempDir()
	writeFixture(t, root, "SPT/user/mods/CoreMod/mod.dll")
	writeFixture(t, root, "SPT/BepInEx/plugins/Fixes.dll")
	got, err := Scan(root, "SPT/user/mods", "SPT/BepInEx/plugins")
	if err != nil || got.ID != expectedID("coremodfixes.dll") || got.ModType != "both" {
		t.Fatalf("%+v %v", got, err)
	}
}
func TestTestResolveIdIgnoresNonDllInClientPlugins(t *testing.T) {
	root := t.TempDir()
	writeFixture(t, root, "SPT/BepInEx/plugins/readme.txt")
	writeFixture(t, root, "SPT/user/mods/ValidMod/mod.dll")
	got, err := Scan(root, "SPT/user/mods", "SPT/BepInEx/plugins")
	if err != nil || got.ID != expectedID("validmod") {
		t.Fatalf("%+v %v", got, err)
	}
}
func TestTestExecutablesDetection(t *testing.T) {
	root := t.TempDir()
	writeFixture(t, root, "SPT/user/mods/ModWithTools/mod.dll")
	writeFixture(t, root, "root_tool.exe")
	writeFixture(t, root, "SPT/user/mods/ModWithTools/tools/sub/nested_tool.exe")
	got, err := Scan(root, "SPT/user/mods", "SPT/BepInEx/plugins")
	if err != nil || len(got.Executables) != 2 {
		t.Fatalf("%+v %v", got, err)
	}
}
func TestTestCopyRecursiveOverwriteAndDeepNesting(t *testing.T) {
	src, dst := filepath.Join(t.TempDir(), "src"), filepath.Join(t.TempDir(), "dst")
	if err := os.MkdirAll(filepath.Join(src, "a", "b", "c"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dst, "a", "b", "c"), 0755); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(src, "a", "b", "c", "d.txt"), []byte("new"), 0600)
	_ = os.WriteFile(filepath.Join(dst, "a", "b", "c", "d.txt"), []byte("old"), 0600)
	if err := copyTree(src, dst); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(filepath.Join(dst, "a", "b", "c", "d.txt"))
	if err != nil || string(b) != "new" {
		t.Fatalf("%q %v", b, err)
	}
}
func copyTree(src, dst string) error {
	return filepath.WalkDir(src, func(p string, e os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(src, p)
		target := filepath.Join(dst, rel)
		if e.IsDir() {
			return os.MkdirAll(target, 0755)
		}
		b, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		return os.WriteFile(target, b, 0600)
	})
}
func TestTestNewFailsForInvalidStructure(t *testing.T) {
	root := t.TempDir()
	writeFixture(t, root, "RandomFolder/something.dll")
	if _, err := Scan(root, "SPT/user/mods", "SPT/BepInEx/plugins"); err == nil {
		t.Fatal("expected invalid structure error")
	}
}
func TestTestDeterministicIdSorting(t *testing.T) {
	root := t.TempDir()
	names := []string{"Z_mod", "A_mod", "M_mod"}
	for _, n := range names {
		writeFixture(t, root, "SPT/user/mods/"+n+"/mod.dll")
	}
	sort.Strings(names)
	got, err := Scan(root, "SPT/user/mods", "SPT/BepInEx/plugins")
	if err != nil || got.ID != expectedID("a_modm_modz_mod") {
		t.Fatalf("%+v %v", got, err)
	}
}
