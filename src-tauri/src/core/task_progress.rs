use crate::models::task_progress::{
    TaskOperation, TaskProgressEvent, TaskProgressKind, TaskProgressLevel, TaskProgressLog,
    TaskProgressStage,
};
use std::time::{Duration, Instant};
use tauri::AppHandle;
use tauri_specta::Event;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TaskProgressOutcome {
    Success,
    PartialFailure,
    Failure,
}

pub struct TaskProgressEmitter {
    task_id: String,
    library_id: String,
    operation: TaskOperation,
    sequence: u32,
    send: Box<dyn Fn(TaskProgressEvent) -> Result<(), String> + Send + Sync>,
}

impl TaskProgressEmitter {
    pub fn new(
        app: AppHandle,
        task_id: impl Into<String>,
        library_id: impl Into<String>,
        operation: TaskOperation,
    ) -> Self {
        Self::with_sink(task_id, library_id, operation, move |event| {
            event.emit(&app).map_err(|error| error.to_string())
        })
    }

    fn with_sink(
        task_id: impl Into<String>,
        library_id: impl Into<String>,
        operation: TaskOperation,
        send: impl Fn(TaskProgressEvent) -> Result<(), String> + Send + Sync + 'static,
    ) -> Self {
        Self {
            task_id: task_id.into(),
            library_id: library_id.into(),
            operation,
            sequence: 0,
            send: Box::new(send),
        }
    }

    /// Emits `started` only when admission succeeded; a rejected task has no
    /// progress stream and continues to use the command's existing error.
    pub fn start_after_admission<T, E>(&mut self, admission: Result<T, E>) -> Result<T, E> {
        let value = admission?;
        self.emit(
            TaskProgressKind::Started,
            TaskProgressStage::TaskStarted,
            None,
            None,
        );
        Ok(value)
    }

    pub fn progress(&mut self, stage: TaskProgressStage, percent: Option<f64>) {
        self.emit(
            TaskProgressKind::Progress,
            stage,
            valid_percent(percent),
            None,
        );
    }

    pub fn completed(&mut self, outcome: TaskProgressOutcome) {
        let (stage, level, code, message) = match outcome {
            TaskProgressOutcome::Success => (
                TaskProgressStage::TaskCompleted,
                TaskProgressLevel::Info,
                "task_completed",
                "Operation completed",
            ),
            TaskProgressOutcome::PartialFailure => (
                TaskProgressStage::TaskPartialFailure,
                TaskProgressLevel::Warn,
                "task_partial_failure",
                "Operation completed with some failures",
            ),
            TaskProgressOutcome::Failure => (
                TaskProgressStage::TaskFailed,
                TaskProgressLevel::Error,
                "task_failed",
                "Operation failed",
            ),
        };
        self.emit(
            TaskProgressKind::Completed,
            stage,
            None,
            Some(TaskProgressLog {
                level,
                code: code.to_string(),
                message: message.to_string(),
            }),
        );
    }

    fn emit(
        &mut self,
        kind: TaskProgressKind,
        stage: TaskProgressStage,
        percent: Option<f64>,
        log: Option<TaskProgressLog>,
    ) {
        self.sequence = self.sequence.saturating_add(1);
        let event = TaskProgressEvent {
            task_id: self.task_id.clone(),
            library_id: self.library_id.clone(),
            operation: self.operation.clone(),
            sequence: self.sequence,
            kind,
            stage,
            percent,
            log,
        };
        if (self.send)(event).is_err() {
            tracing::warn!("Failed to emit task_progress event");
        }
    }
}

fn valid_percent(percent: Option<f64>) -> Option<f64> {
    percent
        .filter(|value| value.is_finite())
        .map(|value| value.clamp(0.0, 100.0))
}

pub fn archive_count_percent(completed: usize, total: usize) -> Option<f64> {
    if total == 0 {
        None
    } else {
        Some((completed as f64 * 100.0 / total as f64).clamp(0.0, 100.0))
    }
}

pub fn archive_outcome(failures: usize, total: usize) -> TaskProgressOutcome {
    match (failures, total) {
        (0, _) => TaskProgressOutcome::Success,
        (failures, total) if failures < total => TaskProgressOutcome::PartialFailure,
        _ => TaskProgressOutcome::Failure,
    }
}

/// Throttles byte-derived stage percentages to roughly 1% or 100 ms while
/// preserving the exact final byte-derived percentage for the caller.
pub struct ByteProgressThrottle {
    total: u64,
    last_percent: Option<f64>,
    last_emitted_at: Option<Instant>,
}

impl ByteProgressThrottle {
    pub fn new(total: u64) -> Self {
        Self {
            total,
            last_percent: None,
            last_emitted_at: None,
        }
    }

    pub fn update(&mut self, bytes_read: u64, now: Instant, force: bool) -> Option<f64> {
        if self.total == 0 {
            return None;
        }
        let percent = (bytes_read as f64 * 100.0 / self.total as f64).clamp(0.0, 100.0);
        let percentage_changed = self
            .last_percent
            .is_none_or(|last| (percent - last).abs() >= 1.0);
        let elapsed = self
            .last_emitted_at
            .is_none_or(|last| now.saturating_duration_since(last) >= Duration::from_millis(100));
        if force || percentage_changed || elapsed {
            self.last_percent = Some(percent);
            self.last_emitted_at = Some(now);
            Some(percent)
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    fn capture_emitter(
        sent: Arc<Mutex<Vec<TaskProgressEvent>>>,
        fail: bool,
    ) -> TaskProgressEmitter {
        TaskProgressEmitter::with_sink("task-1", "library-1", TaskOperation::Install, move |e| {
            sent.lock().unwrap().push(e);
            if fail {
                Err("test send failure".to_string())
            } else {
                Ok(())
            }
        })
    }

    #[test]
    fn rejected_admission_emits_no_started_event() {
        let sent = Arc::new(Mutex::new(Vec::new()));
        let mut emitter = capture_emitter(sent.clone(), false);
        let admission: Result<(), &'static str> = Err("duplicate task");
        assert_eq!(
            emitter.start_after_admission(admission),
            Err("duplicate task")
        );
        assert!(sent.lock().unwrap().is_empty());
    }

    #[test]
    fn fast_completion_has_started_then_terminal_sequence() {
        let sent = Arc::new(Mutex::new(Vec::new()));
        let mut emitter = capture_emitter(sent.clone(), false);
        emitter.start_after_admission(Ok::<_, ()>(())).unwrap();
        emitter.completed(TaskProgressOutcome::Success);
        let events = sent.lock().unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].kind, TaskProgressKind::Started);
        assert_eq!(events[0].sequence, 1);
        assert_eq!(events[1].kind, TaskProgressKind::Completed);
        assert_eq!(events[1].sequence, 2);
    }

    #[test]
    fn failed_event_send_does_not_prevent_progress_or_completion() {
        let sent = Arc::new(Mutex::new(Vec::new()));
        let mut emitter = capture_emitter(sent.clone(), true);
        emitter.start_after_admission(Ok::<_, ()>(())).unwrap();
        emitter.progress(TaskProgressStage::InstallArchives, Some(50.0));
        emitter.completed(TaskProgressOutcome::Success);
        let events = sent.lock().unwrap();
        assert_eq!(events.len(), 3);
        assert_eq!(
            events
                .iter()
                .map(|event| event.sequence)
                .collect::<Vec<_>>(),
            [1, 2, 3]
        );
        assert_eq!(events[2].kind, TaskProgressKind::Completed);
    }

    #[test]
    fn archive_progress_and_partial_failure_use_actual_counts() {
        assert_eq!(archive_count_percent(1, 4), Some(25.0));
        assert_eq!(archive_count_percent(3, 4), Some(75.0));
        assert_eq!(archive_outcome(1, 4), TaskProgressOutcome::PartialFailure);
        assert_eq!(archive_outcome(4, 4), TaskProgressOutcome::Failure);
        assert_eq!(archive_outcome(0, 4), TaskProgressOutcome::Success);
    }

    #[test]
    fn empty_and_unknown_byte_totals_remain_indeterminate() {
        assert_eq!(archive_count_percent(0, 0), None);
        let mut throttle = ByteProgressThrottle::new(0);
        assert_eq!(throttle.update(0, Instant::now(), true), None);
        assert_eq!(archive_count_percent(1, 2), Some(50.0));
    }

    #[test]
    fn byte_progress_uses_received_bytes_and_throttles() {
        let now = Instant::now();
        let mut throttle = ByteProgressThrottle::new(1000);
        assert_eq!(throttle.update(100, now, false), Some(10.0));
        assert_eq!(
            throttle.update(105, now + Duration::from_millis(50), false),
            None
        );
        assert_eq!(
            throttle.update(105, now + Duration::from_millis(100), false),
            Some(10.5)
        );
        assert_eq!(
            throttle.update(250, now + Duration::from_millis(101), true),
            Some(25.0)
        );
    }

    #[test]
    fn percentages_are_clamped_and_non_finite_values_are_indeterminate() {
        assert_eq!(valid_percent(Some(-1.0)), Some(0.0));
        assert_eq!(valid_percent(Some(101.0)), Some(100.0));
        assert_eq!(valid_percent(Some(f64::NAN)), None);
        assert_eq!(valid_percent(None), None);
    }
}
