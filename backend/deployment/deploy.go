package deployment

import (
	"context"
	"github.com/martes/modkeeper/backend/linker"
	"github.com/martes/modkeeper/backend/models"
	"os"
	"path/filepath"
	"sort"
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
	return SaveState(l, DeploymentState{plan.Artifacts, sortedKeys(created)})
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
	plan, e := Plan(mods, l)
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
	if e = Purge(l, mods); e != nil {
		return Report{}, e
	}
	if e = stage(models.TaskStageSyncDeploy); e != nil {
		return Report{}, e
	}
	if e = deploy(l, plan, func() error { return stage(models.TaskStageSyncPersist) }); e != nil {
		return Report{}, e
	}
	return Report{Failures: []ModFailure{}, Deployed: len(plan.Artifacts)}, nil
}
