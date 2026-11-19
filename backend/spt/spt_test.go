package spt

import (
	"os"
	"path/filepath"
	"testing"
)

func put(t *testing.T, p, data string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(data), 0644); err != nil {
		t.Fatal(err)
	}
}

func deps(v string) string {
	return `{"runtimeTarget":{"name":"net10/win-x64"},"targets":{"net10/win-x64":{"SPT.Server/` + v + `-RELEASE+abc":{}}}}`
}

func TestSpt500RuntimeLayoutImportsAndDeploysMods(t *testing.T) {
	root := t.TempDir()
	put(t, filepath.Join(root, "SPT_Runtime/SPT.Server.exe"), "")
	r, err := Discover(root)
	if err != nil {
		t.Fatal(err)
	}
	if r.ServerMods != filepath.Join("SPT_Runtime", "user", "mods") {
		t.Fatal(r)
	}
}

func TestLoadingA4xLibraryRejectsAnSpt5Installation(t *testing.T) {
	if err := ValidateVersion(Rules{}, "5.1.0"); err == nil {
		t.Fatal("expected unsupported version")
	}
}
func TestSyncingAnOpen4xLibraryRejectsAnSpt5Installation(t *testing.T) {
	if err := ValidateVersion(Rules{}, "5.1.0"); err == nil {
		t.Fatal("expected unsupported version")
	}
}
func TestSyncingRediscoversTheServerLayoutBeforeVersionValidation(t *testing.T) {
	root := t.TempDir()
	put(t, filepath.Join(root, "SPT/SPT.Server.exe"), "")
	put(t, filepath.Join(root, "SPT_Runtime/SPT.Server.exe"), "")
	_, err := Discover(root)
	if e, ok := err.(*Fail); !ok || e.Code != "ParseError" {
		t.Fatalf("got %v", err)
	}
}
func TestStagingAcceptsOldAndNewRootsWithoutMutatingSource(t *testing.T) {
	root := t.TempDir()
	put(t, filepath.Join(root, "SPT_Runtime/user/mods/a/mod.dll"), "")
	staged, err := NormalizeStagingRoot(root)
	if err != nil {
		t.Fatal(err)
	}
	if staged != filepath.Join(root, "SPT") {
		t.Fatal(staged)
	}
	if _, err := os.Stat(filepath.Join(root, "SPT_Runtime/user/mods/a/mod.dll")); err != nil {
		t.Fatal("source mutated")
	}
}
func TestServerMetadataTakesPrecedenceAndInvalidDataIsRejected(t *testing.T) {
	root := t.TempDir()
	put(t, filepath.Join(root, "SPT/SPT.Server.exe"), "")
	put(t, filepath.Join(root, "SPT/user/sptRegistry/registry.json"), `{"SPT_Version":"SPT 4.0.11"}`)
	put(t, filepath.Join(root, "SPT/SPT.Server.deps.json"), deps("4.1.6"))
	v, err := ReadVersion(root)
	if err != nil || v != "4.1.6" {
		t.Fatalf("%s %v", v, err)
	}
	put(t, filepath.Join(root, "SPT/SPT.Server.deps.json"), "{}")
	if _, err := ReadVersion(root); err == nil {
		t.Fatal("expected invalid metadata error")
	}
}
func TestAmbiguousServerRootsAreRejected(t *testing.T) {
	root := t.TempDir()
	put(t, filepath.Join(root, "SPT/SPT.Server.exe"), "")
	put(t, filepath.Join(root, "SPT_Runtime/SPT.Server.exe"), "")
	if _, err := Discover(root); err == nil {
		t.Fatal("expected ambiguity")
	}
}
