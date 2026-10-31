use crate::core::cache::LibraryCache;
use crate::core::deployment::{self, DeploymentState};
use crate::core::mod_stager::StageMaterial;
use crate::core::version;
use crate::models::error::SError;
use crate::models::library::{LibraryCreationRequirement, LibraryDTO};
use crate::models::mod_dto::Mod;
use crate::models::paths::{LibPathRules, SPTPathCanonical, SPTPathRules};
use crate::utils::{file, toml};
use camino::{Utf8Path, Utf8PathBuf};
use std::collections::BTreeMap;
use std::default::Default;
use std::path::PathBuf;

fn is_windows_absolute(path: &Utf8Path) -> bool {
    let bytes = path.as_str().as_bytes();
    bytes.len() >= 3 && bytes[1] == b':' && matches!(bytes[2], b'\\' | b'/')
}

/// Resolves stored game roots relative to the known absolute library root.
/// The fallback keeps libraries written on Windows loadable from Linux when
/// their default `.mod_keeper` root is the same physical directory.
pub(crate) fn resolve_game_root(
    repo_root: &Utf8Path,
    stored_game_root: &Utf8Path,
) -> Result<Utf8PathBuf, SError> {
    let candidate = if stored_game_root.is_relative() && !is_windows_absolute(stored_game_root) {
        repo_root.join(stored_game_root)
    } else {
        stored_game_root.to_owned()
    };

    if candidate.exists() {
        return Utf8PathBuf::from_path_buf(dunce::canonicalize(&candidate)?).map_err(|path| {
            SError::ParseError(format!("Non-UTF-8 game root: {}", path.display()))
        });
    }

    let default_library_root = SPTPathRules::default().library_default;
    if is_windows_absolute(stored_game_root)
        && repo_root.file_name() == Some(default_library_root.as_str())
        && let Some(parent) = repo_root.parent()
        && parent.exists()
    {
        return Utf8PathBuf::from_path_buf(dunce::canonicalize(parent)?).map_err(|path| {
            SError::ParseError(format!("Non-UTF-8 game root: {}", path.display()))
        });
    }

    Ok(candidate)
}

pub struct Library {
    pub id: String,
    pub name: String,
    pub repo_root: Utf8PathBuf,
    pub game_root: Utf8PathBuf,
    pub spt_rules: SPTPathRules,
    pub game_rules: SPTPathRules,
    pub lib_paths: LibPathRules,
    pub spt_paths_canonical: SPTPathCanonical,
    pub cache: LibraryCache,
    pub deployment: DeploymentState,
    pub spt_version: String,
    pub mods: BTreeMap<String, Mod>,
    pub(crate) is_dirty: bool,
}

impl Library {
    pub fn create(requirement: LibraryCreationRequirement) -> Result<Self, SError> {
        // repo_root should always be Some at this point (set by library_service::create_library)
        let repo_root = requirement.repo_root.ok_or_else(|| {
            SError::InvalidLibrary(
                requirement.game_root.to_string(),
                "repo_root must be provided or derived".to_string(),
            )
        })?;

        // Ensure the repo_root directory exists
        file::create_dir_all(&repo_root)?;

        let lib_paths = LibPathRules::new(&repo_root);
        for dir in [&lib_paths.mods, &lib_paths.backups, &lib_paths.staging] {
            file::create_dir_all(dir)?;
        }

        let game_rules = SPTPathRules::for_game_root(&requirement.game_root)?;
        let spt_paths = game_rules.clone().to_absolute(&requirement.game_root);
        let spt_version = version::fetch_and_validate(&spt_paths)?;

        let inst = Self {
            id: uuid::Uuid::new_v4().to_string(),
            name: requirement.name,
            repo_root,
            game_root: requirement.game_root,
            spt_version,
            cache: LibraryCache::default(),
            deployment: DeploymentState::default(),
            mods: Default::default(),
            spt_paths_canonical: SPTPathCanonical::from_spt_paths(spt_paths.clone())?,
            lib_paths,
            spt_rules: SPTPathRules::default(),
            game_rules,
            is_dirty: false,
        };

        inst.persist()?;
        Ok(inst)
    }

    pub fn load(repo_root: &Utf8Path) -> Result<Self, SError> {
        let dto = Self::read_library_manifest(repo_root)?;

        // Validate historical version
        version::validate_string(&dto.spt_version)?;

        let lib_paths = LibPathRules::new(repo_root);
        let game_root = resolve_game_root(repo_root, &dto.game_root)?;
        let game_rules = SPTPathRules::for_game_root(&game_root)?;
        let spt_paths = game_rules.clone().to_absolute(&game_root);
        // Validate current physical version using the game_root from the loaded library
        let spt_version = version::fetch_and_validate(&spt_paths)?;

        // Unreadable/unparseable cache is an open-time InvalidLibrary (C5)
        let cache = toml::read(&lib_paths.cache).map_err(|e| {
            SError::InvalidLibrary(repo_root.to_string(), format!("cache.toml: {e}"))
        })?;
        let mut deployment = if lib_paths.deployment.exists() {
            toml::read(&lib_paths.deployment).map_err(|e| {
                SError::InvalidLibrary(repo_root.to_string(), format!("deployment.toml: {e}"))
            })?
        } else {
            DeploymentState::default()
        };
        deployment::normalize_created_dirs(&game_root, &mut deployment);

        Ok(Self {
            id: dto.id,
            name: dto.name,
            repo_root: repo_root.to_owned(),
            spt_paths_canonical: SPTPathCanonical::from_spt_paths(spt_paths.clone())?,
            game_root,
            spt_rules: SPTPathRules::default(),
            game_rules,
            cache,
            deployment,
            lib_paths,
            spt_version,
            mods: dto.mods,
            is_dirty: false,
        })
    }

    /// Reads the library manifest; both IO and parse failures map to
    /// InvalidLibrary (C5/M8).
    pub fn read_library_manifest(lib_root: &Utf8Path) -> Result<LibraryDTO, SError> {
        toml::read::<LibraryDTO>(&LibPathRules::new(lib_root).manifest).map_err(|e| {
            SError::InvalidLibrary(lib_root.to_string(), format!("manifest.toml: {e}"))
        })
    }

    pub fn to_dto(&self) -> LibraryDTO {
        LibraryDTO {
            id: self.id.to_owned(),
            name: self.name.to_owned(),
            game_root: self.stored_game_root(),
            repo_root: self.repo_root.to_owned(),
            spt_version: self.spt_version.to_owned(),
            mods: self.mods.to_owned(),
            is_dirty: self.is_dirty,
        }
    }

    fn stored_game_root(&self) -> Utf8PathBuf {
        let Ok(repo_relative_to_game) = self.repo_root.strip_prefix(&self.game_root) else {
            return self.game_root.to_owned();
        };

        let depth = repo_relative_to_game.components().count();
        if depth == 0 {
            return Utf8PathBuf::from(".");
        }

        let mut relative = Utf8PathBuf::new();
        for _ in 0..depth {
            relative.push("..");
        }
        relative
    }

    pub fn stage_material(&self, unknown_mod_name: String) -> StageMaterial {
        StageMaterial {
            rules: self.spt_rules.clone(),
            root: self.lib_paths.staging.clone(),
            name: unknown_mod_name,
        }
    }

    /// Stored mods use SPT as their normalized server root.
    pub(crate) fn deployment_target(&self, path: &Utf8Path) -> Utf8PathBuf {
        if let Ok(relative) = path.strip_prefix("SPT") {
            return self
                .game_rules
                .server_exe
                .parent()
                .unwrap_or(Utf8Path::new("SPT"))
                .join(relative);
        }
        path.to_owned()
    }

    pub fn spt_canonical_paths(&self) -> Vec<PathBuf> {
        vec![
            self.spt_paths_canonical.client_exe.clone(),
            self.spt_paths_canonical.server_exe.clone(),
        ]
    }

    /// Marks the library as dirty (modified).
    pub fn mark_dirty(&mut self) {
        self.is_dirty = true;
    }

    /// Clears the dirty flag.
    pub fn mark_clean(&mut self) {
        self.is_dirty = false;
    }

    /// Persists the library manifest and cache to disk.
    pub fn persist(&self) -> Result<(), SError> {
        toml::write(&self.lib_paths.manifest, &self.to_dto())?;
        toml::write(&self.lib_paths.cache, &self.cache)?;
        toml::write(&self.lib_paths.deployment, &self.deployment)?;
        Ok(())
    }

    /// Plan/preflight → compatibility purge → Deploy → Mark Clean → Persist.
    /// The canonical way to apply mod activation changes to the game directory.
    pub fn sync(&mut self) -> Result<(), SError> {
        use crate::core::{cleanup, deployment};
        let plan = deployment::plan(self)?;
        cleanup::purge(self)?;
        deployment::deploy(self, plan)?;
        self.mark_clean();
        self.persist()
    }
}
