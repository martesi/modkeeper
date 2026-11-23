package models

import (
	"encoding/json"
	"testing"
)

func forgePtr[T any](value T) *T { return &value }

// requireForgeWire pins the exact JSON shape: key names, key order,
// explicit nulls for Option fields, and the stale flag inside each page.
func requireForgeWire[T any](t *testing.T, value T, wire string) {
	t.Helper()
	assertJSON(t, value, wire)
	var decoded T
	if err := json.Unmarshal([]byte(wire), &decoded); err != nil {
		t.Fatal(err)
	}
	assertJSON(t, decoded, wire)
}

func TestForgeSearchResponseWireShape(t *testing.T) {
	response := ForgeSearchResponse{
		SPTVersion: "4.0.11",
		Mods: ForgeSearchPage{
			Items: []ForgeSearchItem{{
				Kind:                 ForgeKindMod,
				ID:                   7,
				GUID:                 "mod-guid",
				Name:                 "Mod",
				Slug:                 forgePtr("mod"),
				Teaser:               forgePtr("teaser"),
				Thumbnail:            forgePtr("thumb.png"),
				DetailURL:            forgePtr("https://example.test/mod/7"),
				FikaCompatibility:    forgePtr(true),
				ParentModID:          forgePtr(uint32(3)),
				ParentModGUID:        forgePtr("parent-guid"),
				ParentModName:        forgePtr("Parent"),
				ParentModDetailURL:   forgePtr("https://example.test/mod/3"),
				ModVersionConstraint: forgePtr("^1.0.0"),
				IsDetached:           forgePtr(false),
			}},
			Pagination: ForgePageInfo{
				CurrentPage: forgePtr(uint32(1)),
				LastPage:    forgePtr(uint32(2)),
				PerPage:     forgePtr(uint32(10)),
				Total:       forgePtr(uint32(11)),
			},
		},
		Addons: ForgeSearchPage{
			Items: []ForgeSearchItem{{
				Kind: ForgeKindAddon,
				ID:   9,
				GUID: "addon-guid",
				Name: "Addon",
			}},
			Stale: true,
		},
	}
	const modItem = `{"kind":"mod","id":7,"guid":"mod-guid","name":"Mod","slug":"mod","teaser":"teaser","thumbnail":"thumb.png","detailUrl":"https://example.test/mod/7","fikaCompatibility":true,"parentModId":3,"parentModGuid":"parent-guid","parentModName":"Parent","parentModDetailUrl":"https://example.test/mod/3","modVersionConstraint":"^1.0.0","isDetached":false}`
	const addonItem = `{"kind":"addon","id":9,"guid":"addon-guid","name":"Addon","slug":null,"teaser":null,"thumbnail":null,"detailUrl":null,"fikaCompatibility":null,"parentModId":null,"parentModGuid":null,"parentModName":null,"parentModDetailUrl":null,"modVersionConstraint":null,"isDetached":null}`
	const wire = `{"sptVersion":"4.0.11","mods":{"items":[` + modItem + `],"pagination":{"currentPage":1,"lastPage":2,"perPage":10,"total":11},"stale":false},"addons":{"items":[` + addonItem + `],"pagination":{"currentPage":null,"lastPage":null,"perPage":null,"total":null},"stale":true}}`
	requireForgeWire(t, response, wire)
}

func TestForgeDetailWireShape(t *testing.T) {
	detail := ForgeDetail{
		Kind:                 ForgeKindAddon,
		ID:                   9,
		GUID:                 "addon-guid",
		Name:                 "Addon",
		Description:          forgePtr("Description"),
		FikaCompatibility:    forgePtr(false),
		ParentModID:          forgePtr(uint32(7)),
		Parent:               &ForgeAddonParent{ID: 7, GUID: "mod-guid", Name: "Mod"},
		ModVersionConstraint: forgePtr("^2.0.0"),
		IsDetached:           forgePtr(true),
	}
	const wire = `{"kind":"addon","id":9,"guid":"addon-guid","name":"Addon","slug":null,"teaser":null,"description":"Description","thumbnail":null,"detailUrl":null,"fikaCompatibility":false,"parentModId":7,"parent":{"id":7,"guid":"mod-guid","name":"Mod","detailUrl":null},"modVersionConstraint":"^2.0.0","isDetached":true,"stale":false}`
	requireForgeWire(t, detail, wire)
}

func TestForgeVersionsPageWireShape(t *testing.T) {
	page := ForgeVersionsPage{
		Kind:   ForgeKindMod,
		ItemID: 7,
		Versions: []ForgeVersion{{
			Kind:          ForgeKindMod,
			ItemID:        7,
			ID:            70,
			Version:       "2.0.0",
			Link:          "https://example.test/a.zip",
			ContentLength: 1024,
			Dependencies: []ForgeDependency{
				{
					ModID:             forgePtr(uint32(5)),
					ModGUID:           forgePtr("dep-guid"),
					ModName:           forgePtr("Dependency"),
					VersionConstraint: forgePtr("^1.0.0"),
					IsOptional:        forgePtr(true),
				},
				{},
			},
		}},
		Pagination: ForgePageInfo{CurrentPage: forgePtr(uint32(2))},
	}
	const dependency = `{"modId":5,"modGuid":"dep-guid","modName":"Dependency","versionConstraint":"^1.0.0","isOptional":true}`
	const optionalDependency = `{"modId":null,"modGuid":null,"modName":null,"versionConstraint":null,"isOptional":null}`
	const version = `{"kind":"mod","itemId":7,"id":70,"version":"2.0.0","description":null,"link":"https://example.test/a.zip","contentLength":1024,"sptVersionConstraint":null,"fikaCompatibility":null,"dependencies":[` + dependency + `,` + optionalDependency + `]}`
	const wire = `{"kind":"mod","itemId":7,"versions":[` + version + `],"pagination":{"currentPage":2,"lastPage":null,"perPage":null,"total":null},"stale":false}`
	requireForgeWire(t, page, wire)
}

// Empty slices must stay arrays, not null, so the
// service-built arrays must round-trip without turning into JSON null.
func TestForgeResponseCollectionsStayArrays(t *testing.T) {
	search := ForgeSearchResponse{
		Mods:   ForgeSearchPage{Items: []ForgeSearchItem{}},
		Addons: ForgeSearchPage{Items: []ForgeSearchItem{}},
	}
	const searchWire = `{"sptVersion":"","mods":{"items":[],"pagination":{"currentPage":null,"lastPage":null,"perPage":null,"total":null},"stale":false},"addons":{"items":[],"pagination":{"currentPage":null,"lastPage":null,"perPage":null,"total":null},"stale":false}}`
	requireForgeWire(t, search, searchWire)

	versions := ForgeVersionsPage{Kind: ForgeKindAddon, ItemID: 9, Versions: []ForgeVersion{}}
	const versionsWire = `{"kind":"addon","itemId":9,"versions":[],"pagination":{"currentPage":null,"lastPage":null,"perPage":null,"total":null},"stale":false}`
	requireForgeWire(t, versions, versionsWire)
}
