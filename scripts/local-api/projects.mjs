// A project in the manifest: the plan an added one gets, the manifest with
// it and without it, the writes that apply them, and the undo kept a while.

import { createHash, randomUUID } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix, resolve, sep } from "node:path";

import { readManifestText } from "../manifest.mjs";
import { builtinPluginNames } from "../builtin-plugins.mjs";
import { discoverProject, matches, slug, walk } from "../local-discovery.mjs";
import { cleanSourcePath, externalProjectDefaults, inspectionRoot, repositoryParts } from "./repositories.mjs";
import { lstatExists } from "./workspace.mjs";
import { writeManifest } from "./manifest-file.mjs";

const removalUndos = new Map();

function pluginOptions(plugin, project, detectedOptions = {}) {
  const group = project.group ?? project.context;
  const component = project.component ?? project.service;
  const common = { context: group, service: component };
  if (plugin === "project") {
    return {
      group,
      ...(component ? { component } : {}),
      ...detectedOptions,
      componentName: project.name,
      ...(project.groupKind ? { groupKind: project.groupKind } : {}),
      ...(project.componentKind ? { componentKind: project.componentKind } : {}),
      ...(project.repository ? { repo: repositoryParts(project.repository).web } : {}),
      out: "project.json",
    };
  }
  if (plugin === "php-ddd" || plugin === "csharp-ddd") {
    // The tree names its own contexts and services; the manifest only says
    // where the code lives and how core it is.
    return {
      ...(project.repository ? { repo: repositoryParts(project.repository).web } : {}),
      ...(detectedOptions?.classification ? { classification: detectedOptions.classification } : {}),
      out: "domain.json",
    };
  }
  if (["go-domain", "ts-domain", "rust-domain", "java-domain", "django-domain", "laravel-domain"].includes(plugin)) {
    return { ...common, ...(project.repository ? { repo: repositoryParts(project.repository).web } : {}), ...detectedOptions, serviceName: project.name, out: "domain.json" };
  }
  if (plugin === "sql") return { ...common, store: "pg", ...detectedOptions, out: "stores.json" };
  if (plugin === "redis") return { ...common, store: "redis", ...detectedOptions, out: "redis.json" };
  if (plugin === "openapi") return { ...common, ...detectedOptions, out: "api.json" };
  if (plugin === "wsdl") return { ...common, ...detectedOptions, out: "wsdl.json" };
  if (plugin === "http-clients") return { ...common, ...detectedOptions, out: "http-clients.json" };
  if (plugin === "deployment-values") return { ...common, ...detectedOptions, out: "deployment-values.json" };
  if (plugin === "river") return { ...common, ...detectedOptions, out: "river.json" };
  if (plugin === "watermill") return { ...common, ...detectedOptions, out: "watermill.json" };
  if (plugin === "asyncapi") return { ...common, ...detectedOptions, out: "bus.json" };
  if (plugin === "celery") return { ...common, ...detectedOptions, out: "celery.json" };
  if (plugin === "graphql") return { ...common, ...detectedOptions, out: "graphql.json" };
  if (plugin === "proto") return { ...common, ...detectedOptions, out: "proto.json" };
  if (plugin === "glossary") return { context: group, ...detectedOptions, out: "glossary.json" };
  if (plugin === "adr") return { scope: [group, component].filter(Boolean).join(".") || "org", ...detectedOptions, out: "adr.json" };
  if (plugin === "rfc") return {
    scope: [group, component].filter(Boolean).join(".") || "org",
    ...(project.repository ? { repo: repositoryParts(project.repository).web } : {}),
    ...detectedOptions,
    out: "rfc.json",
  };
  if (plugin === "sdd") return { ...detectedOptions, out: "sdd.json" };
  return {};
}

function deployableProtoPaths(paths, deployable) {
  const prefixes = [`internal/${deployable.slug}/`, `cmd/${deployable.slug}/`, `services/${deployable.slug}/`];
  return (paths ?? []).filter((path) => prefixes.some((prefix) => `${path}/`.startsWith(prefix)));
}

function deployableProtoPeers(root, files, deployables, context) {
  const peers = new Map();
  const ambiguous = new Set();
  for (const name of matches(files, /\.proto$/i)) {
    const owner = deployables.find((candidate) =>
      name.startsWith(`internal/${candidate.slug}/`) || name.startsWith(`cmd/${candidate.slug}/`) || name.startsWith(`services/${candidate.slug}/`),
    );
    if (!owner) continue;
    let source = "";
    try { source = readFileSync(join(root, name), "utf8"); } catch { continue; }
    const packageName = /(?:^|[;\n])\s*package\s+([A-Za-z_][A-Za-z0-9_.]*)\s*;/m.exec(source)?.[1];
    if (!packageName || ambiguous.has(packageName)) continue;
    const service = `${context}.${owner.slug}`;
    const existing = peers.get(packageName);
    if (existing && existing !== service) {
      peers.delete(packageName);
      ambiguous.add(packageName);
    } else {
      peers.set(packageName, service);
    }
  }
  return Object.fromEntries([...peers].sort(([a], [b]) => a.localeCompare(b)));
}

function relativeToDeployable(paths, deployable) {
  if (!deployable.path) return paths ?? [];
  const prefix = `${deployable.path}/`;
  return (paths ?? []).filter((path) => path.startsWith(prefix)).map((path) => path.slice(prefix.length));
}

function compactDirectories(paths) {
  const directories = [...new Set((paths ?? []).map((name) => posix.dirname(name)))]
    .sort((a, b) => a.length - b.length || a.localeCompare(b));
  return directories.filter((directory, index) => !directories.some((parent, parentIndex) =>
    parentIndex < index && (directory === parent || directory.startsWith(`${parent}/`)),
  ));
}

function titleFromId(value) {
  return value.split(/[-_]+/).filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
}

function cargoProtoLayout(root, files, deployables, context) {
  const rust = deployables.filter((deployable) => deployable.technology === "Rust" && deployable.path);
  const peers = new Map();
  const ambiguous = new Set();
  const paths = new Map();
  const externals = [];
  for (const owner of rust) {
    const prefix = `${owner.path}/`;
    const protoFiles = matches(files, /\.proto$/i).filter((name) => name.startsWith(prefix));
    const rustFiles = matches(files, /\.rs$/).filter((name) => name.startsWith(`${prefix}src/`));
    let source = "";
    const sources = [];
    for (const name of rustFiles) {
      try {
        const text = readFileSync(join(root, name), "utf8");
        source += `\n${text}`;
        sources.push([name, text]);
      } catch {}
    }
    const parsed = protoFiles.map((name) => {
      let text = "";
      try { text = readFileSync(join(root, name), "utf8"); } catch {}
      const packageName = /(?:^|[;\n])\s*package\s+([A-Za-z_][A-Za-z0-9_.]*)\s*;/m.exec(text)?.[1] ?? "";
      const services = [...text.matchAll(/\bservice\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/g)].map((match) => match[1]);
      return { name, packageName, services };
    });
    const ownedPackages = new Set();
    for (const file of parsed) {
      const owns = file.services.some((service) => {
        const escaped = service.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`\\b${escaped}Server\\b`).test(source)
          || new RegExp(`\\bimpl(?:\\s*<[^>]+>)?\\s+${escaped}\\s+for\\b`).test(source);
      });
      if (owns && file.packageName) {
        ownedPackages.add(file.packageName);
        const service = `${context}.${owner.slug}`;
        const existing = peers.get(file.packageName);
        if (existing && existing !== service) {
          peers.delete(file.packageName);
          ambiguous.add(file.packageName);
        } else if (!ambiguous.has(file.packageName)) {
          peers.set(file.packageName, service);
        }
      }
    }
    const ownedFiles = parsed
      .filter((file) => file.packageName && ownedPackages.has(file.packageName))
      .map((file) => file.name.slice(prefix.length));
    paths.set(owner.slug, compactDirectories(ownedFiles));
    for (const packageName of [...new Set(parsed.map((file) => file.packageName).filter(Boolean))]) {
      if (ownedPackages.has(packageName)) continue;
      const packageFiles = parsed.filter((file) => file.packageName === packageName);
      const clientFile = sources.find(([, text]) => packageFiles.some((file) => file.services.some((service) => {
        const escaped = service.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`\\b${escaped}Client\\b`).test(text);
      })));
      if (!clientFile) continue;
      const adapter = posix.basename(clientFile[0], posix.extname(clientFile[0]));
      const fallback = packageName.split(".")[0];
      const external = slug(["client", "mod", "lib", "main"].includes(adapter) ? fallback : adapter);
      if (!external) continue;
      const adapterType = /\b(?:pub\s+)?struct\s+([A-Z][A-Za-z0-9_]*)Adapter\b/.exec(clientFile[1])?.[1];
      peers.set(packageName, external);
      externals.push({
        owner,
        packageName,
        external,
        externalName: adapterType ? adapterType.replace(/Db\b/g, "DB") : titleFromId(external),
        paths: compactDirectories(packageFiles.map((file) => file.name.slice(prefix.length))),
      });
    }
  }
  return {
    peers: Object.fromEntries([...peers].sort(([a], [b]) => a.localeCompare(b))),
    paths,
    externals: externals.sort((a, b) => a.owner.slug.localeCompare(b.owner.slug) || a.external.localeCompare(b.external)),
  };
}

function goModule(root) {
  try {
    const match = /^\s*module\s+(\S+)/m.exec(readFileSync(join(root, "go.mod"), "utf8"));
    return match?.[1] ?? "";
  } catch { return ""; }
}

function deployableEvidenceOwners(root, files, deployables, evidence) {
  const module = goModule(root);
  if (!module) return [];
  const evidenceDirs = [...new Set((evidence ?? []).flatMap((name) => {
    const parts = posix.dirname(name).split("/");
    const out = [];
    while (parts.length > 1) { out.push(parts.join("/")); parts.pop(); }
    return out;
  }))];
  return deployables.filter((deployable) => {
    if ((evidence ?? []).some((name) => name.startsWith(`internal/${deployable.slug}/`) || name.startsWith(`cmd/${deployable.slug}/`))) return true;
    const scoped = [...files].filter((name) =>
      name.endsWith(".go") && (
        name.startsWith(`cmd/${deployable.slug}/`) ||
        name.startsWith(`internal/${deployable.slug}/`) ||
        name === `internal/di/${deployable.slug}.go`
      ),
    );
    return scoped.some((name) => {
      let source = "";
      try { source = readFileSync(join(root, name), "utf8"); } catch { return false; }
      return evidenceDirs.some((dir) => source.includes(`"${module}/${dir}"`));
    });
  });
}

export function planProject(workspace, manifest, request) {
  const external = request.source === "external";
  const repo = external ? repositoryParts(request.repository) : null;
  const sourcePath = external ? cleanSourcePath(request.sourcePath) : "";
  if (external && !/^[0-9a-f]{40}$/i.test(String(request.commit ?? ""))) throw new Error("Inspect the repository to resolve an immutable commit first.");
  const inspectedRoot = external ? inspectionRoot(repo.value, String(request.commit), sourcePath) : request.root;
  const discovered = discoverProject(workspace, inspectedRoot);
  const discovery = external ? { ...discovered, defaults: externalProjectDefaults(repo.value, sourcePath) } : discovered;
  const confirmedDeployables = discovery.deployables.filter((candidate) => candidate.confidence === "high");
  const declared = new Set([
    ...builtinPluginNames(),
    ...(manifest.plugins ?? []).map((plugin) => plugin.name),
  ]);
  const detected = new Set(discovery.detections.map((item) => item.plugin));
  const plannedRoot = external
    ? ["vendor", "repos", repo.owner, repo.name, sourcePath].filter(Boolean).join("/")
    : discovery.root;
  const requested = Array.isArray(request.plugins) ? [...request.plugins] : [];
  const explicitSdd = (manifest.extract ?? []).some(
    (step) => step.plugin === "sdd" && step.in === plannedRoot,
  );
  if (!explicitSdd && discovery.detections.some((item) => item.plugin === "sdd" && item.selected)) {
    requested.push("sdd");
  }
  const plugins = [...new Set(requested)].filter((plugin) => detected.has(plugin) && declared.has(plugin));
  if (plugins.length === 0) throw new Error("Select at least one detected plugin that is declared in portolan.json.");
  const id = slug(String(request.id ?? ""));
  if (!id) throw new Error("Project id must contain letters or numbers.");
  if ((manifest.projects ?? []).some((project) => project.id === id)) throw new Error(`Project id "${id}" already exists.`);
  const finalRoot = plannedRoot;
  if ((manifest.projects ?? []).some((project) => project.root === finalRoot)) throw new Error(`Project path "${finalRoot}" already exists.`);
  const requestedComponent = slug(String(request.component ?? request.service ?? ""));
  const requestedDeployable = confirmedDeployables.some((candidate) => candidate.slug === requestedComponent);
  const splitDeployables = confirmedDeployables.length > 1 && !requestedDeployable;
  const project = {
    id,
    name: String(request.name ?? "").trim() || discovery.defaults.name,
    root: finalRoot,
    ...(String(request.group ?? request.context ?? "").trim() ? { group: slug(String(request.group ?? request.context)) } : {}),
    ...(!splitDeployables && String(request.component ?? request.service ?? "").trim() ? { component: requestedComponent } : {}),
    ...(String(request.groupKind ?? "").trim() ? { groupKind: String(request.groupKind).trim() } : {}),
    ...(!splitDeployables && String(request.componentKind ?? "").trim() ? { componentKind: String(request.componentKind).trim() } : {}),
    ...(splitDeployables ? { components: confirmedDeployables.map((candidate) => candidate.slug) } : {}),
    ...(String(request.repository ?? "").trim() ? { repository: String(request.repository).trim() } : {}),
  };
  const out = posix.join(finalRoot, "portolan");
  const detectionByPlugin = new Map(discovery.detections.map((item) => [item.plugin, item]));
  const hasDomainModel = plugins.some((plugin) => ["go-domain", "ts-domain", "rust-domain", "java-domain", "django-domain", "laravel-domain", "php-ddd", "csharp-ddd"].includes(plugin));
  const projectDetectionOptions = {
    groupKind: splitDeployables ? "system" : hasDomainModel ? "bounded-context" : "system",
    ...(hasDomainModel ? { componentKind: "service" } : {}),
    ...(String(request.contextName ?? "").trim() ? { groupName: String(request.contextName).trim() } : {}),
    ...(String(request.contextSummary ?? "").trim() ? { groupSummary: String(request.contextSummary).trim() } : {}),
    ...(String(request.classification ?? "").trim() ? { classification: String(request.classification).trim() } : {}),
    ...(splitDeployables ? { components: confirmedDeployables.map(({ slug, name, kind }) => ({ slug, name, kind })) } : {}),
  };
  const domainDetectionOptions = (plugin) => ({
    ...detectionByPlugin.get(plugin)?.options,
    ...(String(request.contextName ?? "").trim() ? { contextName: String(request.contextName).trim() } : {}),
    ...(String(request.contextSummary ?? "").trim() ? { contextSummary: String(request.contextSummary).trim() } : {}),
    ...(String(request.classification ?? "").trim() ? { classification: String(request.classification).trim() } : {}),
  });
  const rootAbsolute = resolve(workspace, inspectedRoot);
  const rootFiles = splitDeployables ? walk(rootAbsolute) : new Set();
  const protoPeers = splitDeployables ? deployableProtoPeers(rootAbsolute, rootFiles, confirmedDeployables, project.group ?? project.context ?? id) : {};
  const cargoLayout = splitDeployables
    ? cargoProtoLayout(rootAbsolute, rootFiles, confirmedDeployables, project.group ?? project.context ?? id)
    : { peers: {}, paths: new Map(), externals: [] };
  const inferredPeers = { ...protoPeers, ...cargoLayout.peers };
  const redisOwners = splitDeployables
    ? new Set(deployableEvidenceOwners(rootAbsolute, rootFiles, confirmedDeployables, detectionByPlugin.get("redis")?.candidates).map((owner) => owner.slug))
    : new Set();
  const steps = plugins.flatMap((plugin) => {
    if (!splitDeployables) {
      const options = plugin === "project"
        ? projectDetectionOptions
        : ["go-domain", "ts-domain", "rust-domain", "java-domain", "django-domain", "laravel-domain", "php-ddd", "csharp-ddd"].includes(plugin)
          ? domainDetectionOptions(plugin)
          : detectionByPlugin.get(plugin)?.options;
      return [{ plugin, in: finalRoot, out, options: pluginOptions(plugin, project, options) }];
    }
    if (plugin === "project") {
      return [{ plugin, in: finalRoot, out, options: pluginOptions(plugin, project, projectDetectionOptions) }];
    }
    if (["adr", "rfc", "sdd", "glossary"].includes(plugin)) {
      return [{ plugin, in: finalRoot, out, options: pluginOptions(plugin, project, detectionByPlugin.get(plugin)?.options) }];
    }
    const detectedOptions = detectionByPlugin.get(plugin)?.options ?? {};
    let owners = confirmedDeployables;
    if (plugin === "proto") owners = confirmedDeployables.filter((candidate) =>
      candidate.technology === "Rust"
        ? (cargoLayout.paths.get(candidate.slug)?.length ?? 0) > 0
        : deployableProtoPaths(detectedOptions.paths, candidate).length > 0,
    );
    else if (plugin === "redis") owners = deployableEvidenceOwners(rootAbsolute, rootFiles, confirmedDeployables, detectionByPlugin.get(plugin)?.candidates);
    else if (plugin === "go-domain") owners = confirmedDeployables.filter((candidate) => candidate.technology !== "Rust");
    else if (plugin === "rust-domain") owners = confirmedDeployables.filter((candidate) => candidate.technology === "Rust");
    else if (plugin === "graphql") owners = confirmedDeployables.filter((candidate) =>
      relativeToDeployable(detectionByPlugin.get(plugin)?.candidates, candidate).length > 0,
    );
    else owners = confirmedDeployables.slice(0, 1);
    return owners.map((owner) => {
      const scopedProject = { ...project, component: owner.slug, componentKind: owner.kind, name: owner.name };
      const scopedOptions = plugin === "proto"
        ? {
            ...detectedOptions,
            paths: owner.technology === "Rust" ? cargoLayout.paths.get(owner.slug) : deployableProtoPaths(detectedOptions.paths, owner),
            ...(Object.keys(inferredPeers).length ? { peers: inferredPeers } : {}),
          }
        : plugin === "go-domain"
          ? { ...detectedOptions, scope: owner.slug, ...(Object.keys(inferredPeers).length ? { peers: inferredPeers } : {}), ...(redisOwners.has(owner.slug) ? { store: "redis" } : {}) }
          : plugin === "rust-domain"
            ? { ...detectedOptions, ...(Object.keys(inferredPeers).length ? { peers: inferredPeers } : {}) }
            : plugin === "graphql"
              ? (() => {
                  const schemas = relativeToDeployable(detectionByPlugin.get(plugin)?.candidates, owner);
                  const directories = compactDirectories(schemas);
                  return { ...detectedOptions, schema: directories.length === 1 ? directories[0] : schemas[0] };
                })()
              : detectedOptions;
      const componentRoot = owner.path ? posix.join(finalRoot, owner.path) : finalRoot;
      return {
        plugin,
        in: componentRoot,
        out,
        options: { ...pluginOptions(plugin, scopedProject, scopedOptions), out: `${plugin}-${owner.slug}.json` },
      };
    });
  });
  if (splitDeployables && plugins.includes("proto")) {
    for (const external of cargoLayout.externals) {
      steps.push({
        plugin: "proto",
        in: posix.join(finalRoot, external.owner.path),
        out,
        options: {
          paths: external.paths,
          external: external.external,
          externalName: external.externalName,
          out: `proto-${external.owner.slug}-${external.external}.json`,
        },
      });
    }
  }
  const source = external ? "vendor/repos/**/portolan/*.json" : `${out}/*.json`;
  const fetch = external ? { repo: repo.value, commit: String(request.commit), ...(sourcePath ? { paths: [sourcePath] } : {}) } : null;
  return { project, plugins, steps, source, discovery, fetch };
}

/**
 * One entry per repository and commit. Two projects from one repository at one
 * commit share a fetch: their paths are joined, and an entry that asked for the
 * whole tree keeps it.
 */
export function mergeRepos(repos) {
  const merged = [];
  for (const repo of repos) {
    const key = `${repo.repo}\0${repo.commit ?? ""}\0${repo.ref ?? ""}`;
    const held = merged.find((candidate) => `${candidate.repo}\0${candidate.commit ?? ""}\0${candidate.ref ?? ""}` === key);
    if (!held) {
      merged.push({ ...repo });
      continue;
    }
    const whole = !held.paths?.length || !repo.paths?.length;
    if (whole) delete held.paths;
    else held.paths = [...new Set([...held.paths, ...repo.paths])].sort();
  }
  return merged;
}

export function manifestWithProject(manifest, plan, { isolated = false } = {}) {
  const fetchIndex = (manifest.extract ?? []).findIndex((step) => step.plugin === "git");
  const extract = isolated ? [] : [...(manifest.extract ?? [])];
  if (plan.fetch) {
    if (!builtinPluginNames().has("git") && !manifest.plugins?.some((plugin) => plugin.name === "git")) throw new Error("The built-in git fetcher is not available.");
    if (!isolated && fetchIndex >= 0) {
      const fetchStep = extract[fetchIndex];
      const repos = mergeRepos([...(fetchStep.options?.repos ?? []), plan.fetch]);
      extract[fetchIndex] = { ...fetchStep, options: { ...fetchStep.options, repos } };
    } else {
      extract.unshift({ plugin: "git", in: "vendor", out: "vendor/repos", options: { cache: "vendor/repos", repos: [plan.fetch] } });
    }
  }
  extract.push(...plan.steps);
  const emptyStarterSources = !isolated
    && (manifest.projects ?? []).length === 0
    && (manifest.extract ?? []).length === 0
    && (manifest.sources ?? []).length === 1
    && manifest.sources[0] === "portolan/*.json";
  const targetCatalog = manifest.defaultCatalog ?? manifest.catalogs?.[0]?.id;
  const catalogs = !isolated && manifest.catalogs
    ? manifest.catalogs.map((catalog) => catalog.id === targetCatalog ? {
        ...catalog,
        sources: [...new Set([...catalog.sources, ...(plan.fetch ? ["vendor/repos/*/*/git.repo.json"] : []), plan.source])],
        contexts: [...new Set([...catalog.contexts, plan.project.group ?? plan.project.context].filter(Boolean))],
        projects: [...new Set([...catalog.projects, plan.project.id])],
      } : catalog)
    : manifest.catalogs;
  return {
    ...manifest,
    projects: isolated ? [plan.project] : [...(manifest.projects ?? []), plan.project],
    sources: isolated
      ? [...(plan.fetch ? ["vendor/repos/*/*/git.repo.json"] : []), plan.source]
      : [...new Set([...(emptyStarterSources ? [] : (manifest.sources ?? [])), ...(plan.fetch ? ["vendor/repos/*/*/git.repo.json"] : []), plan.source])],
    extract,
    ...(catalogs ? { catalogs } : {}),
    ...(isolated ? { verify: [], generate: [] } : {}),
  };
}

/**
 * Remove one project's complete catalog slice while leaving neighbouring
 * projects and shared estate inputs intact. A single placeholder source is
 * retained when the workspace becomes empty because `sources` is the one
 * required manifest field; the next added project replaces that placeholder.
 */
export function manifestWithoutProject(manifest, projectId) {
  const id = String(projectId ?? "").trim();
  const project = (manifest.projects ?? []).find((candidate) => candidate.id === id);
  if (!project) throw new Error(`Project "${id}" does not exist.`);

  const projects = (manifest.projects ?? []).filter((candidate) => candidate.id !== id);
  const projectOut = posix.join(project.root, "portolan");
  const projectSource = `${projectOut}/*.json`;
  const projectGroup = project.group ?? project.context;
  const groupStillUsed = projectGroup && projects.some((candidate) => (candidate.group ?? candidate.context) === projectGroup);
  const belongsToProject = (step) => step?.out === projectOut;
  const extract = (manifest.extract ?? []).filter((step) => !belongsToProject(step));
  const verify = (manifest.verify ?? []).filter((step) => !belongsToProject(step));
  let sources = (manifest.sources ?? []).filter((source) => source !== projectSource);
  if (sources.length === 0) sources = ["portolan/*.json"];

  const removedCatalogs = [];
  const catalogs = (manifest.catalogs ?? []).flatMap((catalog) => {
    const affected = catalog.projects.includes(id) || catalog.sources.includes(projectSource);
    if (!affected) return [catalog];
    const next = {
      ...catalog,
      sources: catalog.sources.filter((source) => source !== projectSource),
      contexts: projectGroup && !groupStillUsed ? catalog.contexts.filter((context) => context !== projectGroup) : catalog.contexts,
      projects: catalog.projects.filter((candidate) => candidate !== id),
    };
    if (next.sources.length > 0 && next.contexts.length > 0) return [next];
    removedCatalogs.push(catalog.id);
    return [];
  });
  const generate = (manifest.generate ?? []).filter((step) => !removedCatalogs.includes(step.catalog));
  const removedOutputs = [
    ...new Set((manifest.generate ?? [])
      .filter((step) => removedCatalogs.includes(step.catalog) || (!(manifest.catalogs ?? []).length && (manifest.projects ?? []).length === 1))
      .map((step) => step.out)
      .filter(Boolean)),
  ];

  const next = { ...manifest, projects, sources, extract, verify, generate };
  if (manifest.catalogs) {
    if (catalogs.length > 0) next.catalogs = catalogs;
    else delete next.catalogs;
  }
  if (removedCatalogs.includes(manifest.defaultCatalog)) {
    if (catalogs[0]) next.defaultCatalog = catalogs[0].id;
    else delete next.defaultCatalog;
  }
  return { manifest: next, project, projectOut, removedOutputs };
}

export function starterManifestProject(manifest) {
  if ((manifest.projects ?? []).length !== 1) return null;
  const project = manifest.projects[0];
  if (project.root !== "." || project.groupKind || project.componentKind) return null;
  const output = posix.join(project.root, "portolan");
  const steps = (manifest.extract ?? []).filter((step) => step.out === output);
  return steps.length === 1 && steps[0]?.plugin === "project" ? project : null;
}

export function projectRequestPlan(workspace, manifest, request) {
  const starter = request.replaceStarter ? starterManifestProject(manifest) : null;
  const base = starter ? manifestWithoutProject(manifest, starter.id).manifest : manifest;
  const plan = planProject(workspace, base, request);
  return { base, plan, starter };
}

export function writeProject(workspace, request) {
  const manifestPath = join(workspace, "portolan.json");
  const before = readFileSync(manifestPath, "utf8");
  const manifest = readManifestText(before, manifestPath);
  const { base, plan, starter } = projectRequestPlan(workspace, manifest, request);
  writeManifest(manifestPath, manifestWithProject(base, plan));
  const undoToken = rememberManifestUndo(workspace, before, readFileSync(manifestPath, "utf8"));
  return { ...plan, ...(starter ? { replacedProject: starter } : {}), undoToken };
}

export function rememberManifestUndo(workspace, before, after) {
  const undoToken = randomUUID();
  removalUndos.set(undoToken, {
    workspace: realpathSync(workspace),
    before,
    afterSha256: createHash("sha256").update(after).digest("hex"),
    expiresAt: Date.now() + 15 * 60 * 1000,
  });
  return undoToken;
}

function backupGeneratedSlice(workspace, output) {
  const root = resolve(workspace);
  const target = resolve(root, output);
  if (target === root || !target.startsWith(`${root}${sep}`)) throw new Error(`Generated output "${output}" resolves outside this repository.`);
  if (!lstatExists(target)) return null;
  const holder = mkdtempSync(join(tmpdir(), "portolan-undo-"));
  const backup = join(holder, "slice");
  cpSync(target, backup, { recursive: true });
  return { target, holder, backup };
}

export function removeProject(workspace, projectId) {
  const manifestPath = join(workspace, "portolan.json");
  const before = readFileSync(manifestPath, "utf8");
  const manifest = readManifestText(before, manifestPath);
  const result = manifestWithoutProject(manifest, projectId);
  const generated = backupGeneratedSlice(workspace, result.projectOut);
  try {
    writeManifest(manifestPath, result.manifest);
    if (generated) rmSync(generated.target, { recursive: true, force: true });
  } catch (cause) {
    writeManifest(manifestPath, manifest);
    if (generated) {
      rmSync(generated.target, { recursive: true, force: true });
      mkdirSync(dirname(generated.target), { recursive: true });
      cpSync(generated.backup, generated.target, { recursive: true });
      rmSync(generated.holder, { recursive: true, force: true });
    }
    throw cause;
  }
  const after = readFileSync(manifestPath, "utf8");
  const undoToken = rememberManifestUndo(workspace, before, after);
  removalUndos.get(undoToken).generated = generated;
  return { project: result.project, removedOutputs: result.removedOutputs, undoToken };
}

export function undoProjectRemoval(workspace, undoToken) {
  const undo = removalUndos.get(String(undoToken ?? ""));
  if (!undo || undo.expiresAt < Date.now() || undo.workspace !== realpathSync(workspace)) throw new Error("This removal can no longer be undone.");
  const manifestPath = join(workspace, "portolan.json");
  const current = readFileSync(manifestPath, "utf8");
  if (createHash("sha256").update(current).digest("hex") !== undo.afterSha256) throw new Error("portolan.json changed after the removal; undo would overwrite newer work.");
  const manifest = readManifestText(undo.before, manifestPath);
  writeManifest(manifestPath, manifest);
  if (undo.generated) {
    rmSync(undo.generated.target, { recursive: true, force: true });
    mkdirSync(dirname(undo.generated.target), { recursive: true });
    cpSync(undo.generated.backup, undo.generated.target, { recursive: true });
    rmSync(undo.generated.holder, { recursive: true, force: true });
  }
  removalUndos.delete(String(undoToken));
  return { restored: true };
}
