// Generates likec4/ sources from the merged catalog.
//
// Everything LikeC4 renders is DECLARED here: the C4 views — the estate at
// level 1, its containers at level 2 as one picture and one per context, two
// per service — and a full dynamic view per flow, plus a bounded-context
// crossings view when crossings exist. Nothing in the app draws these pictures itself.
//
//   node scripts/gen-likec4.mjs

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { loadCatalog } from "./catalog-sources.mjs";
import { catalogProfiles } from "../src/catalog-profile.ts";
import { catalogIds } from "./gen-likec4/ids.mjs";
import { contextColorNameFor, specificationSource } from "./gen-likec4/specification.mjs";
import { collectParticipants } from "./gen-likec4/participants.mjs";
import { emitModel } from "./gen-likec4/model.mjs";
import { containerHelpers } from "./gen-likec4/containers.mjs";
import { flowSteps, flowViews } from "./gen-likec4/flows.mjs";
import { labelHelpers } from "./gen-likec4/labels.mjs";
import { estateViews } from "./gen-likec4/estate-views.mjs";
import { contextViews } from "./gen-likec4/context-views.mjs";
import { deploymentSource } from "./gen-likec4/deployment.mjs";
import { writeLikeC4Sources } from "./gen-likec4/write.mjs";

// Every source, not one file: a service that publishes its own facts gets a
// C4 view like any other, and generating from a single file would leave it out
// of the pictures while the rest of the app knows about it.
//
// The sources come back as files rather than being written here, so that
// `gen` can settle them the way it settles every generated page - written,
// or in check mode compared and reported as drift - and `likec4:gen` can
// still write them on its own before the dev server starts.
/**
 * The LikeC4 sources of the estate (portolan.0034). A manifest with catalog
 * profiles gets one LikeC4 project per profile, in a directory of its own
 * with a likec4.config.json naming it: two estates may each have a `payments`
 * context or a `bus`, and one model would make them one. Only the profiles
 * whose sources the top-level `sources` also match are drawn - the ones the
 * site can load; a showcase kept outside them is drawn where it is staged.
 * A manifest without profiles keeps its single unnamed model.
 *
 * `loadProfile(profile)` is the profile's own merged catalog and its sources,
 * as loadCatalog answers them; without it, or without profiles, the one model
 * is drawn from `catalog`.
 */
export async function likec4Sources({ catalog, manifest, sources = [], loadProfile }) {
  const declared = manifest?.catalogs ?? [];
  if (declared.length === 0 || !loadProfile) return modelSources({ catalog, manifest });
  const top = new Set(sources.map((source) => source.path));
  const files = [];
  for (const profile of declared) {
    const loaded = await loadProfile(profile);
    if (!loaded.sources.every((source) => top.has(source.path))) continue;
    const model = await modelSources({ catalog: loaded.catalog, manifest: { ...manifest, catalogs: [profile] } });
    files.push({ name: `${profile.id}/likec4.config.json`, contents: `${JSON.stringify({ name: profile.id, title: profile.title ?? profile.id }, null, 2)}\n` });
    for (const file of model) files.push({ ...file, name: `${profile.id}/${file.name}` });
  }
  return files;
}

/** One LikeC4 model: the estate `catalog` describes, and a view pair per profile `manifest` names. */
async function modelSources({ catalog, manifest }) {
  const profiles = catalogProfiles(manifest);
  // Each stage under gen-likec4/ reads what the ones before it settled and
  // hands back what the next ones need, through one bag: the closure the
  // generator used to be, in the order it ran.
  const g = { catalog, profiles, ...catalogIds(catalog), contextColorName: contextColorNameFor(catalog) };
  Object.assign(g, collectParticipants(g));
  const spec = specificationSource();
  Object.assign(g, emitModel(g));
  const { model } = g;
  Object.assign(g, containerHelpers(g));

  // ---------------------------------------------------------------------------
  // views
  // ---------------------------------------------------------------------------
  Object.assign(g, flowSteps(g));

  const views = [];
  views.push("views {");
  g.views = views;
  Object.assign(g, labelHelpers(g));
  Object.assign(g, estateViews(g));
  contextViews(g);
  flowViews(g);
  const { deployment } = deploymentSource(g);
  views.push("}");

  return [
    { name: "deployment.c4", contents: `// GENERATED — do not edit.\n${deployment.join("\n")}\n` },
    { name: "spec.c4", contents: `${spec.join("\n")}\n` },
    { name: "model.c4", contents: `// GENERATED — do not edit.\n${model.join("\n")}\n` },
    { name: "views.c4", contents: `// GENERATED — do not edit.\n${views.join("\n")}\n` },
  ];
}

// Run as a script - `npm run likec4:gen`, before the dev server starts - the
// sources are written under likec4/ here and now.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const bundle = await loadCatalog();
  const files = await likec4Sources({
    ...bundle,
    loadProfile: (profile) => loadCatalog("portolan.json", { profile: profile.id }),
  });
  writeLikeC4Sources(files);
}
