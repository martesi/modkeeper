package deployment

import (
	"github.com/martes/modkeeper/backend/linker"
	"github.com/martes/modkeeper/backend/models"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf8"
)

func targetPath(l Layout, p string) string {
	parts := strings.Split(filepath.ToSlash(p), "/")
	if parts[0] == "SPT" {
		return filepath.Join(filepath.Dir(l.Rules.ServerExe), filepath.FromSlash(strings.Join(parts[1:], "/")))
	}
	return p
}
func ancestors(p string) []string {
	var out []string
	for p != "." && p != "" {
		out = append(out, p)
		p = filepath.Dir(p)
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

// Plan prefers copies, matching Rust's volume capability probe.
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
	owners := map[string]map[string]bool{}
	files := map[string][]string{}
	add := func(p, id string) {
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
	for _, m := range mods {
		if !m.Enabled {
			continue
		}
		if !safeRelative(m.ID) || filepath.Base(m.ID) != m.ID || ids[m.ID] {
			return DeploymentPlan{}, collision(m.ID)
		}
		ids[m.ID] = true
		root := filepath.Join(l.Paths().Mods, m.ID)
		e = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if !utf8.ValidString(path) {
				return &Error{"Unexpected", nil}
			}
			if d.IsDir() {
				return nil
			}
			rel, err := filepath.Rel(root, path)
			if err != nil {
				return err
			}
			if strings.EqualFold(strings.Split(filepath.ToSlash(rel), "/")[0], "SPT_Runtime") && filepath.Dir(l.Rules.ServerExe) != "SPT" {
				return collision(rel)
			}
			if len(owners[rel]) > 0 {
				for owner := range owners[rel] {
					if owner != m.ID && owner != "__SYSTEM__" {
						return collision(rel)
					}
				}
			}
			files[m.ID] = append(files[m.ID], rel)
			for _, p := range ancestors(rel) {
				add(p, m.ID)
			}
			return nil
		})
		if e != nil {
			return DeploymentPlan{}, ioError(e)
		}
	}
	selected := map[string]DeploymentArtifact{}
	dirs := map[string]bool{}
	ownedDir := func(p string) bool {
		for _, d := range state.CreatedDirs {
			if d == p {
				return true
			}
		}
		for _, a := range state.Artifacts {
			if a.Target == p {
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
			parts := strings.Split(file, string(filepath.Separator))
			p := ""
			for _, part := range parts {
				p = filepath.Join(p, part)
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
						t := filepath.Join(target, rel)
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
