package deployment

import "github.com/BurntSushi/toml"

// Cache preserves the LibraryCache/ModFS TOML representation. Cache rebuild
// and manifest persistence belong to the library service, not deployment.
type Cache struct {
	Mods map[string]CachedMod `toml:"mods"`
}
type CachedMod struct {
	ID          string   `toml:"id"`
	ModType     string   `toml:"modType"`
	Files       []string `toml:"files"`
	Executables []string `toml:"executables"`
}

func LoadCache(l Layout) (Cache, error) {
	var c Cache
	_, e := toml.DecodeFile(l.Paths().Cache, &c)
	if e != nil {
		return c, invalid(l, "cache.toml: "+e.Error())
	}
	return c, nil
}
func SaveCache(l Layout, c Cache) error { return writeTOML(l.Paths().Cache, c) }
