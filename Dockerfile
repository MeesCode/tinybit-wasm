# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Stage 1: build the Rust crate to a wasm32-wasip1 module.
#
# build.rs auto-downloads wasi-sdk-25 (~150 MB) via curl + tar on first run,
# then drives cc-rs to compile the bundled C engine (the src/tinybit/ submodule
# must already be checked out on the host — it is COPYed in with src/).
# ---------------------------------------------------------------------------
FROM rust:1-bookworm AS wasm-builder

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates tar \
    && rm -rf /var/lib/apt/lists/*

# rust-toolchain.toml pins channel = stable + the wasm32-wasip1 target, so
# rustup auto-installs the target on first cargo invocation; add it explicitly
# too so a missing toolchain file never silently skips it.
RUN rustup target add wasm32-wasip1

WORKDIR /build

# lib.rs declares `extern "C" { fn js_gamecount(); fn js_gameload(); }` — these
# are host (browser) callbacks with no definition in the module. For the wasm
# target, undefined extern symbols must be emitted as WASM imports rather than
# treated as link errors, so tell rust-lld to import any undefined symbol.
# Scope the flag to the wasm target only: a global RUSTFLAGS would also reach
# the host-compiled build.rs and break its GNU-linker step.
ENV CARGO_TARGET_WASM32_WASIP1_RUSTFLAGS="-C link-args=--import-undefined"

COPY rust-toolchain.toml Cargo.toml Cargo.lock build.rs ./
COPY src/ ./src/
COPY assets/ ./assets/

RUN cargo build --target wasm32-wasip1 --release

# ---------------------------------------------------------------------------
# Stage 2: build the Vite/React editor and serve it.
#
# The `canvas` dev dependency compiles a native node addon, so the toolchain
# (build-essential/python3/pkg-config) and Cairo/Pango/JPEG/GIF/SVG headers
# must be present for `npm ci`.
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS editor-builder

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        python3 \
        pkg-config \
        libcairo2-dev \
        libpango1.0-dev \
        libjpeg-dev \
        libgif-dev \
        librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first so the (slow) npm ci layer is cached independently
# of editor source changes.
COPY editor/package.json editor/package-lock.json ./
RUN npm ci

COPY editor/ ./

# Drop in the freshly built wasm module so Vite bundles/serves it from public/.
COPY --from=wasm-builder /build/target/wasm32-wasip1/release/tinybit_wasm.wasm ./public/tinybit_wasm.wasm

RUN npm run build

EXPOSE 4173

# --host binds 0.0.0.0 so the preview server is reachable from outside the
# container; --port pins the published port.
CMD ["npm", "run", "preview", "--", "--host", "--port", "4173"]
