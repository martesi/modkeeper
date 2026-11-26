package library

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/BurntSushi/toml"
	"github.com/martes/modkeeper/backend/models"
)

const policyUncertainMarker = ".deployment-policy.pending"

func (l *Library) policyMarkerPath() string {
	return filepath.Join(l.Root, policyUncertainMarker)
}

func (s *Service) policyUncertain(libraryID string) bool {
	if s.active != nil && s.active.manifest.ID == libraryID {
		return s.active.PolicyUncertain
	}
	s.configMu.RLock()
	known := s.Store.Config.FindLibrary(libraryID)
	root := ""
	if known != nil {
		root = known.LibraryRoot
	}
	s.configMu.RUnlock()
	if root == "" {
		return false
	}
	_, err := os.Stat(filepath.Join(root, policyUncertainMarker))
	return err == nil || !errors.Is(err, os.ErrNotExist)
}

// SetDeploymentPolicy changes only the active idle library. Runtime and method
// choices are persisted together so Sync cannot observe a half-updated policy.
func (s *Service) SetDeploymentPolicy(input models.SetDeploymentPolicyInput) error {
	runtimeTarget, err := models.NormalizeTargetRuntime(input.TargetRuntime)
	if err != nil || input.TargetRuntime == "" {
		return models.Fail(models.ParseError, "target runtime is required and must be supported")
	}
	method := input.DeploymentMethod
	if !method.Valid() || method == models.DeploymentMethodCopyFirst {
		return models.Fail(models.ParseError, "invalid deployment method")
	}
	if !verifiedPolicy(s.policyHostRuntime(), runtimeTarget, method) {
		return models.Fail(models.ParseError, "this runtime and deployment method have not been verified on this platform")
	}
	if err := s.tryBeginLibraryTransition(); err != nil {
		return err
	}
	defer s.libraryMu.Unlock()
	if s.active == nil {
		return models.Fail(models.NoActiveLibrary)
	}
	if s.active.manifest.ID != input.LibraryID {
		return models.Fail(models.InvalidLibrary, input.LibraryID, "not the active library")
	}
	if s.active.PolicyUncertain {
		return policyRecoveryRequired()
	}
	if s.active.manifest.TargetRuntime == runtimeTarget && s.active.manifest.DeploymentMethod == method {
		return nil
	}
	previous := s.active.manifest
	next := previous
	next.TargetRuntime = runtimeTarget
	next.DeploymentMethod = method
	next.IsDirty = true
	syncDir := s.policySyncDir
	if syncDir == nil {
		syncDir = syncLibraryDir
	}
	if err := commitDeploymentPolicy(s.active, next, syncDir); err != nil {
		if s.active.PolicyUncertain {
			return fmt.Errorf("%w: %w", policyRecoveryRequired(), err)
		}
		s.active.manifest = previous
		return err
	}
	s.active.manifest = next
	return nil
}

func (s *Service) policyHostRuntime() string {
	if s.policyHost != "" {
		return s.policyHost
	}
	return hostRuntime()
}

func verifiedPolicy(host string, target models.TargetRuntime, method models.DeploymentMethod) bool {
	// New policy controls remain limited to a native Linux host and Linux game.
	// Windows and WSL need their own consumer-side probes before support is enabled.
	return host == "linux" && target == models.TargetLinux &&
		(method == models.DeploymentMethodCopy || method == models.DeploymentMethodLink)
}

func policyRecoveryRequired() error {
	return models.Fail(models.IOError, "A deployment policy save is uncertain. Preserve the library and review its manifest and .deployment-policy.pending marker before retrying. Sync and further policy changes are blocked.")
}

func commitDeploymentPolicy(l *Library, next manifest, syncDir func(string) error) error {
	marker := l.policyMarkerPath()
	markerFile, err := os.OpenFile(marker, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		if errors.Is(err, os.ErrExist) {
			l.PolicyUncertain = true
		}
		return fmt.Errorf("create policy recovery marker: %w", err)
	}
	if _, err = markerFile.WriteString("deployment policy update pending\n"); err == nil {
		err = markerFile.Sync()
	}
	closeErr := markerFile.Close()
	if err == nil {
		err = closeErr
	}
	if err == nil {
		err = syncDir(l.Root)
	}
	if err != nil {
		return clearPolicyMarker(l, syncDir, err)
	}

	file, err := os.CreateTemp(l.Root, ".deployment-policy-*")
	if err != nil {
		return clearPolicyMarker(l, syncDir, err)
	}
	tmp := file.Name()
	cleanup := func() { _ = os.Remove(tmp) }
	if err = toml.NewEncoder(file).Encode(next); err == nil {
		err = file.Sync()
	}
	closeErr = file.Close()
	if err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(tmp, filepath.Join(l.Root, "manifest.toml"))
	}
	if err != nil {
		cleanup()
		return clearPolicyMarker(l, syncDir, err)
	}

	// The marker remains durable until the manifest replacement is directory-
	// synced. Any error after rename is uncertain and must not be rolled back in
	// memory or hidden from Sync.
	if err := syncDir(l.Root); err != nil {
		l.PolicyUncertain = true
		if persisted, readErr := readStrictManifest(filepath.Join(l.Root, "manifest.toml")); readErr == nil {
			l.manifest = persisted
		} else {
			l.manifest.TargetRuntime = ""
			l.manifest.DeploymentMethod = ""
		}
		return fmt.Errorf("manifest replaced but directory sync failed: %w", err)
	}
	l.manifest = next
	if err := os.Remove(marker); err != nil && !errors.Is(err, os.ErrNotExist) {
		l.PolicyUncertain = true
		return fmt.Errorf("manifest committed but recovery marker removal failed: %w", err)
	}
	if err := syncDir(l.Root); err != nil {
		l.PolicyUncertain = true
		return fmt.Errorf("manifest committed but recovery marker directory sync failed: %w", err)
	}
	l.PolicyUncertain = false
	return nil
}

func clearPolicyMarker(l *Library, syncDir func(string) error, cause error) error {
	if err := os.Remove(l.policyMarkerPath()); err != nil && !errors.Is(err, os.ErrNotExist) {
		l.PolicyUncertain = true
		return fmt.Errorf("%w; remove policy recovery marker: %w", cause, err)
	}
	if err := syncDir(l.Root); err != nil {
		l.PolicyUncertain = true
		return fmt.Errorf("%w; sync policy recovery marker removal: %w", cause, err)
	}
	return cause
}
