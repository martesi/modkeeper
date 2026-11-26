package deployment

import (
	"errors"
	"fmt"
	"github.com/martes/modkeeper/backend/linker"
	"github.com/martes/modkeeper/backend/models"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"unicode/utf8"
)

func targetPath(l Layout, p string) string {
	parts := strings.Split(filepath.ToSlash(p), "/")
	if parts[0] == "SPT" {
		return pathKey(filepath.Join(filepath.Dir(l.Rules.ServerExe), filepath.FromSlash(strings.Join(parts[1:], "/"))))
	}
	return pathKey(p)
}
func pathKey(p string) string { return filepath.ToSlash(filepath.Clean(p)) }
func ancestors(p string) []string {
	p = pathKey(p)
	var out []string
	for p != "." && p != "" {
		out = append(out, p)
		parent := pathKey(filepath.Dir(filepath.FromSlash(p)))
		if parent == p {
			break
		}
		p = parent
	}
	return out
}
func sortedKeys[V any](m map[string]V) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

type sourceClaim struct {
	ModID, Relative, Target string
}

// Plan prefers copies when the source and destination support them.
func Plan(mods []models.Mod, l Layout) (DeploymentPlan, error) {
	file, directory, err := probeMethods(l)
	if err != nil {
		return DeploymentPlan{}, ioError(err)
	}
	plan, err := PlanWithKinds(mods, l, file, directory)
	plan.Method = models.DeploymentMethodCopyFirst
	return plan, err
}

func PlanWithMethod(mods []models.Mod, l Layout, method models.DeploymentMethod) (DeploymentPlan, error) {
	return planWithMethod(mods, l, method, probeSymlinkConsumer)
}

func PlanWithPolicy(mods []models.Mod, l Layout, policy models.DeploymentPolicy) (DeploymentPlan, error) {
	if !policy.Valid() {
		return DeploymentPlan{}, models.Fail(models.ParseError, "invalid deployment policy")
	}
	plan, err := planWithMethod(mods, l, policy.DeploymentMethod, probeSymlinkConsumer)
	plan.TargetRuntime = policy.TargetRuntime
	return plan, err
}

func planWithMethod(mods []models.Mod, l Layout, method models.DeploymentMethod, probeLink func(Layout) error) (DeploymentPlan, error) {
	switch method {
	case models.DeploymentMethodCopy:
		plan, err := PlanWithKinds(mods, l, linker.Copy, linker.Copy)
		plan.Method = method
		return plan, err
	case models.DeploymentMethodLink:
		if err := probeLink(l); err != nil {
			var unsupported unsupportedLinkError
			if errors.As(err, &unsupported) {
				return DeploymentPlan{}, models.Fail(models.ParseError, "symbolic links are not supported by the selected library and game filesystems")
			}
			return DeploymentPlan{}, ioError(err)
		}
		plan, err := PlanWithKinds(mods, l, linker.Symlink, linker.Symlink)
		plan.Method = method
		return plan, err
	case models.DeploymentMethodCopyFirst:
		return Plan(mods, l)
	default:
		return DeploymentPlan{}, invalid(l, fmt.Sprintf("unknown deployment method %q", method))
	}
}

func discoverClaims(mods []models.Mod, l Layout) ([]sourceClaim, map[string]map[string]bool, map[string][]string, error) {
	owners := map[string]map[string]bool{}
	files := map[string][]string{}
	add := func(p, id string) {
		p = pathKey(p)
		if owners[p] == nil {
			owners[p] = map[string]bool{}
		}
		owners[p][id] = true
	}
	for _, root := range []string{"SPT/user/mods", "BepInEx/plugins"} {
		for _, p := range ancestors(root) {
			add(p, "__SYSTEM__")
		}
	}
	ids := map[string]bool{}
	var claims []sourceClaim
	for _, mod := range mods {
		if !mod.Enabled {
			continue
		}
		if !safeRelative(mod.ID) || filepath.Base(mod.ID) != mod.ID || ids[mod.ID] {
			return nil, nil, nil, collision(mod.ID)
		}
		ids[mod.ID] = true
		root := filepath.Join(l.Paths().Mods, mod.ID)
		err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if !utf8.ValidString(path) {
				return models.Fail(models.Unexpected)
			}
			if d.IsDir() {
				return nil
			}
			rel, err := filepath.Rel(root, path)
			if err != nil {
				return err
			}
			if strings.EqualFold(strings.Split(filepath.ToSlash(rel), "/")[0], "SPT_Runtime") && pathKey(filepath.Dir(l.Rules.ServerExe)) != pathKey("SPT") {
				return collision(rel)
			}
			rel = pathKey(rel)
			files[mod.ID] = append(files[mod.ID], rel)
			claims = append(claims, sourceClaim{ModID: mod.ID, Relative: rel, Target: targetPath(l, rel)})
			for _, p := range ancestors(rel) {
				add(p, mod.ID)
			}
			return nil
		})
		if err != nil {
			return nil, nil, nil, ioError(err)
		}
	}
	return claims, owners, files, nil
}

func claimKey(p string) string {
	p = pathKey(p)
	if runtime.GOOS == "windows" {
		return strings.ToLower(p)
	}
	return p
}

func claimConflicts(claims []sourceClaim) (map[string]string, string) {
	byMod := map[string]string{}
	var operationPath string
	check := func(target bool) {
		index := map[string][]sourceClaim{}
		for _, claim := range claims {
			p := claim.Relative
			if target {
				p = claim.Target
			}
			index[claimKey(p)] = append(index[claimKey(p)], claim)
		}
		mark := func(entries []sourceClaim, path string) {
			ids := map[string]bool{}
			for _, entry := range entries {
				ids[entry.ModID] = true
			}
			if len(ids) < 2 {
				if len(entries) > 1 && (operationPath == "" || path < operationPath) {
					operationPath = path
				}
				return
			}
			for id := range ids {
				if byMod[id] == "" || path < byMod[id] {
					byMod[id] = path
				}
			}
		}
		for key, entries := range index {
			if len(entries) > 1 {
				p := entries[0].Relative
				if target {
					p = entries[0].Target
				}
				mark(entries, p)
			}
			for _, parent := range ancestors(filepath.FromSlash(key))[1:] {
				if ancestors := index[claimKey(parent)]; len(ancestors) > 0 {
					p := entries[0].Relative
					if target {
						p = entries[0].Target
					}
					mark(append(append([]sourceClaim{}, entries...), ancestors...), p)
				}
			}
		}
	}
	check(false)
	check(true)
	return byMod, operationPath
}

// Plan prefers copies when the source and destination support them.
func Plan(mods []models.Mod, l Layout) (DeploymentPlan, error) {
	file, directory, err := probeMethods(l)
	if err != nil {
		return DeploymentPlan{}, ioError(err)
	}
	return PlanWithKinds(mods, l, file, directory)
}

// PlanWithKinds supports the link fallback and deterministic capability tests.
func PlanWithKinds(mods []models.Mod, l Layout, fileKind, dirKind linker.ArtifactKind) (DeploymentPlan, error) {
	state, e := LoadState(l)
	if e != nil {
		return DeploymentPlan{}, e
	}
	claims, owners, files, e := discoverClaims(mods, l)
	if e != nil {
		return DeploymentPlan{}, e
	}
	conflicts, operationConflict := claimConflicts(claims)
	if operationConflict != "" {
		return DeploymentPlan{}, collision(operationConflict)
	}
	if len(conflicts) > 0 {
		paths := make([]string, 0, len(conflicts))
		for _, path := range conflicts {
			paths = append(paths, path)
		}
		sort.Strings(paths)
		return DeploymentPlan{}, collision(paths[0])
	}
	selected := map[string]DeploymentArtifact{}
	dirs := map[string]bool{}
	ownedDir := func(p string) bool {
		for _, d := range state.CreatedDirs {
			if pathKey(d) == pathKey(p) {
				return true
			}
		}
		for _, a := range state.Artifacts {
			if pathKey(a.Target) == pathKey(p) {
				ok, _ := recorded(l, a)
				if ok {
					return true
				}
			}
		}
		return false
	}
	legacy := func(p string) bool {
		raw, e := os.Readlink(p)
		if e != nil {
			return false
		}
		if !filepath.IsAbs(raw) {
			raw = filepath.Join(filepath.Dir(p), raw)
		}
		resolved, e := filepath.EvalSymlinks(raw)
		base, be := filepath.EvalSymlinks(l.LibraryRoot)
		return e == nil && be == nil && within(base, resolved)
	}
	for _, id := range sortedKeys(files) {
		for _, file := range files[id] {
			parts := strings.Split(file, "/")
			p := ""
			for _, part := range parts {
				p = pathKey(filepath.Join(p, part))
				if len(owners[p]) != 1 {
					continue
				}
				source := filepath.Join(l.Paths().Mods, id, p)
				meta, err := os.Stat(source)
				if err != nil {
					return DeploymentPlan{}, ioError(err)
				}
				target := targetPath(l, p)
				kind := fileKind
				if meta.IsDir() {
					kind = dirKind
				}
				if kind == linker.Copy && meta.IsDir() {
					dest := filepath.Join(l.GameRoot, target)
					dm, err := os.Lstat(dest)
					if err != nil && !os.IsNotExist(err) {
						return DeploymentPlan{}, ioError(err)
					}
					if err == nil && !ownedDir(target) && !legacy(dest) {
						protected := false
						for _, r := range ProtectedPaths(l.Rules) {
							if within(r, target) {
								protected = true
							}
						}
						if dm.IsDir() && !protected {
							continue
						}
						return DeploymentPlan{}, collision(target)
					}
					err = filepath.WalkDir(source, func(path string, d fs.DirEntry, err error) error {
						if err != nil {
							return err
						}
						rel, err := filepath.Rel(source, path)
						if err != nil {
							return err
						}
						t := pathKey(filepath.Join(target, rel))
						if d.IsDir() {
							dirs[t] = true
							return nil
						}
						if !d.Type().IsRegular() {
							return collision(path)
						}
						s, err := filepath.Rel(l.LibraryRoot, path)
						if err != nil {
							return err
						}
						h, err := fingerprint(path)
						if err != nil {
							return err
						}
						selected[t] = DeploymentArtifact{t, s, kind, &h}
						return nil
					})
					if err != nil {
						return DeploymentPlan{}, ioError(err)
					}
				} else {
					s, err := filepath.Rel(l.LibraryRoot, source)
					if err != nil {
						return DeploymentPlan{}, ioError(err)
					}
					a := DeploymentArtifact{Target: target, Source: s, Kind: kind}
					if meta.Mode().IsRegular() {
						h, err := fingerprint(source)
						if err != nil {
							return DeploymentPlan{}, ioError(err)
						}
						a.Fingerprint = &h
					}
					selected[target] = a
				}
				for _, d := range ancestors(filepath.Dir(target)) {
					dirs[d] = true
				}
				break
			}
		}
	}
	plan := DeploymentPlan{Artifacts: []DeploymentArtifact{}, Directories: sortedKeys(dirs)}
	for _, t := range sortedKeys(selected) {
		a := selected[t]
		if !contained(l.GameRoot, t, false) {
			return plan, collision(t)
		}
		_, err := os.Lstat(filepath.Join(l.GameRoot, t))
		if err == nil {
			owned := legacy(filepath.Join(l.GameRoot, t))
			for _, old := range state.Artifacts {
				if within(old.Target, t) {
					ok, e := recorded(l, old)
					if e != nil {
						return plan, ioError(e)
					}
					owned = owned || ok
				}
			}
			if !owned {
				return plan, collision(t)
			}
		} else if !os.IsNotExist(err) {
			return plan, ioError(err)
		}
		plan.Artifacts = append(plan.Artifacts, a)
	}
	return plan, nil
}
