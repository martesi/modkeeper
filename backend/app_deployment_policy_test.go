package backend

import (
	"errors"
	"path/filepath"
	"testing"

	"github.com/martes/modkeeper/backend/models"
	"github.com/martes/modkeeper/backend/testenv"
)

func TestTargetRuntimeDeploymentMethodAppWorkspaceContract(t *testing.T) {
	env := testenv.New(t)
	app := NewAppAt(filepath.Join(env.Root, "config.toml"))
	if err := app.Start(); err != nil {
		t.Fatal(err)
	}
	root := env.LibraryRoot
	workspace, err := app.CreateLibrary(models.CreateLibraryInput{GameRoot: env.GameRoot, LibraryRoot: &root})
	if err != nil {
		t.Fatal(err)
	}
	if len(workspace.Libraries) != 1 || workspace.Libraries[0].Summary == nil {
		t.Fatalf("created workspace = %+v", workspace)
	}
	initial := workspace.Libraries[0].Summary
	if initial.TargetRuntime != models.TargetWindows || initial.DeploymentMethod != models.DeploymentMethodCopyFirst {
		t.Fatalf("legacy-compatible defaults = %s/%s", initial.TargetRuntime, initial.DeploymentMethod)
	}
	input := models.SetDeploymentPolicyInput{
		LibraryID: *workspace.ActiveLibraryID, TargetRuntime: models.TargetLinux, DeploymentMethod: models.DeploymentMethodCopy,
	}
	updated, err := app.SetDeploymentPolicy(input)
	if initial.HostRuntime == "linux" {
		if err != nil || updated == nil || updated.Libraries[0].Summary.TargetRuntime != models.TargetLinux || !updated.Libraries[0].Summary.DeployStale {
			t.Fatalf("verified policy update workspace=%+v err=%v", updated, err)
		}
		return
	}
	var coded *models.Error
	if updated != nil || !errors.As(err, &coded) || coded.Code != models.ParseError {
		t.Fatalf("unverified host accepted policy: workspace=%+v err=%v", updated, err)
	}
	unchanged, err := app.GetLibraryWorkspace()
	if err != nil || unchanged.Libraries[0].Summary.TargetRuntime != models.TargetWindows {
		t.Fatalf("rejected policy changed workspace: %+v %v", unchanged, err)
	}
}
