use std::{
    error::Error,
    ffi::OsString,
    fmt,
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard},
    time::Duration,
};

#[cfg(not(debug_assertions))]
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

const SIDECAR_NAME: &str = "poke-capture";
const RESTART_DELAY: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct RunningProcess {
    generation: u64,
    pid: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LifecycleError {
    AlreadyRunning { pid: u32 },
    GenerationExhausted,
    ShuttingDown,
}

impl fmt::Display for LifecycleError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::AlreadyRunning { pid } => {
                write!(
                    formatter,
                    "capture sidecar is already running with pid {pid}"
                )
            }
            Self::GenerationExhausted => {
                write!(formatter, "capture sidecar generation counter is exhausted")
            }
            Self::ShuttingDown => write!(formatter, "capture sidecar is shutting down"),
        }
    }
}

impl Error for LifecycleError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TerminationDisposition {
    Ignore,
    Restart,
}

#[derive(Debug)]
struct LifecycleState {
    next_generation: u64,
    running: Option<RunningProcess>,
    shutting_down: bool,
}

impl LifecycleState {
    fn new() -> Self {
        Self {
            next_generation: 0,
            running: None,
            shutting_down: false,
        }
    }

    fn ensure_start_allowed(&self) -> Result<(), LifecycleError> {
        if self.shutting_down {
            return Err(LifecycleError::ShuttingDown);
        }
        if let Some(process) = self.running {
            return Err(LifecycleError::AlreadyRunning { pid: process.pid });
        }
        Ok(())
    }

    fn start(&mut self, pid: u32) -> Result<u64, LifecycleError> {
        self.ensure_start_allowed()?;
        let generation = self
            .next_generation
            .checked_add(1)
            .ok_or(LifecycleError::GenerationExhausted)?;
        self.next_generation = generation;
        self.running = Some(RunningProcess { generation, pid });
        Ok(generation)
    }

    fn terminated(&mut self, generation: u64) -> TerminationDisposition {
        let is_current = self
            .running
            .is_some_and(|process| process.generation == generation);
        if !is_current {
            return TerminationDisposition::Ignore;
        }
        self.running = None;
        if self.shutting_down {
            TerminationDisposition::Ignore
        } else {
            TerminationDisposition::Restart
        }
    }

    fn begin_shutdown(&mut self) -> Option<u32> {
        self.shutting_down = true;
        self.running.take().map(|process| process.pid)
    }

    #[cfg(test)]
    fn running_pid(&self) -> Option<u32> {
        self.running.map(|process| process.pid)
    }
}

#[derive(Debug)]
pub(crate) enum CaptureSidecarError {
    DataFileMissing {
        label: &'static str,
        path: PathBuf,
    },
    Lifecycle(LifecycleError),
    ManagerAlreadyInstalled,
    #[cfg(not(debug_assertions))]
    ResourcePath {
        label: &'static str,
        detail: String,
    },
    SidecarCommand {
        detail: String,
    },
    SidecarKill {
        pid: u32,
        detail: String,
    },
    SidecarSpawn {
        detail: String,
    },
    StatePoisoned,
}

impl fmt::Display for CaptureSidecarError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::DataFileMissing { label, path } => {
                write!(
                    formatter,
                    "capture {label} data file is missing: {}",
                    path.display()
                )
            }
            Self::Lifecycle(error) => write!(formatter, "{error}"),
            Self::ManagerAlreadyInstalled => {
                write!(formatter, "capture sidecar manager is already installed")
            }
            #[cfg(not(debug_assertions))]
            Self::ResourcePath { label, detail } => {
                write!(
                    formatter,
                    "capture {label} resource path could not be resolved: {detail}"
                )
            }
            Self::SidecarCommand { detail } => {
                write!(
                    formatter,
                    "capture sidecar command could not be created: {detail}"
                )
            }
            Self::SidecarKill { pid, detail } => {
                write!(
                    formatter,
                    "capture sidecar pid {pid} could not be terminated: {detail}"
                )
            }
            Self::SidecarSpawn { detail } => {
                write!(formatter, "capture sidecar could not be spawned: {detail}")
            }
            Self::StatePoisoned => write!(formatter, "capture sidecar state lock is poisoned"),
        }
    }
}

impl Error for CaptureSidecarError {}

impl From<LifecycleError> for CaptureSidecarError {
    fn from(error: LifecycleError) -> Self {
        Self::Lifecycle(error)
    }
}

#[derive(Debug)]
struct CaptureDataPaths {
    japanese_names: PathBuf,
    species: PathBuf,
}

impl CaptureDataPaths {
    fn resolve(app: &AppHandle) -> Result<Self, CaptureSidecarError> {
        #[cfg(debug_assertions)]
        let _ = app;

        #[cfg(debug_assertions)]
        let paths = {
            let data_directory = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../src/data");
            Self {
                species: data_directory.join("champions-species.json"),
                japanese_names: data_directory.join("ja-names.json"),
            }
        };

        #[cfg(not(debug_assertions))]
        let paths = Self {
            species: app
                .path()
                .resolve(
                    "capture-data/champions-species.json",
                    BaseDirectory::Resource,
                )
                .map_err(|error| CaptureSidecarError::ResourcePath {
                    label: "species",
                    detail: error.to_string(),
                })?,
            japanese_names: app
                .path()
                .resolve("capture-data/ja-names.json", BaseDirectory::Resource)
                .map_err(|error| CaptureSidecarError::ResourcePath {
                    label: "Japanese names",
                    detail: error.to_string(),
                })?,
        };

        validate_data_file("species", &paths.species)?;
        validate_data_file("Japanese names", &paths.japanese_names)?;
        Ok(paths)
    }

    fn arguments(&self) -> Vec<OsString> {
        vec![
            OsString::from("recognize-stream"),
            self.species.as_os_str().to_owned(),
            self.japanese_names.as_os_str().to_owned(),
        ]
    }
}

fn validate_data_file(label: &'static str, path: &Path) -> Result<(), CaptureSidecarError> {
    if !path.is_file() {
        return Err(CaptureSidecarError::DataFileMissing {
            label,
            path: path.to_path_buf(),
        });
    }
    Ok(())
}

#[derive(Debug)]
struct ManagerState {
    child: Option<(u64, CommandChild)>,
    lifecycle: LifecycleState,
}

#[derive(Debug)]
struct CaptureSidecarManager {
    data_paths: CaptureDataPaths,
    state: Mutex<ManagerState>,
}

impl CaptureSidecarManager {
    fn new(data_paths: CaptureDataPaths) -> Self {
        Self {
            data_paths,
            state: Mutex::new(ManagerState {
                child: None,
                lifecycle: LifecycleState::new(),
            }),
        }
    }

    fn lock(&self) -> Result<MutexGuard<'_, ManagerState>, CaptureSidecarError> {
        self.state
            .lock()
            .map_err(|_| CaptureSidecarError::StatePoisoned)
    }
}

#[derive(Debug)]
enum ProcessEnd {
    EventStreamClosed,
    Terminated {
        code: Option<i32>,
        signal: Option<i32>,
    },
}

pub(crate) fn install(app: &AppHandle) -> Result<(), CaptureSidecarError> {
    let data_paths = CaptureDataPaths::resolve(app)?;
    if !app.manage(CaptureSidecarManager::new(data_paths)) {
        return Err(CaptureSidecarError::ManagerAlreadyInstalled);
    }
    start(app)
}

fn start(app: &AppHandle) -> Result<(), CaptureSidecarError> {
    let manager = app.state::<CaptureSidecarManager>();
    let mut state = manager.lock()?;
    state.lifecycle.ensure_start_allowed()?;

    let command = app
        .shell()
        .sidecar(SIDECAR_NAME)
        .map_err(|error| CaptureSidecarError::SidecarCommand {
            detail: error.to_string(),
        })?
        .args(manager.data_paths.arguments());
    let (mut receiver, child) =
        command
            .spawn()
            .map_err(|error| CaptureSidecarError::SidecarSpawn {
                detail: error.to_string(),
            })?;
    let pid = child.pid();
    let generation = state.lifecycle.start(pid)?;
    state.child = Some((generation, child));
    drop(state);

    eprintln!("capture sidecar started: pid={pid}, generation={generation}");
    let monitor_app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut saw_termination = false;
        while let Some(event) = receiver.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    eprintln!(
                        "capture sidecar stdout: {}",
                        String::from_utf8_lossy(&bytes)
                    );
                }
                CommandEvent::Stderr(bytes) => {
                    eprintln!(
                        "capture sidecar stderr: {}",
                        String::from_utf8_lossy(&bytes)
                    );
                }
                CommandEvent::Error(detail) => {
                    eprintln!("capture sidecar event error: {detail}");
                }
                CommandEvent::Terminated(payload) => {
                    saw_termination = true;
                    handle_process_end(
                        monitor_app.clone(),
                        generation,
                        ProcessEnd::Terminated {
                            code: payload.code,
                            signal: payload.signal,
                        },
                    );
                    break;
                }
                _ => {}
            }
        }
        if !saw_termination {
            handle_process_end(monitor_app, generation, ProcessEnd::EventStreamClosed);
        }
    });
    Ok(())
}

fn handle_process_end(app: AppHandle, generation: u64, end: ProcessEnd) -> () {
    match end {
        ProcessEnd::EventStreamClosed => {
            eprintln!("capture sidecar event stream closed: generation={generation}");
        }
        ProcessEnd::Terminated { code, signal } => {
            eprintln!(
                "capture sidecar terminated: generation={generation}, code={code:?}, signal={signal:?}"
            );
        }
    }

    let disposition = {
        let manager = app.state::<CaptureSidecarManager>();
        let Ok(mut state) = manager.lock() else {
            eprintln!("capture sidecar restart aborted: state lock is poisoned");
            return;
        };
        if state
            .child
            .as_ref()
            .is_some_and(|(active_generation, _)| *active_generation == generation)
        {
            state.child = None;
        }
        state.lifecycle.terminated(generation)
    };

    if disposition == TerminationDisposition::Restart {
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(RESTART_DELAY).await;
            if let Err(error) = start(&app) {
                if !matches!(
                    error,
                    CaptureSidecarError::Lifecycle(LifecycleError::ShuttingDown)
                ) {
                    eprintln!("capture sidecar restart failed: {error}");
                }
            }
        });
    }
}

pub(crate) fn shutdown(app: &AppHandle) -> Result<(), CaptureSidecarError> {
    let manager = app.state::<CaptureSidecarManager>();
    let (pid, child) = {
        let mut state = manager.lock()?;
        let pid = state.lifecycle.begin_shutdown();
        let child = state.child.take().map(|(_, child)| child);
        (pid, child)
    };

    if let (Some(pid), Some(child)) = (pid, child) {
        child
            .kill()
            .map_err(|error| CaptureSidecarError::SidecarKill {
                pid,
                detail: error.to_string(),
            })?;
        eprintln!("capture sidecar stopped: pid={pid}");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{LifecycleError, LifecycleState, TerminationDisposition};

    #[test]
    fn rejects_a_duplicate_capture_process_start() -> () {
        let mut state = LifecycleState::new();
        state.start(101).expect("first start should succeed");

        assert_eq!(
            state.start(202),
            Err(LifecycleError::AlreadyRunning { pid: 101 })
        );
    }

    #[test]
    fn restarts_only_after_the_current_process_exits_unexpectedly() -> () {
        let mut state = LifecycleState::new();
        let first_generation = state.start(101).expect("first start should succeed");

        assert_eq!(
            state.terminated(first_generation),
            TerminationDisposition::Restart
        );

        let second_generation = state.start(202).expect("restart should succeed");
        assert_eq!(
            state.terminated(first_generation),
            TerminationDisposition::Ignore
        );
        assert_eq!(state.running_pid(), Some(202));
        assert_ne!(first_generation, second_generation);
    }

    #[test]
    fn application_shutdown_stops_the_process_without_restarting_it() -> () {
        let mut state = LifecycleState::new();
        let generation = state.start(101).expect("first start should succeed");

        assert_eq!(state.begin_shutdown(), Some(101));
        assert_eq!(state.terminated(generation), TerminationDisposition::Ignore);
        assert_eq!(state.running_pid(), None);
        assert_eq!(state.start(202), Err(LifecycleError::ShuttingDown));
    }
}
