package models

import (
	"testing"
	"time"
)

func TestInstallPreferenceAndTimestampSurviveUpdates(t *testing.T) {
	now := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	m := Mod{ID: "one"}
	m.ApplyInstall(false, nil, now)
	if m.Enabled || m.InstalledAt == nil || *m.InstalledAt != now.Format(time.RFC3339) {
		t.Fatalf("new install: %+v", m)
	}
	m.ApplyInstall(true, nil, now.Add(time.Hour))
	if m.Enabled || *m.InstalledAt != now.Format(time.RFC3339) {
		t.Fatalf("update changed preference/time: %+v", m)
	}
}

func TestLocalOverwriteClearsForgeIdentity(t *testing.T) {
	m := Mod{ID: "one"}
	m.ApplyInstall(true, &ForgeIdentity{Kind: "mod", ID: 10, GUID: "remote"}, time.Now())
	m.ApplyInstall(false, nil, time.Now().Add(time.Hour))
	if m.Source != "local" || m.Forge != nil {
		t.Fatalf("forge metadata retained: %+v", m)
	}
}
