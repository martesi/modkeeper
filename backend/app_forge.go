package backend

import (
	"encoding/json"
	"github.com/martes/modkeeper/backend/forge"
	"sync"
)

var forgeCommands = struct {
	sync.RWMutex
	service *forge.Service
}{service: forge.NewService(nil, nil)}

// ConfigureForgeService is called once during startup by library integration.
func ConfigureForgeService(service *forge.Service) {
	forgeCommands.Lock()
	defer forgeCommands.Unlock()
	if service == nil {
		service = forge.NewService(nil, nil)
	}
	forgeCommands.service = service
}
func forgeService() *forge.Service {
	forgeCommands.RLock()
	defer forgeCommands.RUnlock()
	return forgeCommands.service
}
func (a *App) ForgeSearch(query string, modPage, addonPage, perPage int) (json.RawMessage, bool, error) {
	return forgeService().Search(query, modPage, addonPage, perPage)
}
func (a *App) ForgeModDetail(modID uint32) (json.RawMessage, bool, error) {
	return forgeService().ModDetail(modID)
}
func (a *App) ForgeModVersions(modID uint32) (json.RawMessage, bool, error) {
	return forgeService().ModVersions(modID)
}
func (a *App) ForgeAddonVersions(addonID uint32) (json.RawMessage, bool, error) {
	return forgeService().AddonVersions(addonID)
}
func (a *App) ForgeDownloadVersion(input forge.ForgeDownloadVersionInput) (json.RawMessage, error) {
	return forgeService().DownloadVersion(input)
}
