package deployment

import (
	"context"
	"errors"
	"fmt"
	"github.com/martes/modkeeper/backend/linker"
	"github.com/martes/modkeeper/backend/models"
	"os"
	"path/filepath"
	"reflect"
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

func ensureAbsentTarget(target, label string) error {
	_, err := os.Lstat(target)
	if err == nil {
		return collision(label)
	}
	if os.IsNotExist(err) {
		if isLink(target) {
			return collision(label)
		}
		return nil
	}
	return ioError(err)
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
			if isLink(filepath.Join(l.GameRoot, a.Target)) {
				return nil, collision(a.Target)
			}
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
	for i := range plan.Artifacts {
		a := plan.Artifacts[i]
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
				if pathKey(old.Target) == pathKey(a.Target) {
					ok, e := recorded(l, old)
					if e != nil {
						return nil, ioError(e)
					}
					owned = owned || ok
				}
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
		} else if os.IsNotExist(err) && isLink(filepath.Join(l.GameRoot, a.Target)) {
			return nil, collision(a.Target)
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
	if err := CheckNoPendingSync(l); err != nil {
		return err
	}
	state, e := LoadState(l)
	if e != nil {
		return e
	}
	return preflight(l, plan, state)
}

func preflight(l Layout, plan DeploymentPlan, state DeploymentState) error {
	if _, err := preflightState(l, plan, state); err != nil {
		return err
	}
	_, err := planPurge(l)
	return err
}
func Deploy(l Layout, plan DeploymentPlan) error {
	release, err := acquireMutationLock(l)
	if err != nil {
		return ioError(fmt.Errorf("lock deployment mutations: %w", err))
	}
	defer release()
	if err := CheckNoPendingSync(l); err != nil {
		return err
	}
	state, err := LoadState(l)
	if err != nil {
		return err
	}
	if _, err := preflightState(l, plan, state); err != nil {
		return err
	}
	purgeLinks, err := planPurge(l)
	if err != nil {
		return err
	}
	intentToken, err := saveSyncIntent(l, plan, state, purgeLinks)
	if err != nil {
		return err
	}
	if err := deployWithBoundary(l, plan, nil, nil, nil, intentToken); err != nil {
		return err
	}
	return clearSyncIntent(l, intentToken)
}

func deployWithBoundary(l Layout, plan DeploymentPlan, beforePersist, afterPublication, afterStateSave func() error, syncToken string) error {
	return deployWithBoundaryAndStateWriter(l, plan, beforePersist, afterPublication, afterStateSave, syncToken, writeDeploymentState, nil)
}

func deployWithBoundaryAndStateWriter(l Layout, plan DeploymentPlan, beforePersist, afterPublication, afterStateSave func() error, syncToken string, stateWriter func(Layout, DeploymentState) error, duringStaging func() error) error {
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
	// Do the last foreign-target check before removing old owned artifacts or
	// pruning their directories. Sync assumes no external mutation while it
	// runs; the later check before link creation remains defense in depth.
	if _, e := preflightState(l, plan, state); e != nil {
		return e
	}
	mutatedDirs := map[string]bool{}
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
		mutatedDirs[filepath.Dir(filepath.Join(l.GameRoot, a.Target))] = true
		forgetLiveArtifact(l, a.Target)
	}
	created := map[string]bool{}
	// Persisted paths are not proof that a directory is still ours. Remove an
	// empty directory only while its process-local object pin still matches.
	desiredDirs := map[string]bool{}
	for _, dir := range plan.Directories {
		desiredDirs[pathKey(dir)] = true
	}
	for _, dir := range state.CreatedDirs {
		if desiredDirs[pathKey(dir)] {
			created[pathKey(dir)] = true
			continue
		}
		removed, err := removePinnedDirectory(l, dir)
		if err != nil {
			return ioError(fmt.Errorf("remove owned deployment directory %q: %w", dir, err))
		}
		if removed {
			mutatedDirs[filepath.Dir(filepath.Join(l.GameRoot, dir))] = true
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
			if e = pinCreatedDirectory(l, d); e != nil {
				return ioError(fmt.Errorf("pin created deployment directory %q: %w", d, e))
			}
			mutatedDirs[filepath.Dir(p)] = true
			if !IsProtected(d, l.Rules) {
				created[d] = true
			}
		} else if e != nil {
			return ioError(e)
		}
	}
	for i := range plan.Artifacts {
		a := plan.Artifacts[i]
		target := filepath.Join(l.GameRoot, a.Target)
		if !contained(l.GameRoot, a.Target, false) {
			return collision(a.Target)
		}
		if e := ensureAbsentTarget(target, a.Target); e != nil {
			keep := false
			for _, old := range state.Artifacts {
				if equal(old, a) {
					ok, err := current(l, old)
					if err != nil {
						return ioError(err)
					}
					keep = ok
					if keep {
						plan.Artifacts[i] = old
					}
				}
			}
			if keep {
				continue
			}
			return e
		}
		source, ok := sourcePath(l, a.Source, true)
		if !ok {
			return collision(a.Source)
		}
		stage := ""
		if a.Kind == linker.Copy {
			stage = filepath.Join(l.GameRoot, stagePathForTarget(l.GameRoot, a.Target, syncToken))
		}
		switch a.Kind {
		case linker.Copy, linker.Hardlink:
			e = linker.CreateWithPublicationBoundary(source, target, a.Kind, stage, captureLiveArtifact(l, a.Target), duringStaging)
		case linker.Symlink, linker.Junction:
			e = linker.Create(source, target, a.Kind)
			if e == nil {
				_, e = captureLivePathArtifact(l, a.Target)(target)
			}
		default:
			e = invalid(l, "artifact kind has no safe publication method")
		}
		if e != nil {
			return ioError(e)
		}
		if a.Kind == linker.Copy {
			fingerprint, fingerprintErr := liveObjectFingerprint(l, a.Target)
			if fingerprintErr != nil {
				return ioError(fingerprintErr)
			}
			if a.Fingerprint != nil && fingerprint != *a.Fingerprint {
				return collision(a.Target)
			}
			a.Fingerprint = &fingerprint
		}
		plan.Artifacts[i] = a
		mutatedDirs[filepath.Dir(target)] = true
		if afterPublication != nil {
			if err := afterPublication(); err != nil {
				return err
			}
		}
	}
	for _, dir := range sortedKeys(mutatedDirs) {
		if _, err := os.Stat(dir); os.IsNotExist(err) {
			dir = filepath.Dir(dir)
		} else if err != nil {
			return ioError(fmt.Errorf("inspect game directory after deployment mutation %q: %w", dir, err))
		}
		if err := syncDirectoryDurably(dir); err != nil {
			return ioError(fmt.Errorf("sync game directory after deployment mutation %q: %w", dir, err))
		}
	}
	if beforePersist != nil {
		if e := beforePersist(); e != nil {
			return e
		}
	}
	newState := DeploymentState{Artifacts: plan.Artifacts, CreatedDirs: sortedKeys(created), Method: plan.Method, TargetRuntime: plan.TargetRuntime}
	newState.SyncToken = syncToken
	stateContent := DeploymentState{Artifacts: state.Artifacts, CreatedDirs: state.CreatedDirs, Method: state.Method, TargetRuntime: state.TargetRuntime}
	newStateContent := DeploymentState{Artifacts: newState.Artifacts, CreatedDirs: newState.CreatedDirs, Method: newState.Method, TargetRuntime: newState.TargetRuntime}
	if reflect.DeepEqual(stateContent, newStateContent) {
		newState.SyncToken = state.SyncToken
		newState.Receipt = state.Receipt
		newState.FileID = state.FileID
	}
	if !reflect.DeepEqual(state, newState) {
		if err := stateWriter(l, newState); err != nil {
			return err
		}
	}
	if afterStateSave != nil {
		return afterStateSave()
	}
	return nil
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
	return syncWithPolicyAndHooks(ctx, l, mods, policy, progress, probeSymlinkConsumer, nil, e2eSyncBoundary(), writeDeploymentState)
}

func syncWithPolicy(ctx context.Context, l Layout, mods []models.Mod, policy models.DeploymentPolicy, progress Reporter, probeLink func(Layout) error) (Report, error) {
	return syncWithPolicyAndHooks(ctx, l, mods, policy, progress, probeLink, nil, nil, writeDeploymentState)
}

func syncWithBoundary(ctx context.Context, l Layout, mods []models.Mod, progress Reporter, beforeTargetCheck func(string) error) (Report, error) {
	return syncWithHooks(ctx, l, mods, progress, beforeTargetCheck, nil)
}

func syncWithHooks(ctx context.Context, l Layout, mods []models.Mod, progress Reporter, beforeTargetCheck func(string) error, boundary func(string) error) (Report, error) {
	return syncWithHooksAndStateWriter(ctx, l, mods, progress, beforeTargetCheck, boundary, writeDeploymentState)
}

func syncWithHooksAndStateWriter(ctx context.Context, l Layout, mods []models.Mod, progress Reporter, beforeTargetCheck func(string) error, boundary func(string) error, stateWriter func(Layout, DeploymentState) error) (Report, error) {
	return syncWithPolicyAndHooks(ctx, l, mods, models.DeploymentPolicy{
		TargetRuntime: models.TargetWindows, DeploymentMethod: models.DeploymentMethodCopyFirst,
	}, progress, probeSymlinkConsumer, beforeTargetCheck, boundary, stateWriter)
}

func syncWithPolicyAndHooks(ctx context.Context, l Layout, mods []models.Mod, policy models.DeploymentPolicy, progress Reporter, probeLink func(Layout) error, beforeTargetCheck func(string) error, boundary func(string) error, stateWriter func(Layout, DeploymentState) error) (Report, error) {
	release, err := acquireMutationLock(l)
	if err != nil {
		return Report{}, ioError(fmt.Errorf("lock sync mutations: %w", err))
	}
	defer release()
	stage := func(s models.TaskProgressStage) error {
		if e := ctx.Err(); e != nil {
			return e
		}
		if progress != nil {
			progress.Progress(s, nil)
		}
		return nil
	}
	if e := recoverSyncIntent(l); e != nil {
		return Report{}, e
	}
	if e := stage(models.TaskStageSyncPlan); e != nil {
		return Report{}, e
	}
	if !policy.Valid() {
		return Report{}, models.Fail(models.ParseError, "invalid deployment policy")
	}
	if e := upgradeLegacyDeployment(l); e != nil {
		return Report{}, e
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
	state, e := LoadState(l)
	if e != nil {
		return Report{}, e
	}
	if e = preflight(l, plan, state); e != nil {
		return Report{}, e
	}
	if len(plan.Artifacts) == 0 && len(plan.Directories) == 0 && len(state.Artifacts) == 0 && len(state.CreatedDirs) == 0 && hasCompletedUnpinnedSyncJournal(l) {
		if e := stage(models.TaskStageSyncCleanup); e != nil {
			return Report{}, e
		}
		purgeLinks, purgeErr := planPurge(l)
		if purgeErr != nil {
			return Report{}, purgeErr
		}
		if len(purgeLinks) == 0 {
			// No target or state mutation is needed. Leave restart-unproven
			// deployment and Sync records untouched.
			if e := stage(models.TaskStageSyncPersist); e != nil {
				return Report{}, e
			}
			return Report{Failures: []ModFailure{}, Deployed: 0}, nil
		}
	}
	if len(plan.Artifacts) == 0 && len(plan.Directories) == 0 && len(state.Artifacts) == 0 && len(state.CreatedDirs) == 0 {
		if _, stateErr := os.Lstat(l.Paths().Deployment); os.IsNotExist(stateErr) {
			purgeLinks, purgeErr := planPurge(l)
			if purgeErr != nil {
				return Report{}, purgeErr
			}
			if len(purgeLinks) == 0 {
				if e := stage(models.TaskStageSyncCleanup); e != nil {
					return Report{}, e
				}
				// Record that the empty transaction completed without creating an
				// ownership file. A later process can safely begin a distinct Sync.
				token, intentErr := saveSyncIntent(l, plan, state, purgeLinks)
				if intentErr != nil {
					return Report{}, intentErr
				}
				if err := clearSyncIntent(l, token); err != nil {
					return Report{}, err
				}
				if e := stage(models.TaskStageSyncPersist); e != nil {
					return Report{}, e
				}
				return Report{Failures: []ModFailure{}, Deployed: 0}, nil
			}
		} else if !os.IsNotExist(stateErr) && stateErr != nil {
			return Report{}, ioError(fmt.Errorf("inspect deployment state after empty Sync plan: %w", stateErr))
		}
	}
	if beforeTargetCheck != nil && len(plan.Artifacts) > 0 {
		if e = beforeTargetCheck(filepath.Join(l.GameRoot, plan.Artifacts[0].Target)); e != nil {
			return Report{}, e
		}
	}
	// Recheck targets after preflight and before the recorded purge/deploy
	// operations can remove any existing artifacts or directories.
	if _, e = preflightState(l, plan, state); e != nil {
		return Report{}, e
	}
	purgeLinks, e := planPurge(l)
	if e != nil {
		return Report{}, e
	}
	intentToken, intentErr := saveSyncIntent(l, plan, state, purgeLinks)
	if intentErr != nil {
		return Report{}, intentErr
	}
	if boundary != nil {
		if e = boundary("intent-persisted"); e != nil {
			return Report{}, e
		}
	}
	if e = stage(models.TaskStageSyncCleanup); e != nil {
		return Report{}, e
	}
	if e = purge(l, nil); e != nil {
		return Report{}, e
	}
	if e = stage(models.TaskStageSyncDeploy); e != nil {
		return Report{}, e
	}
	if boundary != nil {
		if e = boundary("pre-publication"); e != nil {
			return Report{}, e
		}
	}
	if e = deployWithBoundaryAndStateWriter(l, plan, func() error {
		if boundary != nil {
			if err := boundary("pre-state-save"); err != nil {
				return err
			}
		}
		return stage(models.TaskStageSyncPersist)
	}, func() error {
		if boundary != nil {
			return boundary("post-publication")
		}
		return nil
	}, func() error {
		if boundary != nil {
			return boundary("state-saved")
		}
		return nil
	}, intentToken, stateWriter, func() error {
		if boundary != nil {
			return boundary("during-staging")
		}
		return nil
	}); e != nil {
		return Report{}, e
	}
	if e = clearSyncIntent(l, intentToken); e != nil {
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
