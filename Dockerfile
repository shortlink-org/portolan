# syntax=docker/dockerfile:1.27

# Node supplies the CLI/runtime; the Go base supplies the most common source
# extractor. Trixie provides Java 21, Python 3 and Cargo for the remaining
# built-in process plugins.
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
    && npm link \
    && cargo build --release --manifest-path plugins/extract-rust/Cargo.toml

RUN useradd --create-home --uid 10001 portolan

ENV HOME=/home/portolan \
    GOCACHE=/tmp/portolan-go-cache \
    CARGO_HOME=/tmp/portolan-cargo

WORKDIR /workspace
USER portolan

ENTRYPOINT ["portolan"]
CMD ["--help"]
