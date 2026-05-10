use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

const WASI_SDK_VERSION: &str = "25";
const WASI_SDK_TARBALL_URL: &str =
    "https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-25/wasi-sdk-25.0-x86_64-linux.tar.gz";

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-env-changed=WASI_SDK_PATH");

    let _sdk = ensure_wasi_sdk();
    // Tasks 3 and 4 add C compilation and bindgen here.
}

fn ensure_wasi_sdk() -> PathBuf {
    if let Ok(p) = env::var("WASI_SDK_PATH") {
        let p = PathBuf::from(p);
        let clang = p.join("bin").join("clang");
        if !clang.exists() {
            panic!(
                "WASI_SDK_PATH={} does not contain bin/clang",
                p.display()
            );
        }
        return p;
    }

    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let sdk_dir = manifest.join("target").join("wasi-sdk");
    let clang = sdk_dir.join("bin").join("clang");

    if clang.exists() {
        return sdk_dir;
    }

    download_wasi_sdk(&sdk_dir);

    if !clang.exists() {
        panic!(
            "wasi-sdk download/extract did not produce {}",
            clang.display()
        );
    }
    sdk_dir
}

fn download_wasi_sdk(dest: &Path) {
    println!(
        "cargo:warning=Downloading wasi-sdk-{WASI_SDK_VERSION} to {} (one-time)",
        dest.display()
    );
    std::fs::create_dir_all(dest).expect("create wasi-sdk dir");

    let tarball = dest
        .parent()
        .expect("wasi-sdk dest parent")
        .join("wasi-sdk.tar.gz");

    let curl = Command::new("curl")
        .args([
            "-fL",
            "--retry",
            "3",
            "--retry-delay",
            "2",
            WASI_SDK_TARBALL_URL,
            "-o",
        ])
        .arg(&tarball)
        .status()
        .expect("invoke curl");
    if !curl.success() {
        panic!("curl failed to download wasi-sdk tarball");
    }

    let tar = Command::new("tar")
        .args(["-xzf"])
        .arg(&tarball)
        .args(["-C"])
        .arg(dest)
        .args(["--strip-components=1"])
        .status()
        .expect("invoke tar");
    if !tar.success() {
        panic!("tar failed to extract wasi-sdk");
    }

    let _ = std::fs::remove_file(&tarball);
}
