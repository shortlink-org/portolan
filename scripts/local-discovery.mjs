import {
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { basename, join, posix, relative, resolve, sep } from "node:path";

const SKIP = new Set([".git", ".portolan", "build", "dist", "node_modules", "target", "vendor"]);
const MAX_FILES = 12_000;
const MAX_COMPONENTS = 100;
const MAX_SOURCE_BYTES = 1024 * 1024;

function safeRoot(workspace, input) {
  if (typeof input !== "string" || !input.trim()) throw new Error("Project path is required.");
  const clean = input.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
  if (clean.startsWith("/") || clean.split("/").includes("..")) throw new Error("Project path must stay inside this repository.");
  const workspaceReal = realpathSync(workspace);
  const targetReal = realpathSync(resolve(workspaceReal, clean));
  if (targetReal !== workspaceReal && !targetReal.startsWith(`${workspaceReal}${sep}`)) {
    throw new Error("Project path resolves outside this repository.");
  }
  const root = relative(workspaceReal, targetReal).replaceAll(sep, "/") || ".";
  return { root, absolute: targetReal };
}

/** A UTF-8 source file inside the served workspace, never outside it. */
export function readLocalSource(workspace, input) {
  if (typeof input !== "string" || !input.trim()) throw new Error("Source path is required.");
  const clean = input.trim().replaceAll("\\", "/").replace(/^\.\//, "");
  if (clean.includes("\0") || clean.startsWith("/") || clean.split("/").includes("..")) {
    throw new Error("Source path must stay inside this repository.");
  }
  const workspaceReal = realpathSync(workspace);
  const targetReal = realpathSync(resolve(workspaceReal, clean));
  if (targetReal !== workspaceReal && !targetReal.startsWith(`${workspaceReal}${sep}`)) {
    throw new Error("Source path resolves outside this repository.");
  }
  const stat = statSync(targetReal);
  if (!stat.isFile()) throw new Error("Source path is not a file.");
  if (stat.size > MAX_SOURCE_BYTES) throw new Error("Source file is larger than the 1 MB preview limit.");
  const bytes = readFileSync(targetReal);
  if (bytes.includes(0)) throw new Error("Source file is binary.");
  let content;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Source file is not UTF-8 text.");
  }
  return {
    path: relative(workspaceReal, targetReal).replaceAll(sep, "/"),
    content,
  };
}

export function walk(root) {
  const files = new Set();
  const pending = [{ absolute: root, relative: "" }];
  while (pending.length && files.size < MAX_FILES) {
    const current = pending.pop();
    for (const entry of readdirSync(current.absolute, { withFileTypes: true })) {
      if (SKIP.has(entry.name) || (entry.isDirectory() && entry.name.startsWith("."))) continue;
      const name = current.relative ? `${current.relative}/${entry.name}` : entry.name;
      const absolute = join(current.absolute, entry.name);
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) pending.push({ absolute, relative: name });
      else if (stat.isFile()) files.add(name);
      if (files.size >= MAX_FILES) break;
    }
  }
  return files;
}

export function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function matches(files, pattern) {
  return [...files].filter((name) => pattern.test(name)).sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
}

function compactDirectories(paths) {
  const directories = [...new Set(paths.map((name) => posix.dirname(name)))].sort((a, b) => a.length - b.length);
  return directories.filter((dir, index) => !directories.some((parent, other) => other < index && (dir === parent || dir.startsWith(`${parent}/`))));
}

const COMPONENT_MARKERS = new Map([
  ["go.mod", "Go"],
  ["package.json", "Node.js"],
  ["Cargo.toml", "Rust"],
  ["pom.xml", "Java"],
  ["build.gradle", "Java"],
  ["build.gradle.kts", "Kotlin"],
  ["manage.py", "Django"],
]);

function componentCandidates(files) {
  const roots = new Map();
  for (const name of files) {
    const marker = posix.basename(name);
    const technology = COMPONENT_MARKERS.get(marker);
    if (!technology) continue;
    const path = posix.dirname(name);
    const key = path === "." ? "." : path;
    if (key.split("/").some((segment) => ["fixture", "fixtures", "test", "tests", "testdata"].includes(segment.toLowerCase()))) continue;
    const found = roots.get(key) ?? { path: key, markers: new Set(), technologies: new Set() };
    found.markers.add(marker);
    found.technologies.add(technology);
    roots.set(key, found);
  }
  return [...roots.values()]
    .sort((a, b) => a.path === "." ? -1 : b.path === "." ? 1 : a.path.localeCompare(b.path))
    .slice(0, MAX_COMPONENTS)
    .map((candidate) => {
      const base = candidate.path === "." ? "repository root" : posix.basename(candidate.path);
      return {
        path: candidate.path,
        name: base.split(/[^a-zA-Z0-9]+/).filter(Boolean).map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ") || base,
        markers: [...candidate.markers].sort(),
        technologies: [...candidate.technologies].sort(),
      };
    });
}

function titleFromSlug(value) {
  const acronyms = new Set(["api", "cli", "grpc", "http"]);
  return value.split(/[^a-zA-Z0-9]+/).filter(Boolean).map((part) => acronyms.has(part.toLowerCase()) ? part.toUpperCase() : part[0]?.toUpperCase() + part.slice(1)).join(" ") || value;
}

// cmd/* is a convention, not an architectural boundary by itself: many Go
// repositories keep migrations and administrative tools there. A runnable is
// promoted to a deployable only when build/deployment evidence independently
// names the same entrypoint.
function goDeployables(root, files) {
  if (!files.has("go.mod")) return [];
  const mains = new Map();
  for (const name of matches(files, /^cmd\/[^/]+\/[^/]+\.go$/)) {
    let source = "";
    try { source = readFileSync(join(root, name), "utf8"); } catch { continue; }
    if (!/^\s*package\s+main\b/m.test(source) || !/\bfunc\s+main\s*\(/.test(source)) continue;
    const component = name.split("/")[1];
    const found = mains.get(component) ?? [];
    found.push(name);
    mains.set(component, found);
  }

  const buildFiles = matches(files, /(^|\/)(?:Dockerfile|[^/]+\.Dockerfile|Makefile|[^/]*compose[^/]*\.ya?ml|[^/]+\.ya?ml)$/i);
  const out = [];
  for (const [component, entrypoints] of [...mains].sort(([a], [b]) => a.localeCompare(b))) {
    const escaped = component.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const target = new RegExp(`(?:^|[\\s"'=])(?:\\./)?cmd/${escaped}(?=$|[\\s"'])`, "m");
    const corroboration = [];
    for (const name of buildFiles) {
      let source = "";
      try { source = readFileSync(join(root, name), "utf8"); } catch { continue; }
      if (target.test(source)) corroboration.push(name);
    }
    out.push({
      slug: slug(component),
      name: titleFromSlug(component),
      path: `cmd/${component}`,
      kind: "service",
      confidence: corroboration.length ? "high" : "medium",
      evidence: [...entrypoints, ...corroboration],
    });
  }
  return out;
}

function detected(plugin, candidates, options = {}, label = candidates[0], ambiguous = false, selected = true, preview = []) {
  if (!candidates.length) return null;
  return {
    plugin,
    confidence: ambiguous && candidates.length > 1 ? "medium" : "high",
    evidence: label,
    candidates,
    options,
    selected,
    ...(preview.length ? { preview } : {}),
  };
}

const ADR_STATUSES = new Map([
  ["proposed", "proposed"], ["draft", "proposed"], ["pending", "proposed"], ["на рассмотрении", "proposed"],
  ["accepted", "accepted"], ["approved", "accepted"], ["adopted", "accepted"], ["принято", "accepted"], ["принят", "accepted"],
  ["superseded", "superseded"], ["заменено", "superseded"], ["заменён", "superseded"],
  ["deprecated", "deprecated"], ["obsolete", "deprecated"], ["устарело", "deprecated"],
  ["rejected", "rejected"], ["declined", "rejected"], ["отклонено", "rejected"],
]);

function normalizedAdrStatus(value) {
  return ADR_STATUSES.get(value.trim().replace(/[.:]+$/, "").toLowerCase()) ?? "";
}

// Discovery mirrors the tolerant shapes accepted by extract-adr closely
// enough to enable the capability with confidence and to show what it found.
// Git-backed dates are resolved by the extractor, so a format without an
// explicit Date can still be previewed here without inventing one.
function adrPreview(root, name) {
  let source = "";
  try { source = readFileSync(join(root, name), "utf8").replaceAll("\r\n", "\n"); } catch { return null; }
  const lines = source.split("\n");
  const heading = lines.find((line) => line.trim()) ?? "";
  const base = posix.basename(name, ".md");
  const numberedFile = /^(\d+)-([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(base);

  let number = "";
  let title = "";
  let match = /^#\s+[a-z][a-z0-9.-]*\.(\d{4})\s+—\s+(.+?)\s*$/i.exec(heading);
  if (match) [number, title] = match.slice(1);
  else if ((match = /^#\s+(\d+)\.\s+(.+?)\s*$/.exec(heading))) [number, title] = match.slice(1);
  else if ((match = /^#\s+ADR[-\s]?0*(\d+)\s*[.:—-]\s*(.+?)\s*$/i.exec(heading))) [number, title] = match.slice(1);
  else if (numberedFile && (match = /^#\s+(.+?)\s*$/.exec(heading))) {
    number = numberedFile[1];
    title = match[1];
  }
  if (!number || !title || !numberedFile || Number(numberedFile[1]) !== Number(number)) return null;
  if (!lines.some((line) => /^#{2,6}\s/.test(line))) return null;

  let status = "";
  const bullet = /^-\s+\*\*Status:\*\*\s*(.*?)\s*$/mi.exec(source);
  if (bullet) status = normalizedAdrStatus(bullet[1]);
  if (!status) {
    const at = lines.findIndex((line) => /^#{2,6}\s+(?:Status|Статус)\s*:?/i.test(line));
    if (at >= 0) {
      const inline = /^#{2,6}\s+(?:Status|Статус)\s*:?\s*(.*?)\s*$/i.exec(lines[at])?.[1] ?? "";
      const following = lines.slice(at + 1).find((line) => line.trim() && !/^#{1,6}\s/.test(line)) ?? "";
      status = normalizedAdrStatus(inline || following);
    }
  }
  if (!status) return null;

  const writtenDate = /^(?:-\s+\*\*Date:\*\*|Date:)\s*(\S.*?)\s*$/mi.exec(source)?.[1];
  if (writtenDate) {
    const stamp = new Date(`${writtenDate}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(writtenDate) || Number.isNaN(stamp.getTime()) || stamp.toISOString().slice(0, 10) !== writtenDate) return null;
  }
  const date = writtenDate ?? "from git history";
  return {
    file: name,
    fields: { number: String(Number(number)), title: title.trim(), status, date },
  };
}

function compatibleAdrs(root, candidates) {
  return candidates.map((name) => adrPreview(root, name)).filter(Boolean);
}

function goDomainEvidence(root, files) {
  const layout = /^internal\/(?:domain\/([^/]+)|([^/]+)\/domain)\/[^/]+\.go$/i;
  const candidates = matches(files, layout);
  for (const name of candidates) {
    const match = layout.exec(name);
    if (!match) continue;
    const aggregate = match[1] ?? match[2];
    const packageName = aggregate.replace(/[^a-zA-Z0-9_]/g, "_");
    const rootName = aggregate
      .split(/[^a-zA-Z0-9]+|_/)
      .filter(Boolean)
      .map((part) => part[0]?.toUpperCase() + part.slice(1))
      .join("");
    let source = "";
    try { source = readFileSync(join(root, name), "utf8"); } catch { continue; }
    const packagePattern = new RegExp(`\\bpackage\\s+(?:${packageName}|domain)\\b`);
    const rootPattern = new RegExp(`\\btype\\s+${rootName}\\s+struct\\s*\\{`);
    if (packagePattern.test(source) && rootPattern.test(source)) return name;
  }
  return "";
}

// This is a discovery hint; the Go AST extractor proves the handler binding.
function goHTTPServerEvidence(root, files) {
  for (const name of matches(files, /\.go$/).filter((name) => !/(?:_test|\.gen|_generated)\.go$/.test(name) && !/(?:^|\/)(?:testdata|vendor)\//.test(name))) {
    let source;
    try { source = readFileSync(join(root, name), "utf8"); } catch { continue; }
    if (/Code generated .*DO NOT EDIT/.test(source)) continue;
    if (/"net\/http"/.test(source) && /\.Handle(?:Func)?\s*\(/.test(source)) return name;
    if (/"github\.com\/(?:go-chi\/chi|gin-gonic\/gin|labstack\/echo)(?:\/v\d+)?"/.test(source) && /\.(?:Get|Post|Put|Patch|Delete|GET|POST|PUT|PATCH|DELETE)\s*\(/.test(source)) return name;
  }
  return "";
}

function laidOutDomainEvidence(root, files, language) {
  const extension = language === "typescript" ? "ts" : language === "rust" ? "rs" : "java";
  const prefix = language === "java" ? /(?:^|\/)domain\/([^/]+)\/[^/]+\.java$/i : /^src\/domain\/([^/]+)\/[^/]+\.(?:ts|rs)$/i;
  for (const name of matches(files, prefix)) {
    if (!name.endsWith(`.${extension}`)) continue;
    const match = prefix.exec(name);
    if (!match) continue;
    const rootName = match[1].split(/[^a-zA-Z0-9]+|_/).filter(Boolean).map((part) => part[0]?.toUpperCase() + part.slice(1)).join("");
    let source = "";
    try { source = readFileSync(join(root, name), "utf8"); } catch { continue; }
    const claim = language === "typescript"
      ? new RegExp(`\\b(?:export\\s+)?class\\s+${rootName}\\b`)
      : language === "rust"
        ? new RegExp(`\\bpub\\s+struct\\s+${rootName}\\b`)
        : /@AggregateRoot\b/.test(source) || new RegExp(`\\bclass\\s+${rootName}\\b`).test(source);
    if (claim instanceof RegExp ? claim.test(source) : claim) return name;
  }
  return "";
}

function goHTTPClientEvidence(root, files) {
  for (const name of matches(files, /\.go$/).filter((name) => !name.endsWith("_test.go"))) {
    let source = "";
    try { source = readFileSync(join(root, name), "utf8"); } catch { continue; }
    if (
      /\bhttp\.(?:NewRequest(?:WithContext)?|Get|Post|PostForm|Head)\s*\(/.test(source)
      || /ClientWithResponses(?:Interface)?\b/.test(source)
      || /github\.com\/hooklift\/gowsdl\/soap/.test(source)
    ) return name;
  }
  return "";
}

function goSOAPClientEvidence(root, files) {
  for (const name of matches(files, /\.go$/).filter((name) => !name.endsWith("_test.go"))) {
    let source = "";
    try { source = readFileSync(join(root, name), "utf8"); } catch { continue; }
    if (
      /github\.com\/hooklift\/gowsdl\/soap/.test(source)
      || /\bCallContext\s*\([^,]+,\s*[^,]*(?:soap)?action/i.test(source)
      || /(?:Header\.)?(?:Add|Set)\s*\(\s*["'](?:SOAPAction|Content-Type)["']/i.test(source)
    ) return name;
  }
  return "";
}

function goRedisEvidence(root, files) {
  const redisImport = /github\.com\/(?:redis\/go-redis(?:\/v\d+)?|go-redis\/redis(?:\/v\d+)?|redis\/rueidis|gomodule\/redigo\/redis)(?=\")/g;
  for (const name of matches(files, /\.go$/).filter((name) => !name.endsWith("_test.go"))) {
    let source = "";
    try { source = readFileSync(join(root, name), "utf8"); } catch { continue; }
    const imports = [...source.matchAll(redisImport)].map((match) => match[0]);
    if (!imports.length) continue;

    const aliases = new Set();
    for (const importPath of imports) {
      const escaped = importPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const declaration = new RegExp(`(?:^|\\n)\\s*(?:import\\s+)?(?:([A-Za-z_][A-Za-z0-9_]*)\\s+)?\"${escaped}\"`, "m").exec(source);
      const alias = declaration?.[1];
      if (alias && alias !== "_" && alias !== ".") aliases.add(alias);
      else aliases.add(importPath.includes("rueidis") ? "rueidis" : "redis");
    }
    if ([...aliases].some((alias) => new RegExp(`\\b${alias}\\.(?:NewClient|NewClusterClient|NewFailoverClient|NewFailoverClusterClient|Dial|DialURL)\\s*\\(`).test(source))) {
      return name;
    }
  }
  return "";
}

function detectionsFor(root, files) {
  let goMod = "";
  if (files.has("go.mod")) {
    try { goMod = readFileSync(join(root, "go.mod"), "utf8"); } catch {}
  }
  const openapi = matches(files, /(^|\/)(openapi|swagger)[^/]*\.(ya?ml|json)$/i);
  const wsdls = matches(files, /\.wsdl$/i);
  const asyncapi = matches(files, /(^|\/)asyncapi[^/]*\.(ya?ml|json)$/i);
  const graphql = matches(files, /\.graphqls?$/i);
  const protos = matches(files, /\.proto$/i);
  const sql = matches(files, /(^|\/)(migrations?|repository)(\/|.*\/).*\.sql$/i);
  const adrs = matches(files, /(^|\/)(docs\/adr|adr)\/.*\.md$/i).filter((name) => posix.basename(name).toLowerCase() !== "readme.md");
  const adrPreviews = compatibleAdrs(root, adrs);
  const supportedAdrs = adrPreviews.map((item) => item.file);
  const glossaries = matches(files, /(^|\/)glossary\.md$/i);
  // The app module is the one file a Celery project always has; the tasks
  // and the calls that enqueue them are found from there.
  const celery = matches(files, /(^|\/)celery\.py$/);
  const sqlRoots = [...new Set(sql.map((name) => {
    const segments = name.split("/");
    const repository = segments.findIndex((part) => /^(repository|repositories)$/i.test(part));
    return repository >= 0 ? segments.slice(0, repository + 1).join("/") : "";
  }).filter(Boolean))];
  const featureSql = sqlRoots.some((name) => /^internal\/[^/]+\/infrastructure\/repository$/i.test(name));
  const sqlRoot = sqlRoots.length === 1 && !featureSql ? sqlRoots[0] : "";
  const graphqlDirs = compactDirectories(graphql);
  const protoDirs = compactDirectories(protos);
  const projectMarkers = ["go.mod", "package.json", "Cargo.toml", "pom.xml", "build.gradle", "build.gradle.kts", "manage.py", "Dockerfile", "README.md"].filter((name) => files.has(name));
  const projectEvidence = projectMarkers.length ? projectMarkers : [[...files].sort()[0]].filter(Boolean);
  const goDomain = files.has("go.mod") ? goDomainEvidence(root, files) || goHTTPServerEvidence(root, files) : "";
  const goHTTPClient = files.has("go.mod") ? goHTTPClientEvidence(root, files) : "";
  const goSOAPClient = files.has("go.mod") ? goSOAPClientEvidence(root, files) : "";
  const goRedis = files.has("go.mod") ? goRedisEvidence(root, files) : "";
  const tsDomain = files.has("package.json") ? laidOutDomainEvidence(root, files, "typescript") : "";
  const rustDomain = files.has("Cargo.toml") ? laidOutDomainEvidence(root, files, "rust") : "";
  const javaDomain = ["pom.xml", "build.gradle", "build.gradle.kts"].some((name) => files.has(name)) ? laidOutDomainEvidence(root, files, "java") : "";
  // A Laravel application keeps its Eloquent models under app/Models, or
  // under each package's src/Models when it is built from packages.
  const laravelDomain = files.has("composer.json") ? matches(files, /^(?:app|packages\/[^/]+\/[^/]+\/src)\/Models\/[^/]+\.php$/)[0] ?? "" : "";
  // A PHP tree laid out by bounded context keeps each module's model under
  // src/<Context>/<Module>/Domain, with Shared beside the contexts.
  const phpDdd = files.has("composer.json") ? matches(files, /^src\/(?!Shared\/)[^/]+\/(?!Shared\/)[^/]+\/Domain\/[^/]+\.php$/)[0] ?? "" : "";
  // A .NET tree laid out by module keeps each module's model under
  // src/Modules/<Module>/Domain, with the HTTP host under src/API.
  const csharpDdd = matches(files, /^src\/Modules\/[^/]+\/Domain\/.+\.cs$/)[0] ?? "";
  return [
    detected("project", projectEvidence, {}, projectEvidence.join(", ")),
    detected("go-domain", goDomain ? [goDomain] : [], {}, goDomain),
    detected("ts-domain", tsDomain ? [tsDomain] : [], {}, tsDomain),
    detected("rust-domain", rustDomain ? [rustDomain] : [], {}, rustDomain),
    detected("java-domain", javaDomain ? [javaDomain] : [], {}, javaDomain),
    detected("django-domain", files.has("manage.py") && matches(files, /(^|\/)models(?:\/[^/]+)?\.py$/i).length ? ["manage.py"] : []),
    detected("laravel-domain", laravelDomain ? [laravelDomain] : [], {}, laravelDomain),
    detected("php-ddd", phpDdd ? [phpDdd] : [], {}, phpDdd),
    detected("csharp-ddd", csharpDdd ? [csharpDdd] : [], {}, csharpDdd),
    detected("celery", celery, {}, celery[0]),
    detected("openapi", openapi, openapi[0] ? { spec: openapi[0] } : {}, openapi[0], true),
    detected(
      "wsdl",
      wsdls,
      {
        ...(wsdls.length === 1 ? { spec: wsdls[0] } : {}),
        ...(goSOAPClient ? { mode: "external" } : {}),
      },
      wsdls.length === 1 ? wsdls[0] : `${wsdls.length} WSDL documents`,
      true,
    ),
    detected("http-clients", goHTTPClient ? [goHTTPClient] : [], {}, goHTTPClient),
    detected("redis", goRedis ? [goRedis] : [], {}, goRedis),
    detected("river", goMod.includes("github.com/riverqueue/river") ? ["go.mod"] : [], {}, "go.mod · github.com/riverqueue/river"),
    detected("watermill", goMod.includes("github.com/ThreeDotsLabs/watermill") ? ["go.mod"] : [], {}, "go.mod · github.com/ThreeDotsLabs/watermill"),
    detected("asyncapi", asyncapi, asyncapi[0] ? { spec: asyncapi[0] } : {}, asyncapi[0], true),
    detected("graphql", graphql, graphqlDirs[0] ? { schema: graphqlDirs.length === 1 ? graphqlDirs[0] : graphql[0] } : {}, graphqlDirs.length === 1 ? graphqlDirs[0] : graphql[0]),
    detected("proto", protos, protoDirs.length ? { paths: protoDirs } : {}, protoDirs.join(", ")),
    detected("sql", sql, sqlRoot ? { repositories: sqlRoot } : {}, sqlRoot || (sqlRoots.length > 1 ? `${sqlRoots.length} repository packages` : sql[0])),
    detected(
      "adr",
      adrs,
      supportedAdrs[0] ? { files: [`${posix.dirname(supportedAdrs[0])}/*.md`] } : {},
      supportedAdrs[0] ? `${posix.dirname(supportedAdrs[0])}/*.md` : `${posix.dirname(adrs[0] ?? "docs/adr/x.md")}/*.md (format not recognized)`,
      !supportedAdrs.length,
      supportedAdrs.length > 0,
      adrPreviews,
    ),
    detected("glossary", glossaries, glossaries.length ? { files: glossaries } : {}, glossaries.join(", ")),
  ].filter(Boolean);
}

export function discoverProject(workspace, input) {
  const { root, absolute } = safeRoot(workspace, input);
  const files = walk(absolute);
  const detections = detectionsFor(absolute, files);
  const components = componentCandidates(files);
  const deployables = goDeployables(absolute, files);
  return {
    root,
    filesScanned: files.size,
    truncated: files.size >= MAX_FILES,
    components,
    componentsTruncated: components.length >= MAX_COMPONENTS,
    deployables,
    defaults: projectDefaults(basename(absolute)),
    detections,
  };
}

export function projectDefaults(value) {
  const id = slug(value) || "service";
  return { id, name: id.split("-").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" "), group: id, component: id, context: id, service: id };
}
