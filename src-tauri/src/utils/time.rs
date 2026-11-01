use camino::Utf8Path;
use std::time::{SystemTime, UNIX_EPOCH};

/// Best-effort installation time for mods written before timestamps were recorded.
pub fn file_created_at(path: &Utf8Path) -> Option<String> {
    let metadata = path.metadata().ok()?;
    metadata
        .created()
        .or_else(|_| metadata.modified())
        .ok()
        .map(to_iso8601_utc)
}

pub fn get_unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// Formats a SystemTime as an ISO 8601 UTC timestamp (e.g. "2026-07-13T09:30:00Z").
/// Hand-rolled so the wire contract doesn't pull in a date/time dependency.
pub fn to_iso8601_utc(t: SystemTime) -> String {
    let secs = t.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
    let (year, month, day) = civil_from_days((secs / 86400) as i64);
    let rem = secs % 86400;
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

pub fn now_iso8601_utc() -> String {
    to_iso8601_utc(SystemTime::now())
}

// Howard Hinnant's days-to-civil algorithm.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}
