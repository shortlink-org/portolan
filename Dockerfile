# syntax=docker/dockerfile:1.27

# Node supplies the CLI/runtime. Go is here only to build plugins/portolan-go.wasm
# (every built-in Go plugin runs as that module, portolan.0006); nothing runs
# `go` afterwards. Trixie provides Java 21, Python 3 and Cargo for the
# extractors that still run in their own toolchains.
FROM rust:1.98.0-trixie AS rust-builder

WORKDIR /opt/portolan
COPY plugins/extract-rust plugins/extract-rust
RUN cargo build --release --manifest-path plugins/extract-rust/Cargo.toml

FROM node:24-trixie AS node

FROM golang:1.27-trixie

COPY --from=node /usr/local/ /usr/local/

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates cargo git openjdk-21-jdk-headless python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/portolan

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run plugins:build \
    && npm link

COPY --from=rust-builder /opt/portolan/plugins/extract-rust/target/release/portolan-extract-rust \
    /opt/portolan/plugins/extract-rust/target/release/portolan-extract-rust

RUN useradd --create-home --uid 10001 portolan

ENV HOME=/home/portolan \
    GOCACHE=/tmp/portolan-go-cache \
    CARGO_HOME=/tmp/portolan-cargo

WORKDIR /workspace
USER portolan

ENTRYPOINT ["portolan"]
CMD ["--help"]
