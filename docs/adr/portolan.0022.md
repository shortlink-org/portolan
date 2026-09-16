# portolan.0022 — The site toolchain is optional, and the image that needs it ships as its own tag

*Generated from the portolan catalog. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-09-16
- **Scope:** [portolan](../portolan/README.md)
- **Source:** [`adr/0022-the-site-toolchain-is-optional-and-ships-as-its-own-image-tag.md`](https://github.com/shortlink-org/portolan/blob/main/adr/0022-the-site-toolchain-is-optional-and-ships-as-its-own-image-tag.md)
- **Committed:** Victor Login, 2026-09-16 (`8cb3a3b`)

### Context and Problem Statement

`ghcr.io/shortlink-org/portolan:0.6.2` was 830 MB compressed, near 4 GB on
disk. A pipeline that runs `portolan check` on every merge request pulls that
image, and what it pulls is mostly things the command never opens: the full
Node image carries a C toolchain nothing here compiles with, the JDK carries
the tools to build a JDK, and `node_modules` carries vite, React, LikeC4,
mermaid and the icon sets the browsable site draws with.

Only `build` and `dev` load that last group. `generate`, `check`, `diff` and
`comment` read a workspace, run extractors and write fragments; between them
they need a JSON schema validator, a CEL evaluator, a TypeScript parser and an
EventBridge client. The package declared all of it as one dependency list, so
an image that only ever checks a catalog installed the site as well.

A plugin looked like the thing to move out, because plugins are what the image
is for. They are not what it weighs: the wasm module, the Rust binary and the
Java classes together are under 2% of the compressed image.

### Decision Drivers

- The command a pipeline runs on every merge request should pull as little as
  possible.
- A catalog is generated in a pipeline far more often than a site is built.
- What the image installs must be exactly what the commands in it run, and
  the ones it cannot serve must say so.
- A developer running `npm install` still gets every command, without
  remembering a flag.
- Nothing may be fetched from the network at run time that was not fetched at
  build time: a generated catalog is a build output, and a pipeline that
  reaches GitHub for a plugin is a pipeline that fails when GitHub does.

### Considered Options

- Download the plugins from GitHub releases on first use and ship none of
  them.
- Keep one image and trim only what is not a dependency: the base image and
  the JDK.
- Declare the site toolchain optional, publish the image without it, and
  publish a second tag that has it.

### Decision Outcome

Chosen: the site toolchain is optional, and the image that needs it is its own
tag.

`dependencies` holds what every command needs. `optionalDependencies` holds
vite, React, LikeC4 and what they draw with. An `npm install` still brings
both, because npm installs optional dependencies by default; only an
installation that opts out skips them, and the container image is the one that
does. Asked for a site it has not got, the CLI names what is missing and where
to get it rather than failing on a module it cannot resolve, and `portolan
doctor` reports the toolchain the way it reports Go, Python and Java.

The Dockerfile has two targets. `runtime` is published under the version tags
and holds what generate, check, diff and comment read. `site` is the same
image with the optional toolchain installed on top, published as `-site`, and
the GitLab Pages preset asks for that tag. Because one is a layer over the
other, a registry stores the difference once.

The image drops what it was carrying for nobody. The base is `node:24-slim`,
since no dependency is compiled and the compilers that are needed live in
build stages. The Java extractor reads sources through
`javax.tools.JavaCompiler`, so it keeps `jdk.compiler` - a JRE would not do -
but as a `jlink` runtime of that module and `java.base` alone rather than a
full JDK. Type declarations and source maps are deleted after install, and
`.dockerignore` mirrors the build output `.gitignore` keeps out of the
repository, so a developer's checkout does not put a local binary in the
image.

Downloading plugins was rejected on its own terms: it trades a run-time
network dependency for about 2% of the image. What is expensive about a plugin
is the toolchain it runs in, not the plugin.

#### Consequences

- Good: the tag a pipeline pulls on every merge request went from 830 MB to
  185 MB compressed, and the tag that builds a site to 319 MB.
- Good: the image installs what its commands run, and a command it cannot
  serve says which tag can.
- Good: nothing is fetched at run time that was not fetched at build time.
- Bad: two tags are published per release, and a Pages job that names the
  wrong one fails at `build` rather than at pull.
- Bad: `npm install --omit=optional` leaves an installation that cannot build
  a site, and the flag is one a user may pass for unrelated reasons.
- Neutral: `npm ci --omit=optional` cannot be used to produce the smaller
  tree, because it drops every optional dependency in the tree - including the
  platform bindings a native package declares that way, without which the
  TypeScript extractor does not load. The image removes the optional
  dependencies from `package.json` and installs from the lockfile instead.
