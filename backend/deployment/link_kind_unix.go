//go:build !windows

package deployment

import (
	"os"

	"github.com/martes/modkeeper/backend/linker"
)

func inspectLink(path string) (os.FileInfo, linker.ArtifactKind, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, "", err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return info, linker.Symlink, nil
	}
	return info, "", nil
}
