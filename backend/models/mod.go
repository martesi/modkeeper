// Package models contains durable backend records shared by services.
package models

import "time"

type ForgeIdentity struct {
	Kind      string `json:"forgeKind"`
	ID        uint32 `json:"forgeId"`
	GUID      string `json:"forgeGuid"`
	VersionID uint32 `json:"forgeVersionId"`
	Version   string `json:"version"`
	CachedAt  string `json:"forgeMetaCachedAt"`
}

type Mod struct {
	ID          string         `json:"id"`
	Name        string         `json:"name"`
	Enabled     bool           `json:"isActive"`
	InstalledAt *string        `json:"installedAt,omitempty"`
	Source      string         `json:"source"`
	Forge       *ForgeIdentity `json:"-"`
}

// ApplyInstall implements the Rust install contract: updates retain enabled
// state and original install time; only a new install takes the preference.
// A local overwrite clears all Forge identity and version metadata.
func (m *Mod) ApplyInstall(enableOnInstall bool, forge *ForgeIdentity, now time.Time) {
	if m.InstalledAt == nil {
		stamp := now.UTC().Format(time.RFC3339)
		m.InstalledAt = &stamp
		m.Enabled = enableOnInstall
	}
	if forge == nil {
		m.Source = "local"
		m.Forge = nil
		return
	}
	copy := *forge
	m.Source = "forge"
	m.Forge = &copy
}
