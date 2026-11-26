package library

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/martes/modkeeper/backend/deployment"
	"github.com/martes/modkeeper/backend/models"
	"github.com/martes/modkeeper/backend/process"
	"github.com/martes/modkeeper/backend/testenv"
)

func TestDeploymentPolicyLegacyDefaultsAndRoundTripsPerLibrary(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("native Linux policy fixture")
	}
	env := testenv.New(t)
	service, err := New(filepath.Join(env.Root, "config.toml"))
	if err != nil {
		t.Fatal(err)
	}
	if err := service.Start(); err != nil {
		t.Fatal(err)
	}
	service.policyHost = "linux"
	if err := service.CreateLibrary(models.CreateLibraryInput{GameRoot: env.GameRoot, LibraryRoot: &env.LibraryRoot}); err != nil {
		t.Fatal(err)
	}
	id := service.active.manifest.ID
	if got := service.active.manifest; got.TargetRuntime != models.TargetWindows || got.DeploymentMethod != models.DeploymentMethodCopyFirst {
		t.Fatalf("legacy/default policy = %s/%s", got.TargetRuntime, got.DeploymentMethod)
	}
	if err := service.SetDeploymentPolicy(models.SetDeploymentPolicyInput{
		LibraryID: id, TargetRuntime: models.TargetLinux, DeploymentMethod: models.DeploymentMethodCopy,
	}); err != nil {
		t.Fatal(err)
	}
	if !service.active.manifest.IsDirty {
		t.Fatal("policy change did not mark deployment stale")
	}
	reloaded, err := Load(env.LibraryRoot)
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.manifest.TargetRuntime != models.TargetLinux || reloaded.manifest.DeploymentMethod != models.DeploymentMethodCopy {
		t.Fatalf("persisted policy = %s/%s", reloaded.manifest.TargetRuntime, reloaded.manifest.DeploymentMethod)
	}
	secondRoot := filepath.Join(env.Root, "second-library")
	if err := service.CreateLibrary(models.CreateLibraryInput{GameRoot: env.GameRoot, LibraryRoot: &secondRoot}); err != nil {
		t.Fatal(err)
	}
	firstReload, err := Load(env.LibraryRoot)
	if err != nil || firstReload.manifest.TargetRuntime != models.TargetLinux || firstReload.manifest.DeploymentMethod != models.DeploymentMethodCopy {
		t.Fatalf("first library policy changed when switching: %+v, %v", firstReload, err)
	}
	if service.active.manifest.TargetRuntime != models.TargetWindows || service.active.manifest.DeploymentMethod != models.DeploymentMethodCopyFirst {
		t.Fatal("second library inherited the first library's policy")
	}
}

func TestLegacyManifestDefaultsAndRejectsUnknownPolicyValues(t *testing.T) {
	env := testenv.New(t)
	if _, err := Create(env.GameRoot, env.LibraryRoot, "legacy"); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(env.LibraryRoot, "manifest.toml"))
	if err != nil {
		t.Fatal(err)
	}
	legacy := strings.ReplaceAll(string(data), "targetRuntime = \"windows\"\n", "")
	legacy = strings.ReplaceAll(legacy, "deploymentMethod = \"copy-first\"\n", "")
	if err := os.WriteFile(filepath.Join(env.LibraryRoot, "manifest.toml"), []byte(legacy), 0600); err != nil {
		t.Fatal(err)
	}
	loaded, err := Load(env.LibraryRoot)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.manifest.TargetRuntime != models.TargetWindows || loaded.manifest.DeploymentMethod != models.DeploymentMethodCopyFirst {
		t.Fatalf("legacy manifest defaults=%s/%s", loaded.manifest.TargetRuntime, loaded.manifest.DeploymentMethod)
	}
	invalid := strings.ReplaceAll(legacy, "isDirty = false", "isDirty = false\ntargetRuntime = \"unknown-os\"")
	if err := os.WriteFile(filepath.Join(env.LibraryRoot, "manifest.toml"), []byte(invalid), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(env.LibraryRoot); err == nil {
		t.Fatal("unknown persisted runtime was accepted")
	}
	invalid = strings.ReplaceAll(legacy, "isDirty = false", "isDirty = false\ndeploymentMethod = \"unknown\"")
	if err := os.WriteFile(filepath.Join(env.LibraryRoot, "manifest.toml"), []byte(invalid), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(env.LibraryRoot); err == nil {
		t.Fatal("unknown persisted deployment method was accepted")
	}
	invalid = strings.ReplaceAll(legacy, "isDirty = false", "isDirty = false\ntargetRuntime = \"\"")
	if err := os.WriteFile(filepath.Join(env.LibraryRoot, "manifest.toml"), []byte(invalid), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(env.LibraryRoot); err == nil {
		t.Fatal("explicit empty runtime was accepted as a legacy default")
	}
}

func TestDeploymentPolicyInvalidAndUnverifiedChoicesAreRejected(t *testing.T) {
	env := testenv.New(t)
	service, err := New(filepath.Join(env.Root, "config.toml"))
	if err != nil {
		t.Fatal(err)
	}
	if err := service.Start(); err != nil {
		t.Fatal(err)
	}
	service.policyHost = "linux"
	if err := service.CreateLibrary(models.CreateLibraryInput{GameRoot: env.GameRoot, LibraryRoot: &env.LibraryRoot}); err != nil {
		t.Fatal(err)
	}
	id := service.active.manifest.ID
	for _, input := range []models.SetDeploymentPolicyInput{
		{LibraryID: id, TargetRuntime: "macos", DeploymentMethod: models.DeploymentMethodCopy},
		{LibraryID: id, TargetRuntime: models.TargetWindows, DeploymentMethod: models.DeploymentMethodLink},
		{LibraryID: "inactive", TargetRuntime: models.TargetLinux, DeploymentMethod: models.DeploymentMethodCopy},
	} {
		if err := service.SetDeploymentPolicy(input); err == nil {
			t.Fatalf("accepted unverified or invalid policy %+v", input)
		}
	}
	if service.active.manifest.TargetRuntime != models.TargetWindows || service.active.manifest.DeploymentMethod != models.DeploymentMethodCopyFirst {
		t.Fatal("rejected policy changed active policy")
	}
	service.libraryMu.RLock()
	err = service.SetDeploymentPolicy(models.SetDeploymentPolicyInput{
		LibraryID: id, TargetRuntime: models.TargetLinux, DeploymentMethod: models.DeploymentMethodCopy,
	})
	service.libraryMu.RUnlock()
	var coded *models.Error
	if !errors.As(err, &coded) || coded.Code != models.LibraryBusy {
		t.Fatalf("busy setting change = %v, want LibraryBusy", err)
	}
}

func TestDeploymentPolicyRemainsDisabledInWSL(t *testing.T) {
	if hostRuntime() != "wsl" {
		t.Skip("requires WSL host detection")
	}
	env := testenv.New(t)
	service, err := New(filepath.Join(env.Root, "config.toml"))
	if err != nil {
		t.Fatal(err)
	}
	if err := service.Start(); err != nil {
		t.Fatal(err)
	}
	if err := service.CreateLibrary(models.CreateLibraryInput{GameRoot: env.GameRoot, LibraryRoot: &env.LibraryRoot}); err != nil {
		t.Fatal(err)
	}
	err = service.SetDeploymentPolicy(models.SetDeploymentPolicyInput{
		LibraryID: service.active.manifest.ID, TargetRuntime: models.TargetLinux, DeploymentMethod: models.DeploymentMethodCopy,
	})
	if err == nil {
		t.Fatal("enabled an unverified WSL policy")
	}
}

func TestDeploymentPolicySaveFailureBeforeReplacementRetainsOldPolicy(t *testing.T) {
	env := testenv.New(t)
	service := createPolicyService(t, env)
	oldManifest, err := os.ReadFile(filepath.Join(env.LibraryRoot, "manifest.toml"))
	if err != nil {
		t.Fatal(err)
	}
	service.policySyncDir = func(string) error { return errors.New("injected directory sync failure") }
	err = service.SetDeploymentPolicy(models.SetDeploymentPolicyInput{
		LibraryID: service.active.manifest.ID, TargetRuntime: models.TargetLinux, DeploymentMethod: models.DeploymentMethodCopy,
	})
	if err == nil {
		t.Fatal("expected pre-replacement failure")
	}
	gotManifest, readErr := os.ReadFile(filepath.Join(env.LibraryRoot, "manifest.toml"))
	if readErr != nil || string(gotManifest) != string(oldManifest) {
		t.Fatalf("manifest changed on failed pre-replacement save: %v", readErr)
	}
	if service.active.manifest.TargetRuntime != models.TargetWindows || service.active.manifest.DeploymentMethod != models.DeploymentMethodCopyFirst {
		t.Fatal("in-memory policy changed before replacement")
	}
}

func TestDeploymentPolicyPostReplacementFailureBlocksSyncUntilRecovery(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("native Linux policy fixture")
	}
	env := testenv.New(t)
	service := createPolicyService(t, env)
	calls := 0
	service.policySyncDir = func(path string) error {
		calls++
		if calls == 2 {
			return errors.New("injected post-replacement directory sync failure")
		}
		return syncLibraryDir(path)
	}
	err := service.SetDeploymentPolicy(models.SetDeploymentPolicyInput{
		LibraryID: service.active.manifest.ID, TargetRuntime: models.TargetLinux, DeploymentMethod: models.DeploymentMethodCopy,
	})
	if err == nil || !service.active.PolicyUncertain {
		t.Fatalf("post-replacement failure err=%v uncertain=%t", err, service.active.PolicyUncertain)
	}
	if service.active.manifest.TargetRuntime != models.TargetLinux {
		t.Fatal("in-memory state falsely rolled back after visible replacement")
	}
	reloaded, err := Load(env.LibraryRoot)
	if err != nil || !reloaded.PolicyUncertain || reloaded.manifest.TargetRuntime != "" || reloaded.manifest.DeploymentMethod != "" {
		t.Fatalf("restart policy=%+v err=%v", reloaded, err)
	}
	service.Inspector = process.Fake{}
	if _, err := service.SyncMods(models.SyncModsInput{TaskID: "blocked-sync", LibraryID: service.active.manifest.ID}, nil); err == nil {
		t.Fatal("Sync admitted while policy recovery is required")
	}
	restarted, err := New(filepath.Join(env.Root, "config.toml"))
	if err != nil {
		t.Fatal(err)
	}
	if err := restarted.Start(); err != nil {
		t.Fatal(err)
	}
	if err := restarted.WaitForInitialLoad(); err != nil {
		t.Fatal(err)
	}
	if restarted.active == nil || !restarted.active.PolicyUncertain {
		t.Fatal("restart did not preserve the uncertain policy state")
	}
	if _, err := restarted.SyncMods(models.SyncModsInput{TaskID: "blocked-after-restart", LibraryID: restarted.active.manifest.ID}, nil); err == nil {
		t.Fatal("Sync admitted after restart with unresolved policy marker")
	}
}

func TestLibrarySyncModsUsesPersistedDeploymentPolicy(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("native Linux consumer fixture")
	}
	env := testenv.New(t)
	service := createPolicyService(t, env)
	service.Inspector = process.Fake{}
	if err := service.SetDeploymentPolicy(models.SetDeploymentPolicyInput{
		LibraryID: service.active.manifest.ID, TargetRuntime: models.TargetLinux, DeploymentMethod: models.DeploymentMethodLink,
	}); err != nil {
		t.Fatal(err)
	}
	mod := models.Mod{ID: "fixture", Enabled: true, Type: models.ModTypeServer}
	service.active.manifest.Mods[mod.ID] = mod
	source := filepath.Join(service.active.ModsDir, mod.ID, "SPT", "user", "mods", "Sentinel", "content.txt")
	if err := os.MkdirAll(filepath.Dir(source), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(source, []byte("sentinel"), 0644); err != nil {
		t.Fatal(err)
	}
	unrelated := filepath.Join(env.GameRoot, "user-owned.txt")
	if err := os.WriteFile(unrelated, []byte("keep"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SyncMods(models.SyncModsInput{TaskID: "selected-link-sync", LibraryID: service.active.manifest.ID}, nil); err != nil {
		t.Fatal(err)
	}
	service.Wait()
	deployed := filepath.Join(env.GameRoot, "SPT", "user", "mods", "Sentinel", "content.txt")
	contents, err := os.ReadFile(deployed)
	if err != nil || string(contents) != "sentinel" {
		t.Fatalf("deployed consumer read = %q, %v", contents, err)
	}
	if contents, err := os.ReadFile(unrelated); err != nil || string(contents) != "keep" {
		t.Fatalf("unrelated game file = %q, %v", contents, err)
	}
	state, err := deployment.LoadState(deployment.Layout{LibraryRoot: env.LibraryRoot, GameRoot: env.GameRoot})
	if err != nil || state.Method != models.DeploymentMethodLink || len(state.Artifacts) == 0 || state.Artifacts[0].Kind != "symlink" {
		t.Fatalf("deployment state = %+v, %v", state, err)
	}
}

func createPolicyService(t *testing.T, env *testenv.Env) *Service {
	t.Helper()
	service, err := New(filepath.Join(env.Root, "config.toml"))
	if err != nil {
		t.Fatal(err)
	}
	if err := service.Start(); err != nil {
		t.Fatal(err)
	}
	service.policyHost = "linux"
	if err := service.CreateLibrary(models.CreateLibraryInput{GameRoot: env.GameRoot, LibraryRoot: &env.LibraryRoot}); err != nil {
		t.Fatal(err)
	}
	return service
}
