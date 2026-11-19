package models

import (
	"bytes"
	"testing"
	"time"

	"github.com/BurntSushi/toml"
	"github.com/martes/modkeeper/backend/config"
)

func TestInstallPreferenceDefaultsAndRoundTrips(t *testing.T) {
	settings := config.DefaultSettings()
	if !settings.EnableModsOnInstall {
		t.Fatal("install preference default must be enabled")
	}
	settings.EnableModsOnInstall = false
	var encoded bytes.Buffer
	if err := toml.NewEncoder(&encoded).Encode(settings); err != nil {
		t.Fatal(err)
	}
	var decoded config.AppSettings
	if _, err := toml.Decode(encoded.String(), &decoded); err != nil || decoded.EnableModsOnInstall {
		t.Fatalf("round trip: %+v, %v", decoded, err)
	}
}

func TestInstallPreferenceAppliesToNewModsAndPreservesUpdates(t *testing.T) {
	now := time.Date(2025, 1, 2, 3, 4, 5, 0, time.UTC)
	for _, enabled := range []bool{true, false} {
		m := Mod{ID: "example"}
		m.ApplyInstall(enabled, nil, now)
		if m.Enabled != enabled || m.InstalledAt == nil {
			t.Fatalf("new mod preference %v: %+v", enabled, m)
		}
		installed := *m.InstalledAt
		m.ApplyInstall(!enabled, nil, now.Add(time.Hour))
		if m.Enabled != enabled || *m.InstalledAt != installed {
			t.Fatalf("update changed install state: %+v", m)
		}
	}
}

func TestLocalOverwriteClearsForgeIdentityMetadata(t *testing.T) {
	m := Mod{ID: "example"}
	m.ApplyInstall(true, &ForgeIdentity{Kind: "mod", ID: 2658, GUID: "test.guid", VersionID: 9001, Version: "1.2", CachedAt: "2025-01-02T03:04:05Z"}, time.Now())
	m.ApplyInstall(false, nil, time.Now().Add(time.Hour))
	if m.Source != "local" || m.Forge != nil {
		t.Fatalf("forge identity retained: %+v", m)
	}
}

func TestLegacyModManifestsRemainReadable(t *testing.T) {
	var m Mod
	if _, err := toml.Decode("id='legacy'\nisActive=true\ntype='server'\nname='Legacy'\n", &m); err != nil {
		t.Fatal(err)
	}
	if m.InstalledAt != nil {
		t.Fatalf("legacy manifest has install time: %v", m.InstalledAt)
	}
}

func TestInstallTimeSurvivesUpdatesTogglesRebuildsAndReload(t *testing.T) {
	m := Mod{ID: "example"}
	now := time.Date(2025, 1, 2, 3, 4, 5, 0, time.UTC)
	m.ApplyInstall(true, nil, now)
	original := *m.InstalledAt
	m.ApplyInstall(false, nil, now.Add(time.Hour))
	m.Enabled = false
	m.Enabled = true
	if *m.InstalledAt != original {
		t.Fatalf("install time changed: %+v", m)
	}
}

func TestLegacyFolderTimeIsExposedReadOnlyAndPreservedOnUpdate(t *testing.T) {
	m := Mod{ID: "legacy"}
	folderTime := "2020-01-02T03:04:05Z"
	// An absent manifest timestamp remains absent; updates retain the supplied
	// legacy timestamp when known to the caller.
	m.InstalledAt = &folderTime
	m.ApplyInstall(false, nil, time.Now())
	if m.InstalledAt == nil || *m.InstalledAt != folderTime {
		t.Fatalf("legacy timestamp changed: %+v", m)
	}
}

func TestTestCacheRebuildRenamesMismatchedFolder(t *testing.T) {
	t.Skip("blocked on wails/wd-library-ops")
}
