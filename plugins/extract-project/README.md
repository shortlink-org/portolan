# extract-project

The neutral baseline extractor. It describes a repository as one component in
one architecture group without requiring a domain model or a particular source
layout.

It reads only files already present in the checkout: `README.md`, language
package manifests, `Dockerfile`, Compose and Helm markers, and the runner files
(`Makefile`, `justfile`, `Taskfile.yml`, `package.json` scripts, poe and pdm
tasks in `pyproject.toml`, `pom.xml`, the Gradle script, cargo aliases and
xtask subcommands), whose entries become the component's commands. It does not execute
the project, resolve dependencies, import application code or write into the
input tree. Its response contains a catalog fragment named `project.json`;
the host decides where that file is written.

By default the group is a `system`. A repository with an executable or a
container definition becomes an `application`; otherwise it becomes a
`library`. Options can state more precise roles such as `team`, `worker`, `job`
or `cli`, and `technologies` when the manifests sit above the root, as for one
component of several in a repository. Language-specific domain extractors and
contract extractors can be run beside it: fragment merging fills in
aggregates, interfaces, channels and stores without duplicating the component.
