package models

// Forge response records define the wire shape used by the Wails bindings.
// Optional fields stay pointers without omitempty so the frontend contract
// receives each key with either a value or explicit null. Numeric widths keep
// identifiers within uint32 and content lengths within uint64.

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
