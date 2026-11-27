package deployment

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/BurntSushi/toml"
	"github.com/martes/modkeeper/backend/linker"
	"github.com/martes/modkeeper/backend/models"
)

const legacyDeploymentFilename = "deployment.toml"

// checkLegacyDeployment reads the old record only to block adoption of
// unproven files. New Sync never updates or moves the old record.
func checkLegacyDeployment(l Layout) error {
	path := filepath.Join(l.LibraryRoot, legacyDeploymentFilename)
	info, err := os.Lstat(path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return ioError(err)
	}
	if !info.Mode().IsRegular() {
		return collision(path)
	}
	f, err := os.Open(path)
	if err != nil {
		return ioError(err)
	}
	defer f.Close()
	opened, err := f.Stat()
	if err != nil {
		return ioError(err)
	}
	if !os.SameFile(info, opened) {
		return collision(path)
	}
	var record struct {
		Artifacts []struct {
			Target      string              `toml:"target"`
			Source      string              `toml:"source"`
			Kind        linker.ArtifactKind `toml:"kind"`
			Fingerprint *string             `toml:"fingerprint"`
		} `toml:"artifacts"`
		CreatedDirs   []string                `toml:"created_dirs"`
		Method        models.DeploymentMethod `toml:"method"`
		TargetRuntime models.TargetRuntime    `toml:"target_runtime"`
	}
	md, err := toml.NewDecoder(f).Decode(&record)
	if err != nil {
		return invalid(l, legacyDeploymentFilename+": "+err.Error())
	}
	if !md.IsDefined("artifacts") || !md.IsDefined("created_dirs") || len(md.Undecoded()) != 0 {
		return invalid(l, legacyDeploymentFilename+" is not a recognized legacy deployment record")
	}
	for _, a := range record.Artifacts {
		if !contained(l.GameRoot, a.Target, false) || !safeRelative(a.Source) {
			return invalid(l, legacyDeploymentFilename+" has an invalid legacy artifact path")
		}
		switch a.Kind {
		case linker.Copy, linker.Hardlink, linker.Symlink, linker.Junction:
		default:
			return invalid(l, legacyDeploymentFilename+" has an invalid legacy artifact kind")
		}
		target := filepath.Join(l.GameRoot, a.Target)
		_, err := os.Lstat(target)
		if err == nil || isLink(target) {
			return invalid(l, fmt.Sprintf("Legacy deployment still has %q. Back up or undeploy those files before upgrading; ModKeeper has not changed the game files.", target))
		}
		if !os.IsNotExist(err) {
			return ioError(fmt.Errorf("inspect legacy target %q: %w", target, err))
		}
	}
	// Legacy directory records never become new ownership claims.
	return nil
}
