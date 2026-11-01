use serde::{Deserialize, Serialize};
use specta::Type;

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
}
