package backend

import (
	"github.com/martes/modkeeper/backend/config"
	"github.com/martes/modkeeper/backend/library"
	"github.com/martes/modkeeper/backend/models"
)

func (a *App) GetLibraryWorkspace() (*models.LibraryWorkspace, error) {
	if a.Library == nil {
		return nil, a.initFailure()
	}
	return a.Library.Workspace(), nil
}
func (a *App) CreateLibrary(input models.CreateLibraryInput) (*models.LibraryWorkspace, error) {
	if a.Library == nil {
		return nil, a.initFailure()
	}
	if err := a.Library.CreateLibrary(input); err != nil {
		return nil, err
	}
	return a.Library.Workspace(), nil
}
func (a *App) ActivateLibrary(input models.ActivateLibraryInput) (*models.LibraryWorkspace, error) {
	if a.Library == nil {
		return nil, a.initFailure()
	}
	if err := a.Library.ActivateLibrary(input.LibraryID); err != nil {
		return nil, err
	}
	return a.Library.Workspace(), nil
}
func (a *App) RenameLibrary(input models.RenameLibraryInput) (*models.LibraryWorkspace, error) {
	if a.Library == nil {
		return nil, a.initFailure()
	}
	if err := a.Library.RenameLibrary(input.LibraryID, input.Name); err != nil {
		return nil, err
	}
	return a.Library.Workspace(), nil
}
func (a *App) DeleteLibrary(input models.DeleteLibraryInput) (*models.LibraryWorkspace, error) {
	if a.Library == nil {
		return nil, a.initFailure()
	}
	if err := a.Library.DeleteLibrary(input.LibraryID, input.DeleteFiles); err != nil {
		return nil, err
	}
	return a.Library.Workspace(), nil
}
func (a *App) BulkUpdateMods(input models.BulkUpdateModsInput) (*models.LibraryWorkspace, error) {
	if a.Library == nil {
		return nil, a.initFailure()
	}
	if err := a.Library.BulkUpdateMods(input); err != nil {
		return nil, err
	}
	return a.Library.Workspace(), nil
}
func (a *App) SyncMods(input models.SyncModsInput) (*models.OperationAccepted, error) {
	if a.Library == nil {
		return nil, a.initFailure()
	}
	return a.Library.SyncMods(input, nil)
}
func (a *App) InstallModArchives(input models.InstallModArchivesInput) (*models.OperationAccepted, error) {
	if a.Library == nil {
		return nil, a.initFailure()
	}
	return a.Library.InstallModArchives(input, nil)
}
func (a *App) RebuildLibraryCache(input models.RebuildLibraryCacheInput) (*models.OperationAccepted, error) {
	if a.Library == nil {
		return nil, a.initFailure()
	}
	return a.Library.RebuildLibraryCache(input, nil)
}
func (a *App) GetSettings() (config.AppSettings, error) {
	if a.Library == nil {
		return config.AppSettings{}, a.initFailure()
	}
	return a.Library.GetSettings(), nil
}
func (a *App) SaveSettings(settings config.AppSettings) (config.AppSettings, error) {
	if a.Library == nil {
		return config.AppSettings{}, a.initFailure()
	}
	return a.Library.SaveSettings(settings)
}

func NewLibraryService(path string) (*library.Service, error) { return library.New(path) }

func (a *App) initFailure() error {
	if a.InitErr != nil {
		return a.InitErr
	}
	return failure("Unexpected", "library service not initialized")
}
