package backend

import (
	"encoding/json"

	"github.com/martes/modkeeper/backend/forge"
	"github.com/martes/modkeeper/backend/models"
)

// ForgeSearch bound methods return the single response object shaped like
// src-tauri/src/models/forge.rs. Wails packs multiple Go return values into an
// array, so the stale flag must stay inside each response.
func (a *App) ForgeSearch(query string, modPage, addonPage, perPage int) (json.RawMessage, error) {
	if a.Forge == nil {
		return nil, a.initFailure()
	}
	return a.Forge.Search(query, modPage, addonPage, perPage)
}
func (a *App) ForgeModDetail(kind models.ForgeKind, id uint32) (json.RawMessage, error) {
	if a.Forge == nil {
		return nil, a.initFailure()
	}
	return a.Forge.Detail(string(kind), id)
}
func (a *App) ForgeModVersions(kind models.ForgeKind, id uint32, page int) (json.RawMessage, error) {
	if a.Forge == nil {
		return nil, a.initFailure()
	}
	return a.Forge.Versions(string(kind), id, page)
}
func (a *App) ForgeAddonVersions(id uint32, page int) (json.RawMessage, error) {
	if a.Forge == nil {
		return nil, a.initFailure()
	}
	return a.Forge.Versions("addon", id, page)
}
func (a *App) ForgeDownloadVersion(input forge.ForgeDownloadVersionInput) (json.RawMessage, error) {
	if a.Forge == nil {
		return nil, a.initFailure()
	}
	return a.Forge.DownloadVersion(input)
}
func (a *App) ForgeMatchInstalledMod(input forge.ForgeMatchInstalledModInput) (*models.LibraryWorkspace, error) {
	if a.Forge == nil {
		return nil, a.initFailure()
	}
	return a.Forge.MatchInstalledMod(input)
}
