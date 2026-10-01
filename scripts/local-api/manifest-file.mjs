// Writes to portolan.json that are not about one project: the writer that
// keeps the file's shape, the aggregate roots a Django extractor asked for,
// and the problem rules.

import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { loadManifest, readManifest, readManifestText } from "../manifest.mjs";
import { formatLike } from "../json-format.mjs";
import { djangoAggregateCandidates } from "../../src/lib/django-aggregates.mjs";

/**
 * Writes the manifest in the style the file already has: an unchanged
 * subtree is copied byte for byte, a changed array keeps the shape its old
 * self had, so that what the page changed is what the diff shows.
 */
export function writeManifest(path, manifest) {
  let before = "";
  try { before = readFileSync(path, "utf8"); } catch {}
  const text = before.trim() ? formatLike(before.replace(/\n$/, ""), manifest) : JSON.stringify(manifest, null, 2);
  const staging = mkdtempSync(join(dirname(path), ".portolan-manifest-"));
  const temp = join(staging, "portolan.json");
  try {
    writeFileSync(temp, `${text}\n`, { flag: "wx" });
    const validation = loadManifest(temp);
    if (validation.problems.length) throw new Error(validation.problems.join("\n"));
    renameSync(temp, path);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

export function djangoAggregateProposals(workspace) {
  const path = join(workspace, "portolan.json");
  const text = readFileSync(path, "utf8");
  const manifest = readManifestText(text, path);
  const revision = createHash("sha256").update(text).digest("hex");
  let report;
  try { report = JSON.parse(readFileSync(join(workspace, ".portolan/build-report.json"), "utf8")); } catch {}
  const proposals = [];
  for (const step of report?.steps ?? []) {
    if (step.phase !== "extract") continue;
    const matches = (manifest.extract ?? []).map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.plugin === step.plugin && entry.in === step.input && entry.out === step.output);
    if (matches.length !== 1) continue;
    const { entry, index } = matches[0];
    for (const message of step.warnings ?? []) {
      const candidates = djangoAggregateCandidates(message);
      if (!candidates) continue;
      const id = `${index}:${candidates.app}`;
      if (proposals.some((proposal) => proposal.id === id)) continue;
      proposals.push({ id, step: index, plugin: entry.plugin, input: entry.in, output: entry.out, message, ...candidates });
    }
  }
  return { revision, stale: !report || report.manifestSha256 !== revision || report.status === "running", proposals };
}

export function saveDjangoAggregates(workspace, request) {
  const current = djangoAggregateProposals(workspace);
  if (current.stale || request.revision !== current.revision) {
    throw new Error("The manifest or extraction report has changed. Regenerate and review the candidates again.");
  }
  if (!Array.isArray(request.selections) || !request.selections.length) throw new Error("Choose at least one aggregate root.");
  const manifest = readManifest(join(workspace, "portolan.json"));
  const seen = new Set();
  for (const choice of request.selections) {
    const proposal = current.proposals.find((candidate) => candidate.id === choice?.id);
    if (!proposal || !proposal.models.some((model) => model.name === choice.model) || seen.has(choice.id)) {
      throw new Error("Choose one of the reported models for each application.");
    }
    seen.add(choice.id);
    const step = manifest.extract[proposal.step];
    step.options = { ...step.options, aggregates: { ...step.options?.aggregates, [proposal.app]: choice.model } };
  }
  writeManifest(join(workspace, "portolan.json"), manifest);
  return { saved: request.selections.length };
}

/**
 * The manifest's `problemRules` as written, with a revision of the whole file:
 * a save quotes it, so two pages editing the rules cannot overwrite each
 * other, and neither can a hand edit made while the page was open.
 */
export function problemRulesState(workspace) {
  const path = join(workspace, "portolan.json");
  const text = readFileSync(path, "utf8");
  const manifest = readManifestText(text, path);
  return {
    revision: createHash("sha256").update(text).digest("hex"),
    rules: Array.isArray(manifest.problemRules) ? manifest.problemRules : [],
  };
}

/**
 * Replaces `problemRules`. The expressions are type-checked and the shape is
 * checked against the schema by writeManifest, through the same loader gen
 * uses, so a rule the page accepts is a rule gen accepts.
 */
export function saveProblemRules(workspace, request) {
  const current = problemRulesState(workspace);
  if (request?.revision !== current.revision) {
    throw new Error("portolan.json has changed since the rules were read. Reload the page and try again.");
  }
  if (!Array.isArray(request.rules)) throw new Error("rules must be an array.");
  const path = join(workspace, "portolan.json");
  const manifest = readManifest(path);
  if (request.rules.length) manifest.problemRules = request.rules;
  else delete manifest.problemRules;
  writeManifest(path, manifest);
  return problemRulesState(workspace);
}
