// Package models contains durable backend records shared by services.
package models

import (
	"encoding/json"
	"strings"
	"time"
)

type ModType string

const (
	ModTypeClient  ModType = "client"
	ModTypeServer  ModType = "server"
	ModTypeBoth    ModType = "both"
	ModTypeUnknown ModType = "unknown"
)

type ModSource string

const (
	ModSourceLocal ModSource = "local"
	ModSourceForge ModSource = "forge"
)

type ForgeKind string

const (
	ForgeKindMod   ForgeKind = "mod"
	ForgeKindAddon ForgeKind = "addon"
)

type ForgeIdentity struct {
	Kind      string `json:"forgeKind"`
	ID        uint32 `json:"forgeId"`
	GUID      string `json:"forgeGuid"`
	VersionID uint32 `json:"forgeVersionId"`
	Version   string `json:"version"`
	CachedAt  string `json:"forgeMetaCachedAt"`
}

type Mod struct {
	ID                string         `json:"id" toml:"id"`
	Enabled           bool           `json:"isActive" toml:"isActive"`
	Type              ModType        `json:"type" toml:"type"`
	Name              string         `json:"name" toml:"name"`
	InstalledAt       *string        `json:"installedAt,omitempty" toml:"installedAt,omitempty"`
	Version           *string        `json:"version,omitempty" toml:"version,omitempty"`
	ForgeID           *uint64        `json:"forgeId,omitempty" toml:"forgeId,omitempty"`
	ForgeGUID         *string        `json:"forgeGuid,omitempty" toml:"forgeGuid,omitempty"`
	Source            ModSource      `json:"source" toml:"source"`
	ForgeKind         *ForgeKind     `json:"forgeKind,omitempty" toml:"forgeKind,omitempty"`
	ForgeVersionID    *uint64        `json:"forgeVersionId,omitempty" toml:"forgeVersionId,omitempty"`
	ForgeMetaCachedAt *string        `json:"forgeMetaCachedAt,omitempty" toml:"forgeMetaCachedAt,omitempty"`
	Forge             *ForgeIdentity `json:"-" toml:"-"`
}

func (m *Mod) UnmarshalJSON(data []byte) error {
	type plain Mod
	v := plain{Source: ModSourceLocal}
	if err := json.Unmarshal(data, &v); err != nil {
		return err
	}
	v.Type = ModType(strings.ToLower(string(v.Type)))
	*m = Mod(v)
	return nil
}

// UnmarshalTOML supplies the serde default for pre-registry manifests.
func (m *Mod) UnmarshalTOML(data any) error {
	bytes, err := json.Marshal(data)
	if err != nil {
		return err
	}
	return m.UnmarshalJSON(bytes)
}

// ApplyInstall implements the current implementation install contract: updates retain enabled
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
		m.Version, m.ForgeID, m.ForgeGUID, m.ForgeKind, m.ForgeVersionID, m.ForgeMetaCachedAt = nil, nil, nil, nil, nil, nil
		return
	}
	copy := *forge
	m.Source = "forge"
	m.Forge = &copy
	kind, id, versionID := ForgeKind(copy.Kind), uint64(copy.ID), uint64(copy.VersionID)
	m.Version, m.ForgeID, m.ForgeGUID = &copy.Version, &id, &copy.GUID
	m.ForgeKind, m.ForgeVersionID, m.ForgeMetaCachedAt = &kind, &versionID, &copy.CachedAt
}
