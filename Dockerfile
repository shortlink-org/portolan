# syntax=docker/dockerfile:1.27

# Node is the runtime. Go and Rust appear only in build stages: every built-in
# Go plugin is one wasm module (portolan.0006) and the fetchers run inside the
# host (portolan.0008), so nothing runs `go` once the image is built. Trixie
# provides Java 21 and Python 3 for the extractors that still run in their own
# toolchains; the Rust extractor arrives as a binary built in its own stage.
FROM rust:1.98.1-trixie AS rust-builder

WORKDIR /opt/portolan
COPY plugins/extract-rust plugins/extract-rust
RUN cargo build --release --manifest-path plugins/extract-rust/Cargo.toml

FROM golang:1.27-trixie AS wasm-builder

WORKDIR /opt/portolan
COPY go.mod go.sum ./
RUN go mod download
COPY catalog catalog
COPY plugin plugin
COPY internal internal
COPY render render
COPY plugins plugins
RUN GOOS=wasip1 GOARCH=wasm go build -trimpath -ldflags="-s -w" -o /out/portolan-go.wasm ./plugins/cmd/portolan-go

FROM node:24-trixie

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git openjdk-21-jdk-headless python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/portolan

COPY package.json package-lock.json ./
# Runtime dependencies only: the site is built with vite from `dependencies`,
# and the type checker and test runner have no work to do in an image. The
# download cache would otherwise sit in this layer beside what it installed.
RUN npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force

COPY . .
COPY --from=wasm-builder /out/portolan-go.wasm plugins/portolan-go.wasm
COPY --from=rust-builder /opt/portolan/plugins/extract-rust/target/release/portolan-extract-rust \
    plugins/extract-rust/target/release/portolan-extract-rust
RUN javac --release 21 -d plugins/extract-java/build plugins/extract-java/src/org/portolan/extract/*.java \
    && npm link

RUN useradd --create-home --uid 10001 portolan

ENV HOME=/home/portolan

WORKDIR /workspace
USER portolan

ENTRYPOINT ["portolan"]
CMD ["--help"]
