use crate::models::mod_dto::ForgeKind;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Serialize, Deserialize, Type, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ForgePageInfo {
    #[specta(type = Option<u32>)]
    pub current_page: Option<u64>,
    #[specta(type = Option<u32>)]
    pub last_page: Option<u64>,
    #[specta(type = Option<u32>)]
    pub per_page: Option<u64>,
    #[specta(type = Option<u32>)]
    pub total: Option<u64>,
}

#[derive(Serialize, Deserialize, Type, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ForgeSearchItem {
    pub kind: ForgeKind,
    #[specta(type = u32)]
    pub id: u64,
    pub guid: String,
    pub name: String,
    pub slug: Option<String>,
    pub teaser: Option<String>,
    pub thumbnail: Option<String>,
    pub detail_url: Option<String>,
    pub fika_compatibility: Option<bool>,
    #[specta(type = Option<u32>)]
    pub parent_mod_id: Option<u64>,
    pub parent_mod_guid: Option<String>,
    pub parent_mod_name: Option<String>,
    pub parent_mod_detail_url: Option<String>,
    pub mod_version_constraint: Option<String>,
    pub is_detached: Option<bool>,
}

#[derive(Serialize, Deserialize, Type, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ForgeSearchPage {
    pub items: Vec<ForgeSearchItem>,
    pub pagination: ForgePageInfo,
    pub stale: bool,
}

#[derive(Serialize, Deserialize, Type, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ForgeSearchResponse {
    pub spt_version: String,
    pub mods: ForgeSearchPage,
    pub addons: ForgeSearchPage,
}

#[derive(Serialize, Deserialize, Type, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ForgeAddonParent {
    #[specta(type = u32)]
    pub id: u64,
    pub guid: String,
    pub name: String,
    pub detail_url: Option<String>,
}

#[derive(Serialize, Deserialize, Type, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ForgeDetail {
    pub kind: ForgeKind,
    #[specta(type = u32)]
    pub id: u64,
    pub guid: String,
    pub name: String,
    pub slug: Option<String>,
    pub teaser: Option<String>,
    pub description: Option<String>,
    pub thumbnail: Option<String>,
    pub detail_url: Option<String>,
    pub fika_compatibility: Option<bool>,
    #[specta(type = Option<u32>)]
    pub parent_mod_id: Option<u64>,
    pub parent: Option<ForgeAddonParent>,
    pub mod_version_constraint: Option<String>,
    pub is_detached: Option<bool>,
    pub stale: bool,
}

#[derive(Serialize, Deserialize, Type, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ForgeDependency {
    #[specta(type = Option<u32>)]
    pub mod_id: Option<u64>,
    pub mod_guid: Option<String>,
    pub mod_name: Option<String>,
    pub version_constraint: Option<String>,
    pub is_optional: Option<bool>,
}

#[derive(Serialize, Deserialize, Type, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ForgeVersion {
    pub kind: ForgeKind,
    #[specta(type = u32)]
    pub item_id: u64,
    #[specta(type = u32)]
    pub id: u64,
    pub version: String,
    pub description: Option<String>,
    pub link: String,
    #[specta(type = f64)]
    pub content_length: u64,
    pub spt_version_constraint: Option<String>,
    pub fika_compatibility: Option<String>,
    pub dependencies: Vec<ForgeDependency>,
}

#[derive(Serialize, Deserialize, Type, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ForgeVersionsPage {
    pub kind: ForgeKind,
    #[specta(type = u32)]
    pub item_id: u64,
    pub versions: Vec<ForgeVersion>,
    pub pagination: ForgePageInfo,
    pub stale: bool,
}

#[derive(Serialize, Deserialize, Type, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ForgeDownloadVersionInput {
    pub task_id: String,
    pub library_id: String,
    pub kind: ForgeKind,
    #[specta(type = u32)]
    pub item_id: u64,
    #[specta(type = u32)]
    pub version_id: u64,
}

#[derive(Serialize, Deserialize, Type, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ForgeMatchInstalledModInput {
    pub library_id: String,
    pub installed_mod_id: String,
    pub kind: ForgeKind,
    #[specta(type = u32)]
    pub item_id: u64,
    #[specta(type = u32)]
    pub version_id: u64,
}

#[derive(Clone, Debug)]
pub struct ForgeAddonInstallConstraint {
    pub is_detached: bool,
    pub parent_forge_id: Option<u64>,
    pub parent_guid: Option<String>,
    pub version_constraint: Option<String>,
}
