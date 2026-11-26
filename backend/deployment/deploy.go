package deployment

import (
	"context"
	"errors"
	"github.com/martes/modkeeper/backend/linker"
	"github.com/martes/modkeeper/backend/models"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type Reporter interface {
	Progress(models.TaskProgressStage, *float64)
}

// ModFailure is kept local until the foundation's shared error records land.
type ModFailure struct {
	ModID string        `json:"modId"`
	Error *models.Error `json:"error"`
}
type Report struct {
	Failures []ModFailure
	Deployed int
}

func preflightState(l Layout, plan DeploymentPlan, state DeploymentState) ([]DeploymentArtifact, error) {
	for _, d := range state.CreatedDirs {
		if !contained(l.GameRoot, d, true) {
			return nil, collision(d)
		}
	}
	var remove []DeploymentArtifact
	for _, a := range state.Artifacts {
		if !contained(l.GameRoot, a.Target, false) {
			return nil, collision(a.Target)
		}
		keep := false
		for _, want := range plan.Artifacts {
			if equal(a, want) {
				ok, e := current(l, a)
				if e != nil {
					return nil, ioError(e)
				}
				keep = ok
				break
			}
		}
		if keep {
			continue
		}
		_, e := os.Lstat(filepath.Join(l.GameRoot, a.Target))
		if os.IsNotExist(e) {
			continue
		}
		if e != nil {
			return nil, ioError(e)
		}
		ok, e := recorded(l, a)
		if e != nil {
			return nil, ioError(e)
		}
		if !ok {
			return nil, collision(a.Target)
		}
		remove = append(remove, a)
	}
	for _, a := range plan.Artifacts {
		if !contained(l.GameRoot, a.Target, false) {
			return nil, collision(a.Target)
		}
		if _, ok := sourcePath(l, a.Source, true); !ok {
			return nil, collision(a.Source)
		}
		_, err := os.Lstat(filepath.Join(l.GameRoot, a.Target))
		if err == nil {
			owned := false
			for _, old := range state.Artifacts {
				if old.Target == a.Target {
					ok, e := recorded(l, old)
					if e != nil {
						return nil, ioError(e)
					}
					owned = owned || ok
				}
			}
			// Compatibility links are removed only after the full purge preflight.
			if raw, e := os.Readlink(filepath.Join(l.GameRoot, a.Target)); e == nil {
				if !filepath.IsAbs(raw) {
					raw = filepath.Join(l.GameRoot, filepath.Dir(a.Target), raw)
				}
				resolved, e := filepath.EvalSymlinks(raw)
				base, be := filepath.EvalSymlinks(l.LibraryRoot)
				owned = owned || (e == nil && be == nil && within(base, resolved))
			}
			if !owned {
				owned, err = replaceableCreatedDirectory(l, a.Target, state, remove)
				if err != nil {
					return nil, ioError(err)
				}
			}
			if !owned {
				return nil, collision(a.Target)
			}
		} else if !os.IsNotExist(err) {
			return nil, ioError(err)
		}
	}
	for _, d := range plan.Directories {
		if !contained(l.GameRoot, d, true) {
			return nil, collision(d)
		}
	}
	return remove, nil
}

// A copy deployment records directories it created. When a later policy uses
// directory links, replace such a directory only if every entry in its tree
// is also tracked and scheduled for removal. This preserves untracked files.
func replaceableCreatedDirectory(l Layout, target string, state DeploymentState, remove []DeploymentArtifact) (bool, error) {
	createdDirs := make(map[string]bool, len(state.CreatedDirs))
	for _, dir := range state.CreatedDirs {
		createdDirs[pathKey(dir)] = true
	}
	if !createdDirs[pathKey(target)] {
		return false, nil
	}
	removedArtifacts := make(map[string]bool, len(remove))
	for _, artifact := range remove {
		removedArtifacts[pathKey(artifact.Target)] = true
	}

	var inspect func(string) (bool, error)
	inspect = func(dir string) (bool, error) {
		entries, err := os.ReadDir(dir)
		if err != nil {
			return false, err
		}
		for _, entry := range entries {
			child := filepath.Join(dir, entry.Name())
			rel, err := filepath.Rel(l.GameRoot, child)
			if err != nil {
				return false, err
			}
			key := pathKey(rel)
			info, err := os.Lstat(child)
			if err != nil {
				return false, err
			}
			if info.IsDir() && info.Mode()&os.ModeSymlink == 0 {
				if !createdDirs[key] {
					return false, nil
				}
				ok, err := inspect(child)
				if err != nil || !ok {
					return ok, err
				}
				continue
			}
			if !removedArtifacts[key] {
				return false, nil
			}
		}
		return true, nil
	}

	return inspect(filepath.Join(l.GameRoot, target))
}

func Preflight(l Layout, plan DeploymentPlan) error {
	state, e := LoadState(l)
	if e != nil {
		return e
	}
	if _, e = preflightState(l, plan, state); e != nil {
		return e
	}
	_, e = planPurge(l)
	return e
}
func Deploy(l Layout, plan DeploymentPlan) error {
	return deploy(l, plan, nil)
}
func deploy(l Layout, plan DeploymentPlan, beforePersist func() error) error {
	state, e := LoadState(l)
	if e != nil {
		return e
	}
	remove, e := preflightState(l, plan, state)
	if e != nil {
		return e
	}
	// Validate compatibility roots and all walks before any recorded unlink.
	if _, e = planPurge(l); e != nil {
		return e
	}
	for _, a := range remove {
		if !contained(l.GameRoot, a.Target, false) {
			return collision(a.Target)
		}
		ok, e := recorded(l, a)
		if e != nil {
			return ioError(e)
		}
		if !ok {
			return collision(a.Target)
		}
		if e = os.Remove(filepath.Join(l.GameRoot, a.Target)); e != nil {
			return ioError(e)
		}
	}
	desired := map[string]bool{}
	for _, d := range plan.Directories {
		desired[d] = true
	}
	created := map[string]bool{}
	sort.Slice(state.CreatedDirs, func(i, j int) bool { return len(state.CreatedDirs[i]) > len(state.CreatedDirs[j]) })
	for _, d := range state.CreatedDirs {
		if desired[d] {
			created[d] = true
			continue
		}
		if IsProtected(d, l.Rules) {
			continue
		}
		p := filepath.Join(l.GameRoot, d)
		entries, e := os.ReadDir(p)
		if os.IsNotExist(e) {
			continue
		}
		if e != nil {
			return ioError(e)
		}
		if len(entries) == 0 {
			if e = os.Remove(p); e != nil {
				return ioError(e)
			}
		}
	}
	for _, d := range plan.Directories {
		if !contained(l.GameRoot, d, true) {
			return collision(d)
		}
		p := filepath.Join(l.GameRoot, d)
		_, e := os.Lstat(p)
		if os.IsNotExist(e) {
			if e = os.Mkdir(p, 0755); e != nil {
				return ioError(e)
			}
			if !IsProtected(d, l.Rules) {
				created[d] = true
			}
		} else if e != nil {
			return ioError(e)
		}
	}
	for _, a := range plan.Artifacts {
		target := filepath.Join(l.GameRoot, a.Target)
		if !contained(l.GameRoot, a.Target, false) {
			return collision(a.Target)
		}
		_, e := os.Lstat(target)
		if e == nil {
			keep := false
			for _, old := range state.Artifacts {
				if equal(old, a) {
					ok, err := current(l, old)
					if err != nil {
						return ioError(err)
					}
					keep = ok
				}
			}
			if keep {
				continue
			}
			return collision(a.Target)
		}
		if !os.IsNotExist(e) {
			return ioError(e)
		}
		source, ok := sourcePath(l, a.Source, true)
		if !ok {
			return collision(a.Source)
		}
		if e = linker.Create(source, target, a.Kind); e != nil {
			return ioError(e)
		}
	}
	if beforePersist != nil {
		if e := beforePersist(); e != nil {
			return e
		}
	}
	return SaveState(l, DeploymentState{Artifacts: plan.Artifacts, CreatedDirs: sortedKeys(created), Method: plan.Method, TargetRuntime: plan.TargetRuntime})
}
func DeployStale(l Layout, mods []models.Mod) (bool, error) {
	state, e := LoadState(l)
	if e != nil {
		return false, e
	}
	for _, a := range state.Artifacts {
		ok, e := current(l, a)
		if e != nil {
			return false, ioError(e)
		}
		if !ok {
			return true, nil
		}
	}
	plan, e := Plan(mods, l)
	if e != nil {
		return true, e
	}
	if len(plan.Artifacts) != len(state.Artifacts) {
		return true, nil
	}
	for i, a := range plan.Artifacts {
		if !equal(a, state.Artifacts[i]) {
			return true, nil
		}
	}
	return false, nil
}
func Sync(ctx context.Context, l Layout, mods []models.Mod, progress Reporter) (Report, error) {
	return SyncWithMethod(ctx, l, mods, models.DeploymentMethodCopyFirst, progress)
}

func SyncWithMethod(ctx context.Context, l Layout, mods []models.Mod, method models.DeploymentMethod, progress Reporter) (Report, error) {
	target := models.TargetWindows
	if method != models.DeploymentMethodCopyFirst {
		target = models.TargetLinux
	}
	return SyncWithPolicy(ctx, l, mods, models.DeploymentPolicy{TargetRuntime: target, DeploymentMethod: method}, progress)
}

func SyncWithPolicy(ctx context.Context, l Layout, mods []models.Mod, policy models.DeploymentPolicy, progress Reporter) (Report, error) {
	return syncWithPolicy(ctx, l, mods, policy, progress, probeSymlinkConsumer)
}

func syncWithPolicy(ctx context.Context, l Layout, mods []models.Mod, policy models.DeploymentPolicy, progress Reporter, probeLink func(Layout) error) (Report, error) {
	stage := func(s models.TaskProgressStage) error {
		if e := ctx.Err(); e != nil {
			return e
		}
		if progress != nil {
			progress.Progress(s, nil)
		}
		return nil
	}
	if e := stage(models.TaskStageSyncPlan); e != nil {
		return Report{}, e
	}
	if !policy.Valid() {
		return Report{}, models.Fail(models.ParseError, "invalid deployment policy")
	}
	planFor := func(candidate []models.Mod) (DeploymentPlan, error) {
		if policy.DeploymentMethod == models.DeploymentMethodCopyFirst {
			plan, err := Plan(candidate, l)
			plan.TargetRuntime = policy.TargetRuntime
			return plan, err
		}
		plan, err := planWithMethod(candidate, l, policy.DeploymentMethod, probeLink)
		plan.TargetRuntime = policy.TargetRuntime
		return plan, err
	}
	enabled := make([]models.Mod, 0, len(mods))
	for _, mod := range mods {
		if mod.Enabled {
			enabled = append(enabled, mod)
		}
	}
	claims, _, _, e := discoverClaims(enabled, l)
	if e != nil {
		return Report{}, e
	}
	conflicted, unattributed := claimConflicts(claims)
	if unattributed != "" {
		return Report{}, collision(unattributed)
	}
	failuresByID := map[string]ModFailure{}
	for id, target := range conflicted {
		failuresByID[id] = ModFailure{ModID: id, Error: codedCollision(target)}
	}
	var deployable []models.Mod
	for _, mod := range enabled {
		if _, excluded := conflicted[mod.ID]; excluded {
			continue
		}
		modPlan, planErr := planFor([]models.Mod{mod})
		if planErr == nil {
			planErr = Preflight(l, modPlan)
		}
		if planErr != nil {
			var coded *models.Error
			if errors.As(planErr, &coded) && coded.Code == models.FileCollision {
				copyOfError := *coded
				failuresByID[mod.ID] = ModFailure{ModID: mod.ID, Error: &copyOfError}
				continue
			}
			return Report{}, planErr
		}
		deployable = append(deployable, mod)
	}
	failures := make([]ModFailure, 0, len(failuresByID))
	for _, id := range sortedKeys(failuresByID) {
		failures = append(failures, failuresByID[id])
	}
	if len(deployable) == 0 && len(failures) > 0 {
		return Report{}, failures[0].Error
	}
	if len(failures) > 0 {
		if e := guardExcludedArtifacts(l, failures); e != nil {
			return Report{}, e
		}
	}
	plan, e := planFor(deployable)
	if e != nil {
		return Report{}, e
	}
	if e = stage(models.TaskStageSyncPreflight); e != nil {
		return Report{}, e
	}
	if e = Preflight(l, plan); e != nil {
		return Report{}, e
	}
	if e = stage(models.TaskStageSyncCleanup); e != nil {
		return Report{}, e
	}
	if e = Purge(l, deployable); e != nil {
		return Report{}, e
	}
	if e = stage(models.TaskStageSyncDeploy); e != nil {
		return Report{}, e
	}
	if e = deploy(l, plan, func() error { return stage(models.TaskStageSyncPersist) }); e != nil {
		return Report{}, e
	}
	return Report{Failures: failures, Deployed: len(plan.Artifacts)}, nil
}

func codedCollision(path string) *models.Error {
	var coded *models.Error
	_ = errors.As(collision(path), &coded)
	return coded
}

func guardExcludedArtifacts(l Layout, failures []ModFailure) error {
	excluded := make(map[string]bool, len(failures))
	for _, failure := range failures {
		excluded[failure.ModID] = true
	}
	belongsToExcluded := func(rel string) bool {
		parts := strings.Split(filepath.ToSlash(rel), "/")
		return len(parts) > 1 && parts[0] == "mods" && excluded[parts[1]]
	}
	state, err := LoadState(l)
	if err != nil {
		return err
	}
	for _, artifact := range state.Artifacts {
		if belongsToExcluded(artifact.Source) {
			return collision(artifact.Target)
		}
	}
	links, err := planPurge(l)
	if err != nil {
		return err
	}
	base, err := filepath.EvalSymlinks(l.LibraryRoot)
	if err != nil {
		return ioError(err)
	}
	for _, link := range links {
		target := link.raw
		if !filepath.IsAbs(target) {
			target = filepath.Join(filepath.Dir(link.path), target)
		}
		resolved, err := filepath.EvalSymlinks(target)
		if err != nil || !within(base, resolved) {
			continue
		}
		rel, err := filepath.Rel(base, resolved)
		if err == nil && belongsToExcluded(rel) {
			return collision(link.path)
		}
	}
	return nil
}
