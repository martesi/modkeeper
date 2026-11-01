use crate::config::global::GlobalConfig;
use crate::models::library::LibraryDTO;
use crate::models::paths::LibPathRules;
use crate::utils::toml;
use camino::Utf8PathBuf;
use serde::{Deserialize, Serialize};
use specta::Type;

/// App-level configuration persisted as a plain TOML file.
/// Holds stable library ids, app state, and backend-owned settings.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct AppConfig {
    pub known_libraries: Vec<KnownLibrary>,
    pub app_state: AppState,
    pub settings: AppSettings,
}

/// A registered library: its stable id (adopted from the library's own
/// manifest.toml, see C7) and where it lives on disk.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct KnownLibrary {
    pub id: String,
    pub library_root: Utf8PathBuf,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct AppState {
    pub active_library_id: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub theme: ThemeMode,
    pub accent_color: String,
    pub language: String,
    pub enable_mods_on_install: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: ThemeMode::System,
            accent_color: "#e91e63".to_string(),
            // Must match a lingui catalog name (package.json `lingui.locales`) — the frontend
            // dynamic-imports `locales/<language>.po` from this value verbatim.
            language: "en-US".to_string(),
            enable_mods_on_install: true,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq, Type)]
#[serde(rename_all = "lowercase")]
pub enum ThemeMode {
    #[default]
    System,
    Light,
    Dark,
}

impl AppConfig {
    pub fn find_library(&self, library_id: &str) -> Option<&KnownLibrary> {
        self.known_libraries.iter().find(|l| l.id == library_id)
    }

    /// Resolves a removal handle to a known library: id first, then the
    /// registered library_root path — a path-only stub's only handle (C13).
    pub fn find_library_by_handle(&self, handle: &str) -> Option<&KnownLibrary> {
        self.find_library(handle).or_else(|| {
            self.known_libraries
                .iter()
                .find(|l| l.library_root.as_str() == handle)
        })
    }

    pub fn remove_library(&mut self, library_id: &str) {
        self.known_libraries.retain(|l| l.id != library_id);
        if self.app_state.active_library_id.as_deref() == Some(library_id) {
            self.app_state.active_library_id = None;
        }
    }

    /// Adds or replaces a known library entry, keyed by id.
    pub fn upsert_library(&mut self, entry: KnownLibrary) {
        self.known_libraries.retain(|l| l.id != entry.id);
        self.known_libraries.push(entry);
    }
}

/// One-time migration from the confy-persisted GlobalConfig.
/// For each known path, adopts the id from that library's own manifest.toml;
/// mints a new uuid only where no readable manifest exists (C7).
/// This is a plain TOML read - no library is opened, no validation runs.
pub fn migrate_from_confy(old: &GlobalConfig) -> AppConfig {
    let mut config = AppConfig::default();

    for path in old.all_libraries() {
        let manifest = LibPathRules::new(path).manifest;
        let id = toml::read::<LibraryDTO>(&manifest)
            .map(|dto| dto.id)
            .unwrap_or_else(|_| uuid::Uuid::new_v4().to_string());

        if old.library_last.as_ref() == Some(path) {
            config.app_state.active_library_id = Some(id.clone());
        }

        config.upsert_library(KnownLibrary {
            id,
            library_root: path.clone(),
        });
    }

    config
}
