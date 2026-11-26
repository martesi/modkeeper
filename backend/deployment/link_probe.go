package deployment

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"syscall"

	"github.com/martes/modkeeper/backend/linker"
)

// probeSymlinkConsumer verifies link creation and consumer reads on the actual
// library and game filesystems before Sync can change a deployment.
func probeSymlinkConsumer(l Layout) (result error) {
	return probeSymlinkConsumerWithLinker(l, linker.Create)
}

type unsupportedLinkError struct{ cause error }

func (e unsupportedLinkError) Error() string {
	return fmt.Sprintf("symbolic links are unsupported: %v", e.cause)
}
func (e unsupportedLinkError) Unwrap() error { return e.cause }

type probeCleanupError struct{ cause error }

func (e probeCleanupError) Error() string { return fmt.Sprintf("cleanup link probe: %v", e.cause) }
func (e probeCleanupError) Unwrap() error { return e.cause }

func probeSymlinkConsumerWithLinker(l Layout, createLink func(string, string, linker.ArtifactKind) error) (result error) {
	return probeSymlinkConsumerWithLinkerAndCleanup(l, createLink, os.RemoveAll)
}

func probeSymlinkConsumerWithLinkerAndCleanup(l Layout, createLink func(string, string, linker.ArtifactKind) error, removeAll func(string) error) (result error) {
	sourceRoot, err := os.MkdirTemp(l.LibraryRoot, ".link-probe-source-")
	if err != nil {
		return fmt.Errorf("create source probe: %w", err)
	}
	defer func() { result = errors.Join(result, cleanupProbePath(removeAll, sourceRoot)) }()
	targetRoot, err := os.MkdirTemp(l.GameRoot, ".link-probe-target-")
	if err != nil {
		return fmt.Errorf("create target probe: %w", err)
	}
	defer func() { result = errors.Join(result, cleanupProbePath(removeAll, targetRoot)) }()
	source := filepath.Join(sourceRoot, "sentinel")
	target := filepath.Join(targetRoot, "sentinel")
	sourceDir := filepath.Join(sourceRoot, "directory")
	targetDir := filepath.Join(targetRoot, "directory")
	if err := os.WriteFile(source, []byte("consumer-probe"), 0600); err != nil {
		return fmt.Errorf("write source probe: %w", err)
	}
	if err := createLink(source, target, linker.Symlink); err != nil {
		if errors.Is(err, syscall.ENOTSUP) || errors.Is(err, syscall.EOPNOTSUPP) || errors.Is(err, syscall.ENOSYS) {
			return unsupportedLinkError{cause: err}
		}
		return fmt.Errorf("create selected link: %w", err)
	}
	contents, err := os.ReadFile(target)
	if err != nil {
		return fmt.Errorf("read selected link as game consumer: %w", err)
	}
	if string(contents) != "consumer-probe" {
		return fmt.Errorf("game consumer read unexpected probe content %q", contents)
	}
	if err := os.Mkdir(sourceDir, 0700); err != nil {
		return fmt.Errorf("create source directory probe: %w", err)
	}
	if err := os.WriteFile(filepath.Join(sourceDir, "sentinel"), []byte("directory-probe"), 0600); err != nil {
		return fmt.Errorf("write directory probe: %w", err)
	}
	if err := createLink(sourceDir, targetDir, linker.Symlink); err != nil {
		if errors.Is(err, syscall.ENOTSUP) || errors.Is(err, syscall.EOPNOTSUPP) || errors.Is(err, syscall.ENOSYS) {
			return unsupportedLinkError{cause: err}
		}
		return fmt.Errorf("create selected directory link: %w", err)
	}
	contents, err = os.ReadFile(filepath.Join(targetDir, "sentinel"))
	if err != nil {
		return fmt.Errorf("read selected directory link as game consumer: %w", err)
	}
	if string(contents) != "directory-probe" {
		return fmt.Errorf("game consumer read unexpected directory probe content %q", contents)
	}
	return nil
}

func cleanupProbePath(removeAll func(string) error, path string) error {
	if err := removeAll(path); err != nil {
		return probeCleanupError{cause: err}
	}
	return nil
}
