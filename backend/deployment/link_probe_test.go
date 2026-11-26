package deployment

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"syscall"
	"testing"

	"github.com/martes/modkeeper/backend/linker"
	"github.com/martes/modkeeper/backend/models"
)

func TestLinkProbeSeparatesUnsupportedFromPermissionErrors(t *testing.T) {
	l := fixture(t)
	unsupported := probeSymlinkConsumerWithLinker(l, func(string, string, linker.ArtifactKind) error {
		return syscall.EOPNOTSUPP
	})
	var unsupportedErr unsupportedLinkError
	if !errors.As(unsupported, &unsupportedErr) {
		t.Fatalf("unsupported link probe error = %v", unsupported)
	}
	permission := probeSymlinkConsumerWithLinker(l, func(string, string, linker.ArtifactKind) error {
		return os.ErrPermission
	})
	if errors.As(permission, &unsupportedErr) || !errors.Is(permission, os.ErrPermission) {
		t.Fatalf("permission error was misclassified: %v", permission)
	}
}

func TestExplicitLinkFailureDoesNotFallBackOrMutateDeployment(t *testing.T) {
	l := fixture(t)
	m := mod(t, l, "enabled", map[string]string{"SPT/user/mods/Sentinel/file.txt": "original"})
	if _, err := Sync(context.Background(), l, []models.Mod{m}, nil); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(l.GameRoot, "SPT/user/mods/Sentinel/file.txt")
	content(t, target, "original")
	stateBefore, err := os.ReadFile(l.Paths().Deployment)
	must(t, err)
	unrelated := filepath.Join(l.GameRoot, "unrelated-user-file.txt")
	write(t, unrelated, "keep")

	_, err = syncWithPolicy(
		context.Background(), l, []models.Mod{m}, models.DeploymentPolicy{TargetRuntime: models.TargetLinux, DeploymentMethod: models.DeploymentMethodLink}, nil,
		func(Layout) error { return unsupportedLinkError{cause: syscall.EOPNOTSUPP} },
	)
	code(t, err, models.ParseError)
	stateAfter, readErr := os.ReadFile(l.Paths().Deployment)
	must(t, readErr)
	if string(stateAfter) != string(stateBefore) {
		t.Fatal("deployment state changed after selected Link probe failed")
	}
	content(t, target, "original")
	content(t, unrelated, "keep")
}
