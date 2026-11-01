use crate::core::cache::LibraryCache;
use crate::core::cleanup;
use crate::core::library::Library;
use crate::core::library_service;
use crate::models::error::SError;
use crate::models::library::LibraryCreationRequirement;
use crate::models::paths::LibPathRules;
use crate::models::workspace::{
    CacheState, CacheStatus, CreateLibraryInput, LibraryEntry, LibraryStub, LibrarySummary,
    LibraryWorkspace, ModSummary,
};
use crate::store::AppConfigStore;
use crate::store::app_config::{AppConfig, AppSettings, KnownLibrary};
use crate::utils::file;
use crate::utils::time::{file_created_at, now_iso8601_utc, to_iso8601_utc};
use crate::utils::toml;
use camino::{Utf8Path, Utf8PathBuf};
use parking_lot::Mutex;
use std::collections::BTreeMap;
use std::sync::Arc;

pub fn get_settings(store: &AppConfigStore) -> AppSettings {
    store.config.settings.clone()
}

/// Replaces the settings wholesale and persists the App Config.
/// Returns the full settings object for the frontend to adopt as-is (T1).
pub fn save_settings(
    store: &mut AppConfigStore,
    settings: AppSettings,
) -> Result<AppSettings, SError> {
    store.config.settings = settings;
    store.save()?;
    Ok(store.config.settings.clone())
}

fn mtime_iso(path: &Utf8Path) -> String {
    path.metadata()
        .and_then(|m| m.modified())
        .map(to_iso8601_utc)
        .unwrap_or_else(|_| now_iso8601_utc())
}

/// Read-only workspace assembly (C13): reads each registered library's own
/// files, never calls Library::load, never validates versions, never migrates.
/// A library whose manifest can't be read is a path-only stub, never dropped.
pub fn assemble_workspace(
    config: &AppConfig,
    active: Option<&Library>,
    config_warning: Option<String>,
) -> LibraryWorkspace {
    let mut libraries = Vec::new();
    let mut mods_by_library_id = BTreeMap::new();
    let mut tools_by_library_id = BTreeMap::new();

    for known in &config.known_libraries {
        // The active library's in-memory state is fresher than its files.
        let dto = match active.filter(|lib| lib.id == known.id) {
            Some(lib) => Ok(lib.to_dto()),
            None => Library::read_library_manifest(&known.library_root),
        };

        let Ok(dto) = dto else {
            libraries.push(LibraryEntry::Stub(LibraryStub {
                path: known.library_root.to_string(),
            }));
            continue;
        };

        let lib_paths = LibPathRules::new(&known.library_root);
        let cache_status = match active.filter(|lib| lib.id == known.id) {
            Some(_) => CacheStatus {
                state: CacheState::Ready,
                message: None,
                last_rebuilt_at: Some(mtime_iso(&lib_paths.cache)),
            },
            None => match toml::read::<LibraryCache>(&lib_paths.cache) {
                Ok(_) => CacheStatus {
                    state: CacheState::Ready,
                    message: None,
                    last_rebuilt_at: Some(mtime_iso(&lib_paths.cache)),
                },
                Err(e) => CacheStatus {
                    state: CacheState::Failed,
                    message: Some(e.to_string()),
                    last_rebuilt_at: None,
                },
            },
        };

        let library_updated_at = mtime_iso(&lib_paths.manifest);
        let mods = dto
            .mods
            .values()
            .map(|m| {
                let installed = lib_paths.mods.join(&m.id);
                ModSummary {
                    id: m.id.clone(),
                    library_id: known.id.clone(),
                    name: m.name.clone(),
                    mod_type: m.mod_type.clone(),
                    is_enabled: m.is_active,
                    source_path: None,
                    installed_path: Some(installed.to_string()),
                    installed_at: m
                        .installed_at
                        .clone()
                        .or_else(|| file_created_at(&installed)),
                    updated_at: if installed.exists() {
                        mtime_iso(&installed)
                    } else {
                        library_updated_at.clone()
                    },
                }
            })
            .collect();

        let game_root =
            crate::core::library::resolve_game_root(&known.library_root, &dto.game_root)
                .map(|path| path.to_string())
                .unwrap_or_else(|_| dto.game_root.to_string());

        libraries.push(LibraryEntry::Summary(LibrarySummary {
            id: known.id.clone(),
            name: dto.name,
            game_root,
            library_root: known.library_root.to_string(),
            spt_version: Some(dto.spt_version),
            cache_status,
            deploy_stale: dto.is_dirty,
            updated_at: library_updated_at,
        }));
        mods_by_library_id.insert(known.id.clone(), mods);
        tools_by_library_id.insert(known.id.clone(), Vec::new());
    }

    LibraryWorkspace {
        active_library_id: config.app_state.active_library_id.clone(),
        libraries,
        mods_by_library_id,
        tools_by_library_id,
        settings: config.settings.clone(),
        config_warning,
    }
}

/// Opens the given registered library and makes it active. Open-time errors
/// surface here: UnsupportedSPTVersion hard-fails, unreadable manifest/cache
/// map to InvalidLibrary (C5).
pub fn activate_library(
    config_handle: &Arc<Mutex<AppConfigStore>>,
    instance_handle: &Arc<Mutex<Option<Library>>>,
    library_id: &str,
) -> Result<(), SError> {
    let library_root = {
        let store = config_handle.lock();
        store
            .config
            .find_library(library_id)
            .map(|known| known.library_root.clone())
            .ok_or_else(|| {
                SError::InvalidLibrary(library_id.to_string(), "Library not registered".to_string())
            })?
    };

    let library = Library::load(&library_root)?;

    {
        let mut store = config_handle.lock();
        store.config.app_state.active_library_id = Some(library_id.to_string());
        store.save()?;
    }

    // Swapping drops the previous Library on this (blocking) thread.
    *instance_handle.lock() = Some(library);
    Ok(())
}

/// Creates a new library (or adopts an existing valid one at the target path,
/// keeping its id - C7), registers it, and makes it active.
pub fn create_library(
    config_handle: &Arc<Mutex<AppConfigStore>>,
    instance_handle: &Arc<Mutex<Option<Library>>>,
    input: CreateLibraryInput,
) -> Result<(), SError> {
    let game_root = Utf8PathBuf::from(input.game_root);
    let library_root = input
        .library_root
        .map(Utf8PathBuf::from)
        .unwrap_or_else(|| library_service::derive_library_root(&game_root));

    let library = if library_root.exists() {
        // Existing dir: adopt when valid, error when not - never overwrite.
        library_service::validate_library_structure(&library_root)?;
        Library::load(&library_root)?
    } else {
        let name = input
            .name
            .unwrap_or_else(|| game_root.file_name().unwrap_or("Library").to_string());
        Library::create(LibraryCreationRequirement {
            game_root,
            repo_root: Some(library_root.clone()),
            name,
        })?
    };

    {
        let mut store = config_handle.lock();
        store.config.upsert_library(KnownLibrary {
            id: library.id.clone(),
            library_root,
        });
        store.config.app_state.active_library_id = Some(library.id.clone());
        store.save()?;
    }

    *instance_handle.lock() = Some(library);
    Ok(())
}

/// Deletes only the known_libraries row; files stay on disk so re-adding the
/// same gameRoot re-adopts the library's id (C7). The handle is an id or, for
/// a path-only stub, the registered library_root path (C13).
pub fn delete_library_entry(
    config_handle: &Arc<Mutex<AppConfigStore>>,
    instance_handle: &Arc<Mutex<Option<Library>>>,
    library_handle: &str,
) -> Result<(), SError> {
    let library_id = {
        let mut store = config_handle.lock();
        let Some(known) = store.config.find_library_by_handle(library_handle) else {
            return Err(SError::InvalidLibrary(
                library_handle.to_string(),
                "Library not registered".to_string(),
            ));
        };
        let library_id = known.id.clone();
        store.config.remove_library(&library_id);
        store.save()?;
        library_id
    };

    let mut instance = instance_handle.lock();
    if instance.as_ref().map(|lib| lib.id.as_str()) == Some(library_id.as_str()) {
        *instance = None;
    }
    Ok(())
}

/// Deletes the known_libraries row AND the library directory. Purges deployed
/// links first so the game root is left clean.
pub fn delete_library_files(
    config_handle: &Arc<Mutex<AppConfigStore>>,
    instance_handle: &Arc<Mutex<Option<Library>>>,
    library_id: &str,
) -> Result<(), SError> {
    let library_root = {
        let store = config_handle.lock();
        store
            .config
            .find_library_by_handle(library_id)
            .map(|known| known.library_root.clone())
            .ok_or_else(|| {
                SError::InvalidLibrary(library_id.to_string(), "Library not registered".to_string())
            })?
    };

    // Remove recorded deployment artifacts before the mod sources disappear.
    if let Ok(library) = Library::load(&library_root) {
        cleanup::remove_recorded_deployment(&library)?;
        cleanup::purge(&library)?;
    }

    delete_library_entry(config_handle, instance_handle, library_id)?;

    if library_root.exists() {
        file::remove_dir_all(&library_root)?;
    }
    Ok(())
}

/// Renames a library by writing its manifest.toml name only - the App Config
/// stores no name. Goes through the live instance when it's the active one.
pub fn rename_library(
    config_handle: &Arc<Mutex<AppConfigStore>>,
    instance_handle: &Arc<Mutex<Option<Library>>>,
    library_id: &str,
    name: String,
) -> Result<(), SError> {
    {
        let mut instance = instance_handle.lock();
        if let Some(inst) = instance.as_mut()
            && inst.id == library_id
        {
            inst.name = name;
            return inst.persist();
        }
    }

    let library_root = {
        let store = config_handle.lock();
        store
            .config
            .find_library(library_id)
            .map(|known| known.library_root.clone())
            .ok_or_else(|| {
                SError::InvalidLibrary(library_id.to_string(), "Library not registered".to_string())
            })?
    };

    let mut dto = Library::read_library_manifest(&library_root)?;
    dto.name = name;
    toml::write(&LibPathRules::new(&library_root).manifest, &dto)
}
