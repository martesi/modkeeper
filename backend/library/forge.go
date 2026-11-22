package library

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/Masterminds/semver/v3"
	"github.com/martes/modkeeper/backend/forge"
	"github.com/martes/modkeeper/backend/models"
	"github.com/martes/modkeeper/backend/modmanager"
	"github.com/martes/modkeeper/backend/stager"
)

// ActiveSPTVersion returns the active library's recorded SPT version. Forge
// commands fail closed when no library is active.
func (s *Service) ActiveSPTVersion() (string, error) {
	s.libraryMu.RLock()
	defer s.libraryMu.RUnlock()
	if s.active == nil {
		return "", models.Fail(models.NoActiveLibrary)
	}
	return s.active.manifest.SPTVersion, nil
}

// ForgeInstallHooks binds the Forge service to the library paths that own
// admission, staging, installation, matching, and completion events.
func (s *Service) ForgeInstallHooks() forge.InstallHooks {
	return forge.InstallHooks{
		Admit:         s.admitForgeDownload,
		Install:       s.installForgeArchive,
		Match:         s.matchForgeMetadata,
		AssertLibrary: s.assertForgeLibrary,
		SendProgress: func(event models.TaskProgressEvent) error {
			if s.sendProgress == nil {
				return nil
			}
			return s.sendProgress(event)
		},
		Complete: s.completeForgeInstall,
		Release:  s.releaseForgeTask,
	}
}

// admitForgeDownload asserts the active library, captures the stage root, and
// only then reserves the task ID. The lock is not held across the download.
func (s *Service) admitForgeDownload(input forge.ForgeDownloadVersionInput) (string, string, error) {
	if input.TaskID == "" || input.LibraryID == "" {
		return "", "", models.Fail(models.ParseError, "taskId and libraryId are required")
	}
	s.libraryMu.RLock()
	if s.active == nil {
		s.libraryMu.RUnlock()
		return "", "", models.Fail(models.NoActiveLibrary)
	}
	if s.active.manifest.ID != input.LibraryID {
		s.libraryMu.RUnlock()
		return "", "", models.Fail(models.InvalidLibrary, input.LibraryID)
	}
	spt, root := s.active.manifest.SPTVersion, s.active.StagingDir
	s.libraryMu.RUnlock()
	if err := s.Registry.AcquireTaskWithCancellable(input.TaskID, input.LibraryID, func() {}, false); err != nil {
		return "", "", err
	}
	s.beginTask()
	return spt, root, nil
}

func (s *Service) releaseForgeTask(taskID string) {
	s.Registry.FinishTaskID(taskID)
	s.endTask()
}

func (s *Service) completeForgeInstall(input forge.ForgeDownloadVersionInput, installErr error) {
	failures := []models.ArchiveFailure{}
	if installErr != nil {
		failures = append(failures, models.ArchiveFailure{
			ArchivePath: fmt.Sprintf("forge:%s:%d:%d", input.Kind, input.ItemID, input.VersionID),
			Error:       forgeWireError(installErr),
		})
	}
	if s.sendWorkspace == nil {
		return
	}
	_ = s.sendWorkspace(models.WorkspaceEvent{
		Type:      models.WorkspaceEventModInstallCompleted,
		TaskID:    input.TaskID,
		LibraryID: input.LibraryID,
		Failures:  failures,
		Workspace: *s.Workspace(),
	})
}

func forgeWireError(err error) models.Error {
	var coded *models.Error
	if errors.As(err, &coded) {
		return *coded
	}
	var forgeErr *forge.Error
	if errors.As(err, &forgeErr) {
		return models.Error{Code: forgeErr.Code, Data: forgeErr.Data}
	}
	return models.Error{Code: models.Unexpected, Data: err.Error()}
}

func (s *Service) assertForgeLibrary(libraryID string) error {
	s.libraryMu.RLock()
	defer s.libraryMu.RUnlock()
	return s.assertActiveLibraryLocked(libraryID)
}

func (s *Service) assertActiveLibraryLocked(libraryID string) error {
	if s.active == nil {
		return models.Fail(models.NoActiveLibrary)
	}
	if s.active.manifest.ID != libraryID {
		return models.Fail(models.InvalidLibrary, libraryID)
	}
	return nil
}

// installForgeArchive stages the downloaded archive, validates an addon parent
// against the installed Forge metadata, and installs it through the standard
// transaction path. It mirrors library_service::install_forge_archive.
func (s *Service) installForgeArchive(input forge.ForgeDownloadVersionInput, archive string, metadata forge.InstallMetadata, constraint *forge.AddonConstraint, progress forge.Progress) error {
	s.libraryMu.RLock()
	defer s.libraryMu.RUnlock()
	s.modWrites.Lock()
	defer s.modWrites.Unlock()
	if err := s.assertActiveLibraryLocked(input.LibraryID); err != nil {
		return err
	}
	progress(models.TaskStageForgeStage, nil)
	staged, err := stager.Resolve([]string{archive}, s.active.StagingDir, "SPT/user/mods", "BepInEx/plugins", nil)
	if err != nil {
		return err
	}
	if len(staged) != 1 {
		for _, item := range staged {
			_ = stager.CleanUp(item.IsStaging, item.Root)
		}
		return models.Fail(models.ParseError, fmt.Sprintf("Forge archive produced %d installable entries; expected exactly one", len(staged)))
	}
	item := staged[0]
	if input.Kind == "addon" {
		progress(models.TaskStageForgeParentValidation, nil)
		if err := s.validateForgeAddonParent(constraint); err != nil {
			_ = stager.CleanUp(item.IsStaging, item.Root)
			return err
		}
	}
	progress(models.TaskStageForgeInstall, nil)
	l := modmanager.Library{Root: s.active.ModsDir, Mods: s.active.manifest.Mods}
	enable := s.Store.Config.Settings.EnableModsOnInstall
	return s.installStagedMod(context.Background(), archive, item, &l, enable, forgeIdentity(metadata), progress)
}

func forgeIdentity(metadata forge.InstallMetadata) *models.ForgeIdentity {
	return &models.ForgeIdentity{
		Kind:      metadata.Kind,
		ID:        uint32(metadata.ForgeID),
		GUID:      metadata.ForgeGUID,
		VersionID: uint32(metadata.VersionID),
		Version:   metadata.Version,
		CachedAt:  metadata.CachedAt,
	}
}

// matchForgeMetadata links an existing local install to a Forge identity and
// returns the refreshed workspace, matching forge_match_installed_mod.
func (s *Service) matchForgeMetadata(input forge.ForgeMatchInstalledModInput, metadata forge.InstallMetadata, constraint *forge.AddonConstraint) (json.RawMessage, error) {
	if err := s.applyForgeMatch(input, metadata, constraint); err != nil {
		return nil, err
	}
	return json.Marshal(s.Workspace())
}

func (s *Service) applyForgeMatch(input forge.ForgeMatchInstalledModInput, metadata forge.InstallMetadata, constraint *forge.AddonConstraint) error {
	s.libraryMu.RLock()
	defer s.libraryMu.RUnlock()
	s.modWrites.Lock()
	defer s.modWrites.Unlock()
	if err := s.assertActiveLibraryLocked(input.LibraryID); err != nil {
		return err
	}
	if input.Kind == "addon" {
		if err := s.validateForgeAddonParent(constraint); err != nil {
			return err
		}
	}
	mod, ok := s.active.manifest.Mods[input.InstalledModID]
	if !ok {
		return models.Fail(models.ModNotFound, input.InstalledModID)
	}
	version, cachedAt := metadata.Version, metadata.CachedAt
	kind, forgeID, versionID := models.ForgeKind(metadata.Kind), metadata.ForgeID, metadata.VersionID
	guid := metadata.ForgeGUID
	mod.Version, mod.ForgeGUID, mod.ForgeMetaCachedAt = &version, &guid, &cachedAt
	mod.ForgeKind, mod.ForgeID, mod.ForgeVersionID = &kind, &forgeID, &versionID
	mod.Source = models.ModSourceForge
	s.active.manifest.Mods[input.InstalledModID] = mod
	s.active.manifest.IsDirty = true
	return s.active.Persist()
}

func (s *Service) validateForgeAddonParent(constraint *forge.AddonConstraint) error {
	if constraint == nil {
		return models.Fail(models.ParseError, "Forge addon parent metadata is missing")
	}
	if constraint.IsDetached {
		return nil
	}
	if constraint.ParentGUID == nil {
		return models.Fail(models.ParseError, "Forge addon has no positively identified parent GUID")
	}
	if constraint.ParentForgeID == nil {
		return models.Fail(models.ParseError, "Forge addon has no parent Forge ID")
	}
	if constraint.VersionConstraint == nil {
		return models.Fail(models.ParseError, "Forge addon parent version constraint is missing")
	}
	parentID, parentGUID := *constraint.ParentForgeID, *constraint.ParentGUID
	for _, mod := range s.active.manifest.Mods {
		if mod.Source != models.ModSourceForge || mod.ForgeKind == nil || *mod.ForgeKind != models.ForgeKindMod {
			continue
		}
		if mod.ForgeID == nil || *mod.ForgeID != parentID || mod.ForgeGUID == nil || *mod.ForgeGUID != parentGUID {
			continue
		}
		if mod.Version == nil {
			return models.Fail(models.ParseError, fmt.Sprintf("Installed Forge parent %s has no recorded version", parentGUID))
		}
		matches, err := forgeVersionMatches(*mod.Version, *constraint.VersionConstraint)
		if err != nil {
			return err
		}
		if !matches {
			return models.Fail(models.ParseError, fmt.Sprintf("Forge addon requires parent %s at %s, installed version is %s", parentGUID, *constraint.VersionConstraint, *mod.Version))
		}
		return nil
	}
	return models.Fail(models.ParseError, fmt.Sprintf("Forge addon requires installed parent %d (%s)", parentID, parentGUID))
}

// forgeVersionMatches evaluates the addon parent constraint with the Rust
// semver requirement syntax used by library_service::forge_version_matches.
func forgeVersionMatches(version, constraint string) (bool, error) {
	requirement, err := semver.NewConstraint(constraint)
	if err != nil {
		return false, models.Fail(models.ParseError, "Invalid Forge addon parent constraint: "+err.Error())
	}
	parsed, err := semver.NewVersion(version)
	if err != nil {
		return false, models.Fail(models.ParseError, "Installed Forge parent version cannot be evaluated: "+err.Error())
	}
	return requirement.Check(parsed), nil
}
