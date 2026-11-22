package backend

import (
	"encoding/json"

	"github.com/martes/modkeeper/backend/forge"
	"github.com/martes/modkeeper/backend/models"
)

// forgeResponse decodes a Forge service body into the response model that
// mirrors src-tauri/src/models/forge.rs. A body that does not match the wire
// shape is a coded ParseError, never a panic.
func forgeResponse[T any](body json.RawMessage) (*T, error) {
	var value T
	if err := json.Unmarshal(body, &value); err != nil {
		return nil, models.Fail(models.ParseError, "Malformed Forge response: "+err.Error())
	}
	return &value, nil
}

// ForgeSearch returns the single response object shaped like
// src-tauri/src/models/forge.rs. Wails packs multiple Go return values into an
// array, so the stale flag must stay inside each response.
func (a *App) ForgeSearch(query string, modPage, addonPage, perPage int) (*models.ForgeSearchResponse, error) {
	if a.Forge == nil {
		return nil, a.initFailure()
	}
	body, err := a.Forge.Search(query, modPage, addonPage, perPage)
	if err != nil {
		return nil, err
	}
	return forgeResponse[models.ForgeSearchResponse](body)
}
func (a *App) ForgeModDetail(kind models.ForgeKind, id uint32) (*models.ForgeDetail, error) {
	if a.Forge == nil {
		return nil, a.initFailure()
	}
	body, err := a.Forge.Detail(string(kind), id)
	if err != nil {
		return nil, err
	}
	return forgeResponse[models.ForgeDetail](body)
}
func (a *App) ForgeModVersions(kind models.ForgeKind, id uint32, page int) (*models.ForgeVersionsPage, error) {
	if a.Forge == nil {
		return nil, a.initFailure()
	}
	body, err := a.Forge.Versions(string(kind), id, page)
	if err != nil {
		return nil, err
	}
	return forgeResponse[models.ForgeVersionsPage](body)
}
func (a *App) ForgeAddonVersions(id uint32, page int) (*models.ForgeVersionsPage, error) {
	if a.Forge == nil {
		return nil, a.initFailure()
	}
	body, err := a.Forge.Versions("addon", id, page)
	if err != nil {
		return nil, err
	}
	return forgeResponse[models.ForgeVersionsPage](body)
}
func (a *App) ForgeDownloadVersion(input forge.ForgeDownloadVersionInput) (*models.OperationAccepted, error) {
	if a.Forge == nil {
		return nil, a.initFailure()
	}
	body, err := a.Forge.DownloadVersion(input)
	if err != nil {
		return nil, err
	}
	return forgeResponse[models.OperationAccepted](body)
}
func (a *App) ForgeMatchInstalledMod(input forge.ForgeMatchInstalledModInput) (*models.LibraryWorkspace, error) {
	if a.Forge == nil {
		return nil, a.initFailure()
	}
	return a.Forge.MatchInstalledMod(input)
}
