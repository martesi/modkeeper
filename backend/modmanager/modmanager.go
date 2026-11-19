// Package modmanager maintains installed mod metadata and folder cache.
package modmanager

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"time"

	"github.com/BurntSushi/toml"
	"github.com/martes/modkeeper/backend/models"
	"github.com/martes/modkeeper/backend/modfs"
)

type Library struct {
	Root  string
	Mods  map[string]models.Mod
	Cache LibraryCache
}
type LibraryCache struct{ Mods map[string]modfs.ModFS }
type Metadata struct{ Forge *models.ForgeIdentity }
type Manifest struct {
	ID          string  `toml:"id" json:"id"`
	IsActive    bool    `toml:"isActive" json:"isActive"`
	Type        string  `toml:"type" json:"type"`
	Name        string  `toml:"name" json:"name"`
	InstalledAt *string `toml:"installedAt,omitempty" json:"installedAt,omitempty"`
	ForgeKind   *string `toml:"forgeKind,omitempty" json:"forgeKind,omitempty"`
	ForgeID     *uint32 `toml:"forgeId,omitempty" json:"forgeId,omitempty"`
	ForgeGUID   *string `toml:"forgeGuid,omitempty" json:"forgeGuid,omitempty"`
	Version     *string `toml:"version,omitempty" json:"version,omitempty"`
}

func AddMod(l *Library, id, name, kind, source string, active bool, metadata *Metadata) error {
	return AddModWithMetadata(l, id, name, kind, source, active, metadata)
}
func AddModWithMetadata(l *Library, id, name, kind, source string, active bool, metadata *Metadata) error {
	m, ok := l.Mods[id]
	if !ok {
		m = models.Mod{ID: id, Name: name}
	}
	m.ApplyInstall(active, nil, time.Now())
	if metadata != nil && metadata.Forge != nil {
		m.ApplyInstall(active, metadata.Forge, time.Now())
	}
	l.Mods[id] = m
	if err := os.MkdirAll(filepath.Join(l.Root, id), 0755); err != nil {
		return err
	}
	return writeManifest(filepath.Join(l.Root, id, "manifest.toml"), m, kind)
}
func writeManifest(path string, m models.Mod, kind string) error {
	v := Manifest{ID: m.ID, IsActive: m.Enabled, Type: kind, Name: m.Name, InstalledAt: m.InstalledAt}
	if m.Forge != nil {
		v.ForgeKind = &m.Forge.Kind
		v.ForgeID = &m.Forge.ID
		v.ForgeGUID = &m.Forge.GUID
		v.Version = &m.Forge.Version
	}
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return toml.NewEncoder(f).Encode(v)
}
func RemoveMod(l *Library, id string) error {
	if _, ok := l.Mods[id]; !ok {
		return errors.New("ModNotFound")
	}
	if err := os.RemoveAll(filepath.Join(l.Root, id)); err != nil {
		return err
	}
	delete(l.Mods, id)
	delete(l.Cache.Mods, id)
	return nil
}
func ToggleMod(l *Library, id string, active bool) error {
	m, ok := l.Mods[id]
	if !ok {
		return errors.New("ModNotFound")
	}
	m.Enabled = active
	l.Mods[id] = m
	return writeManifest(filepath.Join(l.Root, id, "manifest.toml"), m, "")
}
func NormalizeModFolders(root, serverMods, clientPlugins string, mods map[string]models.Mod) ([][2]string, error) {
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil, err
	}
	var renamed [][2]string
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		old := filepath.Join(root, e.Name())
		raw, err := os.ReadFile(filepath.Join(old, "manifest.toml"))
		if err != nil {
			continue
		}
		var m Manifest
		if _, err = toml.Decode(string(raw), &m); err != nil {
			return nil, err
		}
		if m.ID == "" || m.ID == e.Name() {
			continue
		}
		dst := filepath.Join(root, m.ID)
		if _, err = os.Stat(dst); err == nil {
			return nil, errors.New("ModIdConflict")
		}
		if err = os.Rename(old, dst); err != nil {
			return nil, err
		}
		renamed = append(renamed, [2]string{e.Name(), m.ID})
	}
	return renamed, nil
}
func (m Manifest) JSON() ([]byte, error) { return json.Marshal(m) }

var _ = modfs.ModFS{}
