use crate::commands::log_err;
use crate::core::registry::AppRegistry;
use crate::core::task_progress::{ByteProgressThrottle, TaskProgressEmitter, TaskProgressOutcome};
use crate::core::{global_service, library_service};
use crate::models::error::SError;
use crate::models::forge::{
    ForgeAddonInstallConstraint, ForgeAddonParent, ForgeDetail, ForgeDownloadVersionInput,
    ForgeMatchInstalledModInput, ForgePageInfo, ForgeSearchItem, ForgeSearchPage,
    ForgeSearchResponse, ForgeVersion, ForgeVersionsPage,
};
use crate::models::mod_dto::{ForgeInstallMetadata, ForgeKind};
use crate::models::task_progress::{TaskOperation, TaskProgressStage};
use crate::models::workspace::{
    ArchiveFailure, LibraryWorkspace, OperationAccepted, WorkspaceEvent,
};
use crate::utils::time::now_iso8601_utc;
use camino::{Utf8Path, Utf8PathBuf};
use parking_lot::Mutex;
use reqwest::Url;
use reqwest::blocking::{Client, Response};
use reqwest::header::{CONTENT_DISPOSITION, RETRY_AFTER, USER_AGENT};
use reqwest::redirect::Policy;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{Map, Value};
use std::collections::{HashMap, VecDeque};
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, State};
use tauri_specta::Event;

const API_BASE: &str = "https://sp-mod.com/api/v0";
const CACHE_TTL: Duration = Duration::from_secs(24 * 60 * 60);
const MAX_PER_PAGE: u64 = 50;

#[derive(Serialize, Deserialize, Clone)]
struct CachedResponse {
    stored_at: u64,
    body: Value,
}

#[derive(Default)]
struct RateState {
    requests: VecDeque<Instant>,
    blocked_until: Option<Instant>,
}

static RESPONSE_CACHE: OnceLock<Mutex<HashMap<String, CachedResponse>>> = OnceLock::new();
static RATE_STATE: OnceLock<Mutex<RateState>> = OnceLock::new();
static HTTP_CLIENT: OnceLock<Result<Client, String>> = OnceLock::new();

fn response_cache() -> &'static Mutex<HashMap<String, CachedResponse>> {
    RESPONSE_CACHE.get_or_init(|| Mutex::new(load_response_cache()))
}

fn rate_state() -> &'static Mutex<RateState> {
    RATE_STATE.get_or_init(|| Mutex::new(RateState::default()))
}

fn cache_file() -> Option<std::path::PathBuf> {
    directories::ProjectDirs::from("", "", "Modkeeper")
        .map(|dirs| dirs.cache_dir().join("forge-v0-cache.json"))
}

fn load_response_cache() -> HashMap<String, CachedResponse> {
    let Some(path) = cache_file() else {
        return HashMap::new();
    };
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn persist_response_cache(cache: &HashMap<String, CachedResponse>) {
    let Some(path) = cache_file() else {
        return;
    };
    let Some(parent) = path.parent() else {
        return;
    };
    if fs::create_dir_all(parent).is_err() {
        return;
    }
    let Ok(bytes) = serde_json::to_vec(cache) else {
        return;
    };
    let temporary = path.with_extension("json.tmp");
    if fs::write(&temporary, bytes).is_ok() && fs::rename(&temporary, &path).is_err() {
        let _ = fs::remove_file(temporary);
    }
}

fn http_client() -> Result<&'static Client, SError> {
    match HTTP_CLIENT.get_or_init(|| {
        Client::builder()
            .user_agent("Modkeeper")
            .timeout(Duration::from_secs(600))
            .redirect(Policy::custom(|attempt| {
                if attempt.previous().len() >= 10
                    || !matches!(attempt.url().scheme(), "https" | "http")
                {
                    attempt.stop()
                } else {
                    attempt.follow()
                }
            }))
            .build()
            .map_err(|error| error.to_string())
    }) {
        Ok(client) => Ok(client),
        Err(error) => Err(SError::IOError(format!(
            "Unable to create Forge HTTP client: {error}"
        ))),
    }
}

fn wait_for_api_quota() -> Result<(), SError> {
    loop {
        let delay = {
            let mut state = rate_state().lock();
            let now = Instant::now();
            if let Some(until) = state.blocked_until {
                if until > now {
                    return Err(SError::IOError(format!(
                        "Forge asked this client to retry in {} seconds",
                        until.duration_since(now).as_secs().max(1)
                    )));
                }
                state.blocked_until = None;
            }
            while state
                .requests
                .front()
                .is_some_and(|stamp| now.duration_since(*stamp) >= Duration::from_secs(60))
            {
                state.requests.pop_front();
            }
            let per_ten_seconds = state
                .requests
                .iter()
                .filter(|stamp| now.duration_since(**stamp) < Duration::from_secs(10))
                .count();
            if state.requests.len() < 200 && per_ten_seconds < 40 {
                state.requests.push_back(now);
                return Ok(());
            }
            let window = if per_ten_seconds >= 40 {
                Duration::from_secs(10)
            } else {
                Duration::from_secs(60)
            };
            state
                .requests
                .iter()
                .find(|stamp| now.duration_since(**stamp) < window)
                .map(|stamp| window.saturating_sub(now.duration_since(*stamp)))
                .unwrap_or(Duration::from_secs(1))
        };
        std::thread::sleep(delay);
    }
}

fn retry_after_delay(response: &Response) -> Duration {
    response
        .headers()
        .get(RETRY_AFTER)
        .and_then(|header| header.to_str().ok())
        .and_then(parse_retry_after)
        .unwrap_or(Duration::from_secs(30))
}

fn parse_retry_after(value: &str) -> Option<Duration> {
    value
        .parse::<u64>()
        .ok()
        .map(Duration::from_secs)
        .or_else(|| {
            httpdate::parse_http_date(value)
                .ok()
                .and_then(|when| when.duration_since(SystemTime::now()).ok())
        })
}

fn note_rate_limit(response: &Response) -> Duration {
    let delay = retry_after_delay(response);
    rate_state().lock().blocked_until = Some(Instant::now() + delay);
    delay
}

fn api_get(url: &str) -> Result<Value, SError> {
    wait_for_api_quota()?;
    let response = http_client()?
        .get(url)
        .header(USER_AGENT, "Modkeeper")
        .send()
        .map_err(|error| SError::IOError(format!("Forge request failed: {error}")))?;
    if response.status().as_u16() == 429 {
        let delay = note_rate_limit(&response);
        return Err(SError::IOError(format!(
            "Forge rate limit reached; retry after {} seconds",
            delay.as_secs().max(1)
        )));
    }
    if !response.status().is_success() {
        return Err(SError::IOError(format!(
            "Forge returned HTTP {}",
            response.status().as_u16()
        )));
    }
    response
        .json()
        .map_err(|error| SError::ParseError(format!("Forge returned invalid JSON: {error}")))
}

/// Returns cached JSON with `stale=true` only after a request failure. Cached
/// redirect targets are never stored here; the cache only holds API responses.
fn cached_json(url: &str) -> Result<(Value, bool), SError> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let previous = response_cache().lock().get(url).cloned();
    if let Some(cached) = &previous
        && now.saturating_sub(cached.stored_at) < CACHE_TTL.as_secs()
    {
        return Ok((cached.body.clone(), false));
    }

    match api_get(url) {
        Ok(body) => {
            let cached = CachedResponse {
                stored_at: now,
                body: body.clone(),
            };
            let mut cache = response_cache().lock();
            cache.insert(url.to_string(), cached);
            persist_response_cache(&cache);
            Ok((body, false))
        }
        Err(error) => previous.map(|cached| (cached.body, true)).ok_or(error),
    }
}

fn api_url(path: &str, query: &[(&str, String)]) -> Result<String, SError> {
    let mut url = Url::parse(&format!("{API_BASE}/{path}"))
        .map_err(|error| SError::ParseError(format!("Invalid Forge API URL: {error}")))?;
    {
        let mut pairs = url.query_pairs_mut();
        for (key, value) in query {
            pairs.append_pair(key, value);
        }
    }
    Ok(url.into())
}

#[derive(Default, Deserialize)]
struct ApiPageMeta {
    current_page: Option<u64>,
    last_page: Option<u64>,
    per_page: Option<u64>,
    total: Option<u64>,
}

impl From<ApiPageMeta> for ForgePageInfo {
    fn from(meta: ApiPageMeta) -> Self {
        Self {
            current_page: meta.current_page,
            last_page: meta.last_page,
            per_page: meta.per_page,
            total: meta.total,
        }
    }
}

#[derive(Default, Deserialize)]
struct ApiParent {
    id: Option<u64>,
    guid: Option<String>,
    name: Option<String>,
    detail_url: Option<String>,
}

#[derive(Default, Deserialize)]
struct ApiRecord {
    id: Option<u64>,
    guid: Option<String>,
    name: Option<String>,
    slug: Option<String>,
    teaser: Option<String>,
    description: Option<String>,
    thumbnail: Option<String>,
    detail_url: Option<String>,
    fika_compatibility: Option<bool>,
    mod_id: Option<u64>,
    is_detached: Option<bool>,
    mod_version_constraint: Option<String>,
    #[serde(rename = "mod")]
    parent_mod: Option<ApiParent>,
    parent: Option<ApiParent>,
    #[serde(flatten)]
    _extra: Map<String, Value>,
}

impl ApiRecord {
    fn required_id(&self) -> Result<u64, SError> {
        self.id
            .ok_or_else(|| SError::ParseError("Forge record is missing required id".into()))
    }

    fn required_guid(&self) -> Result<String, SError> {
        self.guid
            .clone()
            .filter(|guid| !guid.is_empty())
            .ok_or_else(|| SError::ParseError("Forge record is missing required guid".into()))
    }

    fn required_name(&self) -> Result<String, SError> {
        self.name
            .clone()
            .filter(|name| !name.is_empty())
            .ok_or_else(|| SError::ParseError("Forge record is missing required name".into()))
    }

    fn parent(&self) -> Option<ForgeAddonParent> {
        let parent = self.parent_mod.as_ref().or(self.parent.as_ref());
        let id = self.mod_id.or_else(|| parent.and_then(|value| value.id))?;
        Some(ForgeAddonParent {
            id,
            guid: parent
                .and_then(|value| value.guid.clone())
                .unwrap_or_default(),
            name: parent
                .and_then(|value| value.name.clone())
                .unwrap_or_default(),
            detail_url: parent.and_then(|value| value.detail_url.clone()),
        })
    }

    fn into_search_item(self, kind: ForgeKind) -> Result<ForgeSearchItem, SError> {
        let parent = self.parent();
        Ok(ForgeSearchItem {
            kind,
            id: self.required_id()?,
            guid: self.required_guid()?,
            name: self.required_name()?,
            slug: self.slug,
            teaser: self.teaser,
            thumbnail: self.thumbnail,
            detail_url: self.detail_url,
            fika_compatibility: self.fika_compatibility,
            parent_mod_id: parent.as_ref().map(|value| value.id),
            parent_mod_guid: parent
                .as_ref()
                .and_then(|value| (!value.guid.is_empty()).then(|| value.guid.clone())),
            parent_mod_name: parent
                .as_ref()
                .and_then(|value| (!value.name.is_empty()).then(|| value.name.clone())),
            parent_mod_detail_url: parent.and_then(|value| value.detail_url),
            mod_version_constraint: self.mod_version_constraint,
            is_detached: self.is_detached,
        })
    }

    fn into_detail(self, kind: ForgeKind, stale: bool) -> Result<ForgeDetail, SError> {
        let parent = self.parent();
        Ok(ForgeDetail {
            kind,
            id: self.required_id()?,
            guid: self.required_guid()?,
            name: self.required_name()?,
            slug: self.slug,
            teaser: self.teaser,
            description: self.description,
            thumbnail: self.thumbnail,
            detail_url: self.detail_url,
            fika_compatibility: self.fika_compatibility,
            parent_mod_id: parent.as_ref().map(|value| value.id),
            parent,
            mod_version_constraint: self.mod_version_constraint,
            is_detached: self.is_detached,
            stale,
        })
    }
}

#[derive(Deserialize)]
struct ApiVersion {
    id: u64,
    version: String,
    #[serde(default)]
    description: Option<String>,
    link: String,
    content_length: u64,
    #[serde(default)]
    spt_version_constraint: Option<String>,
    #[serde(default)]
    fika_compatibility: Option<String>,
    #[serde(default)]
    dependencies: Vec<ApiDependency>,
}

#[derive(Default, Deserialize)]
struct ApiDependency {
    mod_id: Option<u64>,
    mod_guid: Option<String>,
    mod_name: Option<String>,
    version_constraint: Option<String>,
    is_optional: Option<bool>,
}

impl ApiVersion {
    fn into_version(self, kind: ForgeKind, item_id: u64) -> ForgeVersion {
        ForgeVersion {
            kind,
            item_id,
            id: self.id,
            version: self.version,
            description: self.description,
            link: self.link,
            content_length: self.content_length,
            spt_version_constraint: self.spt_version_constraint,
            fika_compatibility: self.fika_compatibility,
            dependencies: self
                .dependencies
                .into_iter()
                .map(|dependency| crate::models::forge::ForgeDependency {
                    mod_id: dependency.mod_id,
                    mod_guid: dependency.mod_guid,
                    mod_name: dependency.mod_name,
                    version_constraint: dependency.version_constraint,
                    is_optional: dependency.is_optional,
                })
                .collect(),
        }
    }
}

fn active_spt_version(state: &AppRegistry) -> Result<String, SError> {
    state
        .active_instance
        .lock()
        .as_ref()
        .map(|library| library.spt_version.clone())
        .ok_or(SError::NoActiveLibrary)
}

fn record_page<T: DeserializeOwned>(body: Value) -> Result<(Vec<T>, ForgePageInfo), SError> {
    let data = body
        .get("data")
        .cloned()
        .ok_or_else(|| SError::ParseError("Forge response is missing data".into()))?;
    let values = data
        .as_array()
        .ok_or_else(|| SError::ParseError("Forge page data is not an array".into()))?;
    let records = values
        .iter()
        .cloned()
        .map(serde_json::from_value)
        .collect::<Result<Vec<T>, _>>()
        .map_err(|error| SError::ParseError(format!("Malformed Forge page data: {error}")))?;
    let pagination = body
        .get("meta")
        .cloned()
        .map(serde_json::from_value::<ApiPageMeta>)
        .transpose()
        .map_err(|error| SError::ParseError(format!("Malformed Forge pagination: {error}")))?
        .unwrap_or_default()
        .into();
    Ok((records, pagination))
}

fn record_detail<T: DeserializeOwned>(body: Value) -> Result<T, SError> {
    let value = body
        .get("data")
        .cloned()
        .ok_or_else(|| SError::ParseError("Forge response is missing data".into()))?;
    serde_json::from_value(value)
        .map_err(|error| SError::ParseError(format!("Malformed Forge detail: {error}")))
}

fn search_page(
    kind: ForgeKind,
    query: &str,
    page: u64,
    per_page: u64,
    spt_version: &str,
) -> Result<ForgeSearchPage, SError> {
    let endpoint = if kind == ForgeKind::Mod {
        "mods"
    } else {
        "addons"
    };
    let mut params = vec![
        ("page", page.max(1).to_string()),
        ("per_page", per_page.clamp(1, MAX_PER_PAGE).to_string()),
        ("filter[spt_version]", spt_version.to_string()),
    ];
    if !query.trim().is_empty() {
        params.push(("query", query.trim().to_string()));
    }
    if kind == ForgeKind::Addon {
        params.push(("include", "mod".to_string()));
    }
    let (body, stale) = cached_json(&api_url(endpoint, &params)?)?;
    let (records, pagination) = record_page::<ApiRecord>(body)?;
    Ok(ForgeSearchPage {
        items: records
            .into_iter()
            .map(|record| record.into_search_item(kind.clone()))
            .collect::<Result<_, _>>()?,
        pagination,
        stale,
    })
}

fn detail(kind: ForgeKind, id: u64) -> Result<ForgeDetail, SError> {
    let endpoint = if kind == ForgeKind::Mod {
        "mod"
    } else {
        "addon"
    };
    let path = format!("{endpoint}/{id}");
    let params = if kind == ForgeKind::Addon {
        vec![("include", "mod".to_string())]
    } else {
        Vec::new()
    };
    let (body, stale) = cached_json(&api_url(&path, &params)?)?;
    let record = record_detail::<ApiRecord>(body)?;
    let mut result = record.into_detail(kind.clone(), stale)?;
    if kind == ForgeKind::Addon
        && !result.is_detached.unwrap_or(false)
        && result.parent_mod_id.is_some()
        && result
            .parent
            .as_ref()
            .is_none_or(|parent| parent.guid.is_empty() || parent.name.is_empty())
    {
        let parent_id = result
            .parent_mod_id
            .ok_or_else(|| SError::ParseError("Forge addon is missing its parent mod id".into()))?;
        let (parent_body, parent_stale) = cached_json(&api_url(&format!("mod/{parent_id}"), &[])?)?;
        result.stale |= parent_stale;
        let parent_record = record_detail::<ApiRecord>(parent_body)?;
        result.parent = Some(ForgeAddonParent {
            id: parent_id,
            guid: parent_record.required_guid()?,
            name: parent_record.required_name()?,
            detail_url: parent_record.detail_url,
        });
    }
    Ok(result)
}

fn versions_page(
    kind: ForgeKind,
    item_id: u64,
    page: u64,
    spt_version: &str,
) -> Result<ForgeVersionsPage, SError> {
    let endpoint = if kind == ForgeKind::Mod {
        "mod"
    } else {
        "addon"
    };
    let path = format!("{endpoint}/{item_id}/versions");
    let params = [
        ("page", page.max(1).to_string()),
        ("per_page", MAX_PER_PAGE.to_string()),
        ("filter[spt_version]", spt_version.to_string()),
        ("include", "dependencies".to_string()),
    ];
    let (body, stale) = cached_json(&api_url(&path, &params)?)?;
    let (records, pagination) = record_page::<ApiVersion>(body)?;
    Ok(ForgeVersionsPage {
        kind: kind.clone(),
        item_id,
        versions: records
            .into_iter()
            .map(|version| version.into_version(kind.clone(), item_id))
            .collect(),
        pagination,
        stale,
    })
}

fn search(
    query: String,
    mod_page: u64,
    addon_page: u64,
    per_page: u64,
    spt_version: String,
) -> Result<ForgeSearchResponse, SError> {
    Ok(ForgeSearchResponse {
        mods: search_page(ForgeKind::Mod, &query, mod_page, per_page, &spt_version)?,
        addons: search_page(ForgeKind::Addon, &query, addon_page, per_page, &spt_version)?,
        spt_version,
    })
}

struct FoundForgeVersion {
    version: ForgeVersion,
    stale: bool,
}

fn find_version(
    kind: ForgeKind,
    item_id: u64,
    version_id: u64,
    spt_version: &str,
) -> Result<FoundForgeVersion, SError> {
    let first = versions_page(kind.clone(), item_id, 1, spt_version)?;
    let first_stale = first.stale;
    if let Some(version) = first
        .versions
        .into_iter()
        .find(|version| version.id == version_id)
    {
        return Ok(FoundForgeVersion {
            version,
            stale: first_stale,
        });
    }
    let last_page = first.pagination.last_page.unwrap_or(1).min(100);
    for page in 2..=last_page {
        let versions = versions_page(kind.clone(), item_id, page, spt_version)?;
        let stale = versions.stale;
        if let Some(version) = versions
            .versions
            .into_iter()
            .find(|version| version.id == version_id)
        {
            return Ok(FoundForgeVersion { version, stale });
        }
    }
    Err(SError::ParseError(format!(
        "Forge version {version_id} was not found among versions compatible with SPT {spt_version}"
    )))
}

fn supported_archive_extension(name: &str) -> Option<&'static str> {
    match name.rsplit('.').next()?.to_ascii_lowercase().as_str() {
        "zip" => Some("zip"),
        "7z" => Some("7z"),
        _ => None,
    }
}

fn archive_extension(response: &Response) -> Result<&'static str, SError> {
    let from_disposition = response
        .headers()
        .get(CONTENT_DISPOSITION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| {
            value.split(';').find_map(|part| {
                let (key, value) = part.trim().split_once('=')?;
                (key.eq_ignore_ascii_case("filename") || key.eq_ignore_ascii_case("filename*"))
                    .then(|| value.trim().trim_matches('"').to_ascii_lowercase())
            })
        });
    let from_url = response
        .url()
        .path_segments()
        .and_then(|mut segments| segments.next_back())
        .map(str::to_ascii_lowercase);
    [from_disposition, from_url]
        .into_iter()
        .flatten()
        .find_map(|name| supported_archive_extension(&name))
        .ok_or_else(|| {
            SError::UnhandledCompression(
                "Forge download did not identify a supported .zip or .7z archive".into(),
            )
        })
}

fn download_archive(
    version: &ForgeVersion,
    root: &Utf8Path,
    mut on_progress: impl FnMut(TaskProgressStage, Option<f64>),
) -> Result<Utf8PathBuf, SError> {
    let mut response = http_client()?
        .get(&version.link)
        .header(USER_AGENT, "Modkeeper")
        .send()
        .map_err(|error| SError::IOError(format!("Forge download request failed: {error}")))?;
    if !response.status().is_success() {
        return Err(SError::IOError(format!(
            "Forge download returned HTTP {}",
            response.status().as_u16()
        )));
    }
    let extension = archive_extension(&response)?;
    fs::create_dir_all(root)?;
    let path = root.join(format!(
        "forge-{}-{}-{}.{}",
        version.item_id,
        version.id,
        uuid::Uuid::new_v4(),
        extension
    ));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)?;
    let mut received = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    let mut throttle = ByteProgressThrottle::new(version.content_length);
    loop {
        let count = match response.read(&mut buffer) {
            Ok(0) => break,
            Ok(count) => count,
            Err(error) => {
                let _ = fs::remove_file(&path);
                return Err(SError::IOError(format!(
                    "Forge archive stream failed: {error}"
                )));
            }
        };
        if let Err(error) = file.write_all(&buffer[..count]) {
            let _ = fs::remove_file(&path);
            return Err(SError::IOError(format!(
                "Forge archive staging write failed: {error}"
            )));
        }
        received = received.saturating_add(count as u64);
        if let Some(percent) = throttle.update(received, Instant::now(), false) {
            on_progress(TaskProgressStage::ForgeDownload, Some(percent));
        }
    }
    file.flush()?;
    if let Some(percent) = throttle.update(received, Instant::now(), true) {
        on_progress(TaskProgressStage::ForgeDownload, Some(percent));
    }
    let written = file.metadata()?.len();
    if let Err(error) =
        verify_download_size(received, written, version.content_length, &mut on_progress)
    {
        let _ = fs::remove_file(&path);
        return Err(error);
    }
    Ok(path)
}

fn verify_download_size(
    received: u64,
    written: u64,
    expected: u64,
    mut on_stage: impl FnMut(TaskProgressStage, Option<f64>),
) -> Result<(), SError> {
    on_stage(TaskProgressStage::ForgeSizeVerification, None);
    if written != received {
        return Err(SError::IOError(
            "Forge archive staging byte count did not match the received byte count".into(),
        ));
    }
    if received != expected {
        return Err(SError::ParseError(format!(
            "Forge archive size mismatch: expected {expected} bytes, received {received}"
        )));
    }
    Ok(())
}

fn download_and_install(
    instance_handle: Arc<Mutex<Option<crate::core::library::Library>>>,
    library_id: String,
    material: crate::core::mod_stager::StageMaterial,
    enable_on_install: bool,
    input: ForgeDownloadVersionInput,
    spt_version: String,
    progress: &mut TaskProgressEmitter,
) -> Result<(), SError> {
    progress.progress(TaskProgressStage::ForgeMetadata, None);
    let record = detail(input.kind.clone(), input.item_id)?;
    if record.stale {
        return Err(SError::IOError(
            "Forge detail is stale; reconnect before installing this item".into(),
        ));
    }
    progress.progress(TaskProgressStage::ForgeVersions, None);
    let found_version = find_version(
        input.kind.clone(),
        input.item_id,
        input.version_id,
        &spt_version,
    )?;
    if found_version.stale {
        return Err(SError::IOError(
            "Forge version data is stale; reconnect before installing this version".into(),
        ));
    }
    let version = found_version.version;
    progress.progress(TaskProgressStage::ForgeDownload, None);
    let archive = download_archive(&version, &material.root, |stage, percent| {
        progress.progress(stage, percent);
    })?;
    let metadata = ForgeInstallMetadata {
        kind: input.kind.clone(),
        forge_id: input.item_id,
        forge_guid: record.guid,
        version: version.version,
        version_id: version.id,
        cached_at: now_iso8601_utc(),
    };
    let addon_constraint = if input.kind == ForgeKind::Addon {
        Some(ForgeAddonInstallConstraint {
            is_detached: record.is_detached.unwrap_or(false),
            parent_forge_id: record.parent.as_ref().map(|parent| parent.id),
            parent_guid: record.parent.as_ref().map(|parent| parent.guid.clone()),
            version_constraint: record.mod_version_constraint.clone(),
        })
    } else {
        None
    };
    let result = library_service::install_forge_archive_with_progress(
        instance_handle,
        &library_id,
        &material,
        &archive,
        enable_on_install,
        &metadata,
        addon_constraint.as_ref(),
        |stage, percent| progress.progress(stage, percent),
    );
    let _ = fs::remove_file(archive);
    result
}

fn assemble_workspace(
    config_handle: &Arc<Mutex<crate::store::AppConfigStore>>,
    instance_handle: &Arc<Mutex<Option<crate::core::library::Library>>>,
) -> LibraryWorkspace {
    let store = config_handle.lock();
    let instance = instance_handle.lock();
    global_service::assemble_workspace(&store.config, instance.as_ref(), None)
}

fn finish_task(tasks: &Arc<Mutex<std::collections::HashSet<String>>>, task_id: &str) {
    tasks.lock().remove(task_id);
}

#[tauri::command]
#[specta::specta]
pub async fn forge_search(
    state: State<'_, AppRegistry>,
    query: String,
    mod_page: u32,
    addon_page: u32,
    per_page: u32,
) -> Result<ForgeSearchResponse, SError> {
    let spt_version = log_err(active_spt_version(&state))?;
    log_err(
        tauri::async_runtime::spawn_blocking(move || {
            search(
                query,
                u64::from(mod_page),
                u64::from(addon_page),
                u64::from(per_page),
                spt_version,
            )
        })
        .await
        .map_err(|error| SError::AsyncRuntimeError(error.to_string()))
        .and_then(|result| result),
    )
}

#[tauri::command]
#[specta::specta]
pub async fn forge_mod_detail(
    state: State<'_, AppRegistry>,
    kind: ForgeKind,
    id: u32,
) -> Result<ForgeDetail, SError> {
    let _ = log_err(active_spt_version(&state))?;
    log_err(
        tauri::async_runtime::spawn_blocking(move || detail(kind, u64::from(id)))
            .await
            .map_err(|error| SError::AsyncRuntimeError(error.to_string()))
            .and_then(|result| result),
    )
}

#[tauri::command]
#[specta::specta]
pub async fn forge_mod_versions(
    state: State<'_, AppRegistry>,
    kind: ForgeKind,
    id: u32,
    page: u32,
) -> Result<ForgeVersionsPage, SError> {
    let spt_version = log_err(active_spt_version(&state))?;
    log_err(
        tauri::async_runtime::spawn_blocking(move || {
            versions_page(kind, u64::from(id), u64::from(page), &spt_version)
        })
        .await
        .map_err(|error| SError::AsyncRuntimeError(error.to_string()))
        .and_then(|result| result),
    )
}

#[tauri::command]
#[specta::specta]
pub async fn forge_addon_versions(
    state: State<'_, AppRegistry>,
    id: u32,
    page: u32,
) -> Result<ForgeVersionsPage, SError> {
    let spt_version = log_err(active_spt_version(&state))?;
    log_err(
        tauri::async_runtime::spawn_blocking(move || {
            versions_page(
                ForgeKind::Addon,
                u64::from(id),
                u64::from(page),
                &spt_version,
            )
        })
        .await
        .map_err(|error| SError::AsyncRuntimeError(error.to_string()))
        .and_then(|result| result),
    )
}

/// Applies a user-selected Forge match to an existing local install without
/// attempting to inspect its DLLs or archive contents.
#[tauri::command]
#[specta::specta]
pub async fn forge_match_installed_mod(
    state: State<'_, AppRegistry>,
    input: ForgeMatchInstalledModInput,
) -> Result<LibraryWorkspace, SError> {
    log_err(state.assert_active_library(&input.library_id))?;
    let spt_version = log_err(active_spt_version(&state))?;
    let instance_handle = state.active_instance.clone();
    let config_handle = state.app_config.clone();
    log_err(
        tauri::async_runtime::spawn_blocking(move || {
            let record = detail(input.kind.clone(), input.item_id)?;
            if record.stale {
                return Err(SError::IOError(
                    "Forge detail is stale; reconnect before matching this item".into(),
                ));
            }
            let found_version = find_version(
                input.kind.clone(),
                input.item_id,
                input.version_id,
                &spt_version,
            )?;
            if found_version.stale {
                return Err(SError::IOError(
                    "Forge version data is stale; reconnect before matching this version".into(),
                ));
            }
            let version = found_version.version;
            let metadata = ForgeInstallMetadata {
                kind: input.kind.clone(),
                forge_id: input.item_id,
                forge_guid: record.guid,
                version: version.version,
                version_id: version.id,
                cached_at: now_iso8601_utc(),
            };
            let addon_constraint =
                (input.kind == ForgeKind::Addon).then(|| ForgeAddonInstallConstraint {
                    is_detached: record.is_detached.unwrap_or(false),
                    parent_forge_id: record.parent.as_ref().map(|parent| parent.id),
                    parent_guid: record.parent.as_ref().map(|parent| parent.guid.clone()),
                    version_constraint: record.mod_version_constraint.clone(),
                });
            library_service::match_forge_metadata(
                instance_handle.clone(),
                &input.library_id,
                &input.installed_mod_id,
                &metadata,
                addon_constraint.as_ref(),
            )?;
            Ok(assemble_workspace(&config_handle, &instance_handle))
        })
        .await
        .map_err(|error| SError::AsyncRuntimeError(error.to_string()))
        .and_then(|result| result),
    )
}

#[tauri::command]
#[specta::specta]
pub async fn forge_download_version(
    app: AppHandle,
    state: State<'_, AppRegistry>,
    input: ForgeDownloadVersionInput,
) -> Result<OperationAccepted, SError> {
    let mut progress = TaskProgressEmitter::new(
        app.clone(),
        input.task_id.clone(),
        input.library_id.clone(),
        TaskOperation::ForgeInstall,
    );
    let (spt_version, material) = log_err(progress.start_after_admission((|| {
        state.assert_active_library(&input.library_id)?;
        let version = active_spt_version(&state)?;
        let material = state.get_stage_material("Forge download".to_string())?;
        state.begin_task(&input.task_id)?;
        Ok((version, material))
    })()))?;
    let enable_on_install = state
        .app_config
        .lock()
        .config
        .settings
        .enable_mods_on_install;
    let config_handle = state.app_config.clone();
    let instance_handle = state.active_instance.clone();
    let tasks = state.in_flight_tasks.clone();
    let completion = input.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let result = download_and_install(
            instance_handle.clone(),
            input.library_id.clone(),
            material,
            enable_on_install,
            input.clone(),
            spt_version,
            &mut progress,
        );
        let (failures, outcome) = match result {
            Ok(()) => (Vec::new(), TaskProgressOutcome::Success),
            Err(error) => {
                tracing::error!("Forge install failed: {error}");
                (
                    vec![ArchiveFailure {
                        archive_path: format!(
                            "forge:{:?}:{}:{}",
                            completion.kind, completion.item_id, completion.version_id
                        ),
                        error,
                    }],
                    TaskProgressOutcome::Failure,
                )
            }
        };
        progress.completed(outcome);
        let task_id = completion.task_id.clone();
        let event = WorkspaceEvent::ModInstallCompleted {
            task_id: completion.task_id,
            library_id: completion.library_id,
            failures,
            workspace: assemble_workspace(&config_handle, &instance_handle),
        };
        if let Err(error) = event.emit(&app) {
            tracing::error!("Failed to emit Forge install completion: {error}");
        }
        finish_task(&tasks, &task_id);
    });

    Ok(OperationAccepted::new())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn api_record_requires_identity_fields() {
        let missing_guid: ApiRecord = serde_json::from_value(serde_json::json!({
            "id": 1,
            "name": "Example"
        }))
        .unwrap();
        assert!(missing_guid.into_search_item(ForgeKind::Mod).is_err());
    }

    #[test]
    fn supported_download_extensions_are_explicit() {
        assert_eq!(supported_archive_extension("mod.zip"), Some("zip"));
        assert_eq!(supported_archive_extension("mod.7z"), Some("7z"));
        assert_eq!(supported_archive_extension("mod.rar"), None);
    }

    #[test]
    fn content_length_mismatch_emits_verification_stage_before_failing() {
        let mut stages = Vec::new();
        let result = verify_download_size(9, 9, 10, |stage, percent| {
            stages.push((stage, percent));
        });
        assert!(matches!(result, Err(SError::ParseError(_))));
        assert_eq!(stages, [(TaskProgressStage::ForgeSizeVerification, None)]);
    }

    #[test]
    fn api_version_requires_download_size_and_link() {
        let missing_size = serde_json::from_value::<ApiVersion>(serde_json::json!({
            "id": 5,
            "version": "1.2.0",
            "link": "https://sp-mod.com/download"
        }));
        assert!(missing_size.is_err());
    }

    #[test]
    fn retry_after_accepts_seconds_and_http_date() {
        assert_eq!(parse_retry_after("30"), Some(Duration::from_secs(30)));
        let future = SystemTime::now() + Duration::from_secs(60);
        let date = httpdate::fmt_http_date(future);
        assert!(parse_retry_after(&date).is_some());
    }
}
