# syntax=docker/dockerfile:1.27

# Two published targets. `runtime` is the default and holds what generate,
# check, diff, and comment need; `site` adds the optional toolchain that only
# build and dev load, and ships as the `-site` tag.
#
# Node is the runtime. Go and Rust appear only in build stages: every built-in
# Go plugin is one wasm module (portolan.0006) and the fetchers run inside the
# host (portolan.0008), so nothing runs `go` once the image is built. Java is
# linked down to the modules its extractor needs, and the Rust extractor
# arrives as a binary built in its own stage.
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

# The Java extractor reads sources through javax.tools.JavaCompiler, so it
# needs jdk.compiler at run time and a plain JRE would not do. jlink writes a
# runtime holding those modules alone, a sixth of what the full JDK installs.
# Linked on the runtime's own base so its binaries match that glibc.
FROM node:24-trixie-slim AS java-builder

# binutils: Debian's jlink shells out to objcopy to strip the native launchers.
RUN apt-get update \
    && apt-get install -y --no-install-recommends binutils openjdk-21-jdk-headless \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/portolan
COPY plugins/extract-java plugins/extract-java
RUN javac --release 21 -d plugins/extract-java/build plugins/extract-java/src/org/portolan/extract/*.java \
    && jlink --add-modules java.base,java.compiler,jdk.compiler,jdk.zipfs \
       --strip-debug --no-header-files --no-man-pages --compress=zip-6 \
       --output /opt/java

# Slim rather than the full Node image: a C toolchain is what the difference
# buys, no dependency here is compiled, and the toolchains that are needed
# come from the stages above. Trixie still provides Python 3 for the
# extractors that run in it, and git dates every source (portolan.0010).
FROM node:24-trixie-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git python3 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=java-builder /opt/java /opt/java
ENV PATH="/opt/java/bin:${PATH}"

WORKDIR /opt/portolan

COPY package.json package-lock.json ./
# Required dependencies only. The site toolchain - vite, React, LikeC4 and
# everything they draw with - is optional, and an image that generates,
# checks and diffs a catalog never loads it; `portolan build` says so when
# asked for a site instead of failing on a missing module. The download cache
# and the type declarations would otherwise sit in this layer beside what it
# installed, and nothing here is ever type checked.
RUN node -e "const f='package.json',p=require('/opt/portolan/'+f);delete p.optionalDependencies;require('fs').writeFileSync(f,JSON.stringify(p,null,2))" \
    && npm install --omit=dev --no-audit --no-fund \
    && npm cache clean --force \
    && find node_modules \( -name '*.map' -o -name '*.d.ts' -o -name '*.d.mts' -o -name '*.d.cts' \) -delete

COPY . .
COPY --from=wasm-builder /out/portolan-go.wasm plugins/portolan-go.wasm
COPY --from=rust-builder /opt/portolan/plugins/extract-rust/target/release/portolan-extract-rust \
    plugins/extract-rust/target/release/portolan-extract-rust
COPY --from=java-builder /opt/portolan/plugins/extract-java/build plugins/extract-java/build

# `npm link` rather than a symlink would reify the global tree against the
# package.json restored just above, and pull in the optional site toolchain.
RUN ln -s /opt/portolan/cli/portolan.mjs /usr/local/bin/portolan

RUN useradd --create-home --uid 10001 portolan

ENV HOME=/home/portolan

WORKDIR /workspace
USER portolan

ENTRYPOINT ["portolan"]
CMD ["--help"]

# The site toolchain, on top of the tag that does without it, so a registry
# stores the difference once. `COPY . .` above restored the package.json that
# still declares these, so npm knows what is missing.
FROM runtime AS site

USER root
WORKDIR /opt/portolan
RUN npm install --omit=dev --no-audit --no-fund \
    && npm cache clean --force \
    && find node_modules \( -name '*.map' -o -name '*.d.ts' -o -name '*.d.mts' -o -name '*.d.cts' \) -delete

WORKDIR /workspace
USER portolan

# Last, so `docker build .` without a target gives the published default
# rather than the larger site image above.
FROM runtime AS default
