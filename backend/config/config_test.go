package config

import (
	"bytes"
	"testing"

	"github.com/BurntSushi/toml"
)

func TestWarnIncompatibleForgeInstallDefaultsAndPersists(t *testing.T) {
	settings := DefaultSettings()
	if !settings.WarnIncompatibleForgeInstall {
		t.Fatal("incompatible Forge install warning must be enabled by default")
	}

	settings.WarnIncompatibleForgeInstall = false
	var encoded bytes.Buffer
	if err := toml.NewEncoder(&encoded).Encode(settings); err != nil {
		t.Fatal(err)
	}
	var decoded AppSettings
	if _, err := toml.NewDecoder(&encoded).Decode(&decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.WarnIncompatibleForgeInstall {
		t.Fatal("disabled incompatible Forge install warning was not persisted")
	}
}
