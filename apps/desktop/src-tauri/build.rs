use std::{
    env,
    error::Error,
    fs, io,
    path::{Path, PathBuf},
    process::Command,
};

fn main() -> Result<(), Box<dyn Error>> {
    build_capture_sidecar()?;
    tauri_build::build();
    Ok(())
}

fn build_capture_sidecar() -> Result<(), Box<dyn Error>> {
    let manifest_directory = PathBuf::from(env::var("CARGO_MANIFEST_DIR")?);
    let package_directory = manifest_directory.join("../../../poc/capture");
    let target = env::var("TARGET")?;
    let host = env::var("HOST")?;
    if target != host {
        return Err(io::Error::new(
            io::ErrorKind::Unsupported,
            format!(
                "capture sidecar cross-compilation is unsupported: host={host}, target={target}"
            ),
        )
        .into());
    }
    if env::var("CARGO_CFG_TARGET_OS")? != "macos" {
        return Err(
            io::Error::new(io::ErrorKind::Unsupported, "capture sidecar requires macOS").into(),
        );
    }

    println!(
        "cargo:rerun-if-changed={}",
        package_directory.join("Package.swift").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        package_directory.join("Sources").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        package_directory.join("RecognitionSources").display()
    );

    run_swift_build(&package_directory)?;
    let binary_directory = swift_binary_directory(&package_directory)?;
    let source = binary_directory.join("poke-capture-poc");
    if !source.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!(
                "Swift capture executable was not produced: {}",
                source.display()
            ),
        )
        .into());
    }

    let destination_directory = manifest_directory.join("binaries");
    fs::create_dir_all(&destination_directory)?;
    let destination = destination_directory.join(format!("poke-capture-{target}"));
    fs::copy(&source, &destination)?;
    Ok(())
}

fn run_swift_build(package_directory: &Path) -> Result<(), Box<dyn Error>> {
    let status = Command::new("swift")
        .arg("build")
        .arg("--package-path")
        .arg(package_directory)
        .arg("--configuration")
        .arg("release")
        .arg("--product")
        .arg("poke-capture-poc")
        .status()?;
    if !status.success() {
        return Err(
            io::Error::other(format!("Swift capture build failed with status {status}")).into(),
        );
    }
    Ok(())
}

fn swift_binary_directory(package_directory: &Path) -> Result<PathBuf, Box<dyn Error>> {
    let output = Command::new("swift")
        .arg("build")
        .arg("--package-path")
        .arg(package_directory)
        .arg("--configuration")
        .arg("release")
        .arg("--show-bin-path")
        .output()?;
    if !output.status.success() {
        return Err(io::Error::other(format!(
            "Swift binary path lookup failed with status {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        ))
        .into());
    }
    let path = String::from_utf8(output.stdout)?;
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Swift binary path lookup returned an empty path",
        )
        .into());
    }
    Ok(PathBuf::from(trimmed))
}
