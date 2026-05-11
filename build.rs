use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

const WASI_SDK_VERSION: &str = "25";
const WASI_SDK_TARBALL_URL: &str =
    "https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-25/wasi-sdk-25.0-x86_64-linux.tar.gz";

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-env-changed=WASI_SDK_PATH");
    println!("cargo:rerun-if-changed=src/tinybit/tinybit.h");
    // Watch all C source and header files in the submodule for changes
    println!("cargo:rerun-if-changed=src/tinybit");

    // Skip C compilation when building for a native host target (e.g. `cargo
    // test --target x86_64-unknown-linux-gnu`). The C engine only runs in the
    // wasm32 environment; the pure-Rust encoder sub-crate must be testable
    // without a WASI toolchain present.
    let target_arch = env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();
    if target_arch != "wasm32" {
        return;
    }

    let sdk = ensure_wasi_sdk();
    require_submodule();
    compile_c(&sdk);
}

fn require_submodule() {
    let header = PathBuf::from("src/tinybit/tinybit.h");
    if !header.exists() {
        panic!(
            "tinybit submodule missing at src/tinybit/. Run:\n\
             \tgit submodule update --init --recursive"
        );
    }
}

fn compile_c(sdk: &Path) {
    let sysroot = sdk.join("share").join("wasi-sysroot");
    let clang = sdk.join("bin").join("clang");
    let llvm_ar = sdk.join("bin").join("llvm-ar");

    let mut build = cc::Build::new();
    build
        .compiler(&clang)
        .archiver(&llvm_ar)
        .flag(&format!("--sysroot={}", sysroot.display()))
        .flag("--target=wasm32-wasi")
        // Lua uses setjmp/longjmp for error handling. wasi-sdk-25 normally compiles
        // these into JS-imported functions (env.setjmp/env.longjmp) which require a
        // host-side runtime. Pairing -fwasm-exceptions with -mllvm -wasm-enable-sjlj
        // makes clang lower setjmp/longjmp to native WASM EH instructions instead,
        // so the resulting module needs no JS-side sjlj shim.
        .flag("-fwasm-exceptions")
        .flag("-mllvm")
        .flag("-wasm-enable-sjlj")
        .define("_WASI_EMULATED_SIGNAL", None)
        // WASI lacks L_tmpnam; stub out lua_tmpnam to skip the ISO C block that references it
        .define("LUA_TMPNAMBUFSIZE", Some("256"))
        .define("lua_tmpnam(b,e)", Some("{ (void)(b); (e)=1; }"))
        .define("PNGLE_STATIC_ALLOC", None)
        .define("PNGLE_NO_GAMMA_CORRECTION", None)
        .define("MINIZ_NO_MALLOC", None)
        .include("src/tinybit")
        .include("src/tinybit/lua")
        .include("src/tinybit/pngle")
        .include("src/tinybit/ABC-parser")
        .warnings(false)
        .opt_level(2);

    let core_sources = [
        "tinybit.c",
        "lua_pool.c",
        "cartridge.c",
        "graphics.c",
        "font.c",
        "input.c",
        "audio.c",
        "memory.c",
        "lua_functions.c",
        "pngle/pngle.c",
        "pngle/miniz.c",
        "ABC-parser/abc_parser.c",
    ];
    for src in core_sources {
        build.file(format!("src/tinybit/{}", src));
    }

    let lua_dir = Path::new("src/tinybit/lua");
    for entry in std::fs::read_dir(lua_dir).expect("read lua dir") {
        let entry = entry.expect("lua dir entry");
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) == Some("c") {
            build.file(path);
        }
    }

    build.compile("tinybit");

    // Link wasi-sdk libraries that the C code depends on:
    //   * libsetjmp        — defines __wasm_setjmp/__wasm_longjmp emitted by
    //                        clang with -mllvm -wasm-enable-sjlj.
    //   * libwasi-emulated-process-clocks — provides clock() (Lua references it).
    //   * libwasi-emulated-signal         — provides signal stubs that match the
    //                        _WASI_EMULATED_SIGNAL define above.
    let lib_dir = sdk
        .join("share")
        .join("wasi-sysroot")
        .join("lib")
        .join("wasm32-wasip1");
    println!("cargo:rustc-link-search=native={}", lib_dir.display());
    println!("cargo:rustc-link-lib=static=setjmp");
    println!("cargo:rustc-link-lib=static=wasi-emulated-process-clocks");
    println!("cargo:rustc-link-lib=static=wasi-emulated-signal");
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
