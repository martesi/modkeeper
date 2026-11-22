package models

// Forge response records mirror src-tauri/src/models/forge.rs so the Wails
// bindings, not the Tauri Specta file, can type Forge reads. Optional fields
// stay pointers without omitempty: Rust's Option serializes as an explicit
// null, and the frontend contract requires the key to be present.
//
// Numeric widths follow the Rust specta overrides: id fields are u32 so Wails
// emits `number`, and content length stays uint64 because the Rust value is a
// u64 exposed to TypeScript as f64.

type ForgePageInfo struct {
	CurrentPage *uint32 `json:"currentPage"`
	LastPage    *uint32 `json:"lastPage"`
	PerPage     *uint32 `json:"perPage"`
	Total       *uint32 `json:"total"`
}

type ForgeSearchItem struct {
	Kind                 ForgeKind `json:"kind"`
	ID                   uint32    `json:"id"`
	GUID                 string    `json:"guid"`
	Name                 string    `json:"name"`
	Slug                 *string   `json:"slug"`
	Teaser               *string   `json:"teaser"`
	Thumbnail            *string   `json:"thumbnail"`
	DetailURL            *string   `json:"detailUrl"`
	FikaCompatibility    *bool     `json:"fikaCompatibility"`
	ParentModID          *uint32   `json:"parentModId"`
	ParentModGUID        *string   `json:"parentModGuid"`
	ParentModName        *string   `json:"parentModName"`
	ParentModDetailURL   *string   `json:"parentModDetailUrl"`
	ModVersionConstraint *string   `json:"modVersionConstraint"`
	IsDetached           *bool     `json:"isDetached"`
}

type ForgeSearchPage struct {
	Items      []ForgeSearchItem `json:"items"`
	Pagination ForgePageInfo     `json:"pagination"`
	Stale      bool              `json:"stale"`
}

type ForgeSearchResponse struct {
	SPTVersion string          `json:"sptVersion"`
	Mods       ForgeSearchPage `json:"mods"`
	Addons     ForgeSearchPage `json:"addons"`
}

type ForgeAddonParent struct {
	ID        uint32  `json:"id"`
	GUID      string  `json:"guid"`
	Name      string  `json:"name"`
	DetailURL *string `json:"detailUrl"`
}

type ForgeDetail struct {
	Kind                 ForgeKind         `json:"kind"`
	ID                   uint32            `json:"id"`
	GUID                 string            `json:"guid"`
	Name                 string            `json:"name"`
	Slug                 *string           `json:"slug"`
	Teaser               *string           `json:"teaser"`
	Description          *string           `json:"description"`
	Thumbnail            *string           `json:"thumbnail"`
	DetailURL            *string           `json:"detailUrl"`
	FikaCompatibility    *bool             `json:"fikaCompatibility"`
	ParentModID          *uint32           `json:"parentModId"`
	Parent               *ForgeAddonParent `json:"parent"`
	ModVersionConstraint *string           `json:"modVersionConstraint"`
	IsDetached           *bool             `json:"isDetached"`
	Stale                bool              `json:"stale"`
}

type ForgeDependency struct {
	ModID             *uint32 `json:"modId"`
	ModGUID           *string `json:"modGuid"`
	ModName           *string `json:"modName"`
	VersionConstraint *string `json:"versionConstraint"`
	IsOptional        *bool   `json:"isOptional"`
}

type ForgeVersion struct {
	Kind                 ForgeKind         `json:"kind"`
	ItemID               uint32            `json:"itemId"`
	ID                   uint32            `json:"id"`
	Version              string            `json:"version"`
	Description          *string           `json:"description"`
	Link                 string            `json:"link"`
	ContentLength        uint64            `json:"contentLength"`
	SPTVersionConstraint *string           `json:"sptVersionConstraint"`
	FikaCompatibility    *string           `json:"fikaCompatibility"`
	Dependencies         []ForgeDependency `json:"dependencies"`
}

type ForgeVersionsPage struct {
	Kind       ForgeKind      `json:"kind"`
	ItemID     uint32         `json:"itemId"`
	Versions   []ForgeVersion `json:"versions"`
	Pagination ForgePageInfo  `json:"pagination"`
	Stale      bool           `json:"stale"`
}
