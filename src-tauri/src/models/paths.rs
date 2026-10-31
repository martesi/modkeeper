use crate::models::error::SError;
use camino::{Utf8Path, Utf8PathBuf};
use dunce::canonicalize;
use std::path::PathBuf;

macro_rules! define_paths {
    ($name:ident { $($field:ident : $default:expr_2021),* $(,)? }) => {
        #[derive(Clone, Debug)]
        pub struct $name {
            $(pub $field: Utf8PathBuf,)*
        }

        impl $name {
            pub fn to_absolute(mut self, base: &Utf8Path) -> Self {
                $(self.$field = base.join(self.$field);)*
                self
            }

            pub fn new(base: &Utf8Path) -> Self {
                Self::default().to_absolute(base)
            }
        }

        impl Default for $name {
            fn default() -> Self {
                Self {
                    $($field: $default.into(),)*
                }
            }
        }
    };
}

define_paths!(SPTPathRules {
    client_plugins: "BepInEx/plugins",
    client_config: "BepInEx/config",
    server_mods: "SPT/user/mods",
    server_exe: "SPT/SPT.Server.exe",
    server_registry: "SPT/user/sptRegistry/registry.json",
    client_exe: "EscapeFromTarkov.exe",
    library_default: ".mod_keeper",
});

impl SPTPathRules {
    /// Discover the server directory while retaining the game-root-relative paths.
    pub fn for_game_root(base: &Utf8Path) -> Result<Self, SError> {
        let standard = base.join("SPT/SPT.Server.exe").is_file();
        let runtime = base.join("SPT_Runtime/SPT.Server.exe").is_file();
        if standard && runtime {
            return Err(SError::ParseError(
                "Both SPT and SPT_Runtime contain a server; select an installation with only one server".into(),
            ));
        }
        let mut rules = Self::default();
        if runtime {
            rules.server_mods = "SPT_Runtime/user/mods".into();
            rules.server_exe = "SPT_Runtime/SPT.Server.exe".into();
            rules.server_registry = "SPT_Runtime/user/sptRegistry/registry.json".into();
        }
        Ok(rules)
    }
}

define_paths!(LibPathRules {
    backups: "backups",
    mods: "mods",
    staging: "staging",
    manifest: "manifest.toml",
    cache: "cache.toml",
    deployment: "deployment.toml",
});
#[derive(Clone, Debug)]
pub struct SPTPathCanonical {
    pub server_exe: PathBuf,
    pub client_exe: PathBuf,
}

impl SPTPathCanonical {
    pub fn from_spt_paths(paths: SPTPathRules) -> Result<Self, SError> {
        Ok(Self {
            server_exe: canonicalize(paths.server_exe)?,
            client_exe: canonicalize(paths.client_exe)?,
        })
    }
}
