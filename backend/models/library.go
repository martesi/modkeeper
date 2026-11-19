package models

import (
	"encoding/json"
	"fmt"
)

type LibraryDTO struct {
	ID         string         `json:"id"`
	Name       string         `json:"name"`
	GameRoot   string         `json:"gameRoot"`
	RepoRoot   string         `json:"repoRoot"`
	SPTVersion string         `json:"sptVersion"`
	Mods       map[string]Mod `json:"mods"`
	IsDirty    bool           `json:"isDirty"`
}
type LibraryCreationRequirement struct {
	GameRoot string  `json:"gameRoot"`
	RepoRoot *string `json:"repoRoot"`
	Name     string  `json:"name"`
}
type LibrarySummary struct {
	ID          string      `json:"id"`
	Name        string      `json:"name"`
	GameRoot    string      `json:"gameRoot"`
	LibraryRoot string      `json:"libraryRoot"`
	SPTVersion  *string     `json:"sptVersion,omitempty"`
	CacheStatus CacheStatus `json:"cacheStatus"`
	DeployStale bool        `json:"deployStale"`
	UpdatedAt   string      `json:"updatedAt"`
}
type LibraryStub struct {
	Path string `json:"path"`
}
type LibraryEntry struct {
	Summary *LibrarySummary
	Stub    *LibraryStub
}

func SummaryEntry(summary LibrarySummary) LibraryEntry { return LibraryEntry{Summary: &summary} }
func StubEntry(path string) LibraryEntry               { return LibraryEntry{Stub: &LibraryStub{Path: path}} }
func (e LibraryEntry) MarshalJSON() ([]byte, error) {
	if e.Summary != nil && e.Stub == nil {
		return json.Marshal(e.Summary)
	}
	if e.Stub != nil && e.Summary == nil {
		return json.Marshal(e.Stub)
	}
	return nil, fmt.Errorf("library entry must contain exactly one variant")
}
func (e *LibraryEntry) UnmarshalJSON(data []byte) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	required := []string{"id", "name", "gameRoot", "libraryRoot", "cacheStatus", "deployStale", "updatedAt"}
	summary := true
	for _, key := range required {
		if _, ok := fields[key]; !ok {
			summary = false
		}
	}
	if summary {
		var v LibrarySummary
		if err := json.Unmarshal(data, &v); err == nil {
			*e = SummaryEntry(v)
			return nil
		}
	}
	if raw, ok := fields["path"]; ok && string(raw) != "null" {
		var v LibraryStub
		if err := json.Unmarshal(data, &v); err != nil {
			return err
		}
		*e = StubEntry(v.Path)
		return nil
	}
	return fmt.Errorf("invalid library entry")
}

type CacheState string

const (
	CacheStateReady      CacheState = "ready"
	CacheStateDirty      CacheState = "dirty"
	CacheStateRebuilding CacheState = "rebuilding"
	CacheStateFailed     CacheState = "failed"
)

type CacheStatus struct {
	State         CacheState `json:"state"`
	Message       *string    `json:"message,omitempty"`
	LastRebuiltAt *string    `json:"lastRebuiltAt,omitempty"`
}
type ModSummary struct {
	ID                string     `json:"id"`
	LibraryID         string     `json:"libraryId"`
	Name              string     `json:"name"`
	Type              ModType    `json:"type"`
	IsEnabled         bool       `json:"isEnabled"`
	SourcePath        *string    `json:"sourcePath,omitempty"`
	InstalledPath     *string    `json:"installedPath,omitempty"`
	InstalledAt       *string    `json:"installedAt,omitempty"`
	UpdatedAt         string     `json:"updatedAt"`
	Version           *string    `json:"version,omitempty"`
	ForgeID           *uint64    `json:"forgeId,omitempty"`
	ForgeGUID         *string    `json:"forgeGuid,omitempty"`
	Source            *ModSource `json:"source,omitempty"`
	ForgeKind         *ForgeKind `json:"forgeKind,omitempty"`
	ForgeVersionID    *uint64    `json:"forgeVersionId,omitempty"`
	ForgeMetaCachedAt *string    `json:"forgeMetaCachedAt,omitempty"`
}
type ToolSummary struct {
	ID             string  `json:"id"`
	LibraryID      string  `json:"libraryId"`
	Name           string  `json:"name"`
	ExecutablePath string  `json:"executablePath"`
	IconDataURL    *string `json:"iconDataUrl,omitempty"`
	LaunchArgs     *string `json:"launchArgs,omitempty"`
	UpdatedAt      string  `json:"updatedAt"`
}
