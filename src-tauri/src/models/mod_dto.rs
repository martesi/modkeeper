use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Serialize, Deserialize, Type, Clone, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum ModSource {
    #[default]
    Local,
    Forge,
}

#[derive(Serialize, Deserialize, Type, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ForgeKind {
    Mod,
    Addon,
}

#[derive(Clone, Debug)]
pub struct ForgeInstallMetadata {
    pub kind: ForgeKind,
    pub forge_id: u64,
    pub forge_guid: String,
    pub version: String,
    pub version_id: u64,
    pub cached_at: String,
}

// Lowercase on the wire per the TS contract; aliases keep manifest.toml /
// cache.toml files written before the rename readable.
#[derive(Serialize, Deserialize, Type, Clone, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ModType {
    #[serde(alias = "Client")]
    Client,
    #[serde(alias = "Server")]
    Server,
    #[serde(alias = "Both")]
    Both,
    #[serde(alias = "Unknown")]
    Unknown,
}

#[derive(Serialize, Deserialize, Type, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Mod {
    pub id: String,
    pub is_active: bool,
    #[serde(rename = "type")]
    pub mod_type: ModType,
    pub name: String,
    /// First installation into this library; absent in older manifests.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub installed_at: Option<String>,
    /// Registry metadata is optional so older manifest.toml files remain valid.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(type = Option<u32>)]
    pub forge_id: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub forge_guid: Option<String>,
    #[serde(default)]
    pub source: ModSource,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub forge_kind: Option<ForgeKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(type = Option<u32>)]
    pub forge_version_id: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub forge_meta_cached_at: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::{Mod, ModSource};

    #[test]
    fn old_manifest_mods_default_to_local_without_registry_identity() {
        let old_manifest = r#"
id = "old-install"
isActive = true
type = "server"
name = "Existing Mod"
installedAt = "2026-01-02T03:04:05Z"
"#;
        let mod_entry: Mod = toml::from_str(old_manifest).unwrap();
        assert_eq!(mod_entry.source, ModSource::Local);
        assert_eq!(mod_entry.version, None);
        assert_eq!(mod_entry.forge_id, None);
        assert_eq!(mod_entry.forge_guid, None);
        assert_eq!(mod_entry.forge_version_id, None);
        assert_eq!(mod_entry.forge_meta_cached_at, None);
    }
}
