use std::path::Path;
use sysinfo::{ProcessesToUpdate, System};

pub fn is_running<P: AsRef<Path>>(sys: &mut System, target_paths: &[P]) -> bool {
    sys.refresh_processes(ProcessesToUpdate::All, true);

    sys.processes()
        .values()
        .filter_map(|process| process.exe())
        .any(|exe| target_paths.iter().any(|target| exe == target.as_ref()))
}
