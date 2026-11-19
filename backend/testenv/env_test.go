package testenv

import (
	"github.com/BurntSushi/toml"
	"github.com/martes/modkeeper/backend/config"
	"github.com/martes/modkeeper/backend/models"
	"os"
	"path/filepath"
	"testing"
)

func TestGameAndLibraryLayout(t *testing.T) {
	e := New(t)
	for _, path := range []string{e.ModsDir, e.StagingDir, e.ServerMods, e.ClientPlugins, filepath.Join(e.GameRoot, "SPT", "SPT.Server.exe"), filepath.Join(e.GameRoot, "SPT", "user", "sptRegistry", "registry.json"), filepath.Join(e.GameRoot, "EscapeFromTarkov.exe")} {
		if _, err := os.Stat(path); err != nil {
			t.Fatal(err)
		}
	}
	e.WriteServerExe("SPT_Runtime")
	if _, err := os.Stat(filepath.Join(e.GameRoot, "SPT_Runtime", "SPT.Server.exe")); err != nil {
		t.Fatal(err)
	}
	dir := e.AddMod("both", "Example", models.ModTypeBoth)
	for _, rel := range []string{"SPT/user/mods/Example/content.txt", "BepInEx/plugins/Example/content.txt"} {
		if _, err := os.Stat(filepath.Join(dir, rel)); err != nil {
			t.Fatal(err)
		}
	}
	var cfg config.AppConfig
	if _, err := toml.Decode(e.SettingsTOML(), &cfg); err != nil {
		t.Fatal(err)
	}
	if len(cfg.KnownLibraries) != 1 || cfg.KnownLibraries[0].LibraryRoot != e.LibraryRoot || cfg.AppState.ActiveLibraryID == nil {
		t.Fatalf("wrong config: %+v", cfg)
	}
}
