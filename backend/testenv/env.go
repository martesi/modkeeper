// Package testenv provides game and library fixtures for backend tests only.
package testenv

import (
	"bytes"
	"github.com/BurntSushi/toml"
	"github.com/martes/modkeeper/backend/config"
	"github.com/martes/modkeeper/backend/models"
	"os"
	"path/filepath"
	"testing"
)

type Env struct {
	Root, GameRoot, LibraryRoot, ModsDir, StagingDir, ServerMods, ClientPlugins string
	t                                                                           testing.TB
}

func New(t testing.TB) *Env {
	t.Helper()
	root := t.TempDir()
	e := &Env{Root: root, GameRoot: filepath.Join(root, "game"), t: t}
	e.LibraryRoot = filepath.Join(e.GameRoot, ".mod_keeper")
	e.ModsDir = filepath.Join(e.LibraryRoot, "mods")
	e.StagingDir = filepath.Join(e.LibraryRoot, "staging")
	e.ServerMods = filepath.Join(e.GameRoot, "SPT", "user", "mods")
	e.ClientPlugins = filepath.Join(e.GameRoot, "BepInEx", "plugins")
	for _, dir := range []string{e.ModsDir, e.StagingDir, e.ServerMods, e.ClientPlugins, filepath.Join(e.LibraryRoot, "backups"), filepath.Join(e.GameRoot, "BepInEx", "config")} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
	}
	e.WriteServerExe()
	e.WriteClientExe()
	return e
}

func (e *Env) WriteServerExe(rel ...string) {
	e.t.Helper()
	path := filepath.Join("SPT", "SPT.Server.exe")
	if len(rel) > 0 {
		path = filepath.Join(rel...)
		if filepath.Ext(path) == "" {
			path = filepath.Join(path, "SPT.Server.exe")
		}
	}
	WriteTree(e.t, e.GameRoot, map[string]string{
		path: "dummy",
		filepath.Join(filepath.Dir(path), "user", "sptRegistry", "registry.json"): `{"SPT_Version":"SPT 4.0.11 - 278e72"}`,
	})
	if filepath.Dir(path) == "SPT_Runtime" {
		e.ServerMods = filepath.Join(e.GameRoot, "SPT_Runtime", "user", "mods")
		if err := os.MkdirAll(e.ServerMods, 0755); err != nil {
			e.t.Fatal(err)
		}
	}
}

func (e *Env) WriteClientExe() {
	e.t.Helper()
	WriteTree(e.t, e.GameRoot, map[string]string{"EscapeFromTarkov.exe": "dummy"})
}

func (e *Env) AddMod(id, name string, kind models.ModType) string {
	e.t.Helper()
	dir := filepath.Join(e.ModsDir, id)
	files := map[string]string{}
	if kind == models.ModTypeServer || kind == models.ModTypeBoth {
		files[filepath.Join("SPT", "user", "mods", name, "content.txt")] = name
	}
	if kind == models.ModTypeClient || kind == models.ModTypeBoth {
		files[filepath.Join("BepInEx", "plugins", name, "content.txt")] = name
	}
	if len(files) == 0 {
		files["content.txt"] = name
	}
	WriteTree(e.t, dir, files)
	return dir
}

func WriteTree(t testing.TB, dir string, files map[string]string) {
	t.Helper()
	for rel, content := range files {
		path := filepath.Join(dir, rel)
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
	}
}

func (e *Env) SettingsTOML() string {
	e.t.Helper()
	cfg := config.Default()
	cfg.KnownLibraries = []config.KnownLibrary{{ID: "test-library", LibraryRoot: e.LibraryRoot}}
	id := "test-library"
	cfg.AppState.ActiveLibraryID = &id
	var out bytes.Buffer
	if err := toml.NewEncoder(&out).Encode(cfg); err != nil {
		e.t.Fatal(err)
	}
	return out.String()
}
