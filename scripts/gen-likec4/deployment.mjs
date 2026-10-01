// Where the services run: the deployment block, one view per environment
// and one per deployed service.

import { deploymentViewId, q, safeId, serviceDeployViewId } from "./ids.mjs";
import { allDeployments, deploys, environmentOf } from "../../src/catalog-model.ts";

// ---------------------------------------------------------------------------
// deployment: where the services run (portolan.0012)
// ---------------------------------------------------------------------------
// One tree per environment, the cluster and the namespace as frames inside
// it, and an instance of the service in the namespace it stands in. The
// relations are the model's own: LikeC4 draws between two instances what the
// model declares between their elements, so an environment's picture shows
// the calls both ends of which are deployed there, and nothing a reader
// would have to fold by hand. One view per environment, and one per service
// that runs somewhere: its instances with the frames around them.
/** The deployment lines, with the deployment views pushed onto `views`. */
export function deploymentSource(g) {
  const { catalog, fqn, views, allServices } = g;
  const deployment = [];
  const deployTree = new Map(); // environment -> cluster -> namespace -> Map(service id -> {service, deployment})
  const placesOfService = new Map(); // service id -> [fqn of instance]
  const framesOfEnvironment = new Map(); // environment -> Set(fqn of every node under it)
  for (const placed of allDeployments(catalog)) {
    for (const service of allServices) {
      if (!deploys(placed, service)) continue;
      const env = environmentOf(placed);
      const clusters = deployTree.get(env) ?? new Map();
      deployTree.set(env, clusters);
      const namespaces = clusters.get(placed.cluster) ?? new Map();
      clusters.set(placed.cluster, namespaces);
      const instances = namespaces.get(placed.namespace) ?? new Map();
      namespaces.set(placed.namespace, instances);
      // Two Applications of one service in one place is one instance: the
      // picture is about where it runs, and it runs there once.
      if (!instances.has(service.id)) instances.set(service.id, { service, deployment: placed });
    }
  }
  const environments = [...deployTree.keys()].sort();
  const sorted = (map) => [...map.keys()].sort();
  if (environments.length > 0) {
    deployment.push("deployment {");
    for (const env of environments) {
      const envId = safeId(env);
      deployment.push(`  environment ${envId} ${q(env)} {`);
      const clusters = deployTree.get(env);
      for (const cluster of sorted(clusters)) {
        const path = [envId];
        let indent = "    ";
        if (cluster) {
          path.push(safeId(cluster));
          deployment.push(`${indent}cluster ${safeId(cluster)} ${q(cluster)} {`);
          indent += "  ";
        }
        const namespaces = clusters.get(cluster);
        for (const namespace of sorted(namespaces)) {
          const nsPath = [...path];
          let nsIndent = indent;
          if (namespace) {
            nsPath.push(safeId(namespace));
            deployment.push(`${nsIndent}namespace ${safeId(namespace)} ${q(namespace)} {`);
            nsIndent += "  ";
          }
          const instances = namespaces.get(namespace);
          for (const serviceId of sorted(instances)) {
            const { service, deployment: placed } = instances.get(serviceId);
            const instanceId = safeId(service.id);
            const revision = /^[0-9a-f]{40}$/.test(placed.revision) ? placed.revision.slice(0, 7) : placed.revision;
            const about = [placed.name, revision ? `at ${revision}` : ""].filter(Boolean).join(" ");
            deployment.push(`${nsIndent}${instanceId} = instanceOf ${fqn(service.id)} {`);
            deployment.push(`${nsIndent}  description ${q(about)}`);
            deployment.push(`${nsIndent}}`);
            const places = placesOfService.get(service.id) ?? [];
            places.push([...nsPath, instanceId].join("."));
            placesOfService.set(service.id, places);
            const frames = framesOfEnvironment.get(env) ?? new Set();
            for (let depth = 2; depth <= nsPath.length; depth += 1) frames.add(nsPath.slice(0, depth).join("."));
            frames.add([...nsPath, instanceId].join("."));
            framesOfEnvironment.set(env, frames);
          }
          if (namespace) deployment.push(`${indent}}`);
        }
        if (cluster) deployment.push("    }");
      }
      deployment.push("  }");
    }
    deployment.push("}");

    views.push("");
    for (const env of environments) {
      // Every frame under the environment, named one by one rather than as
      // `env.**`: a descendant wildcard draws the instances alone and folds
      // the cluster and namespace away, and where a thing runs is the point.
      views.push(`  deployment view ${deploymentViewId(env)} {`);
      views.push(`    title ${q(`${env} — deployed`)}`);
      views.push(`    include ${[...framesOfEnvironment.get(env)].join(", ")}`);
      // No fold labels here: LikeC4 1.59 parses `include a -> b with { … }` in
      // a deployment view and then ignores it, so folded calls between two
      // instances still read `[...]`.
      views.push("  }");
    }
    for (const service of allServices) {
      const places = placesOfService.get(service.id);
      if (!places) continue;
      // The frames around each instance, named one by one: a node named with
      // its children is drawn as the frame it is, and a reader can tell the
      // two boxes apart by where they sit.
      const frames = new Set();
      for (const place of places) {
        const segments = place.split(".");
        for (let depth = 1; depth <= segments.length; depth += 1) frames.add(segments.slice(0, depth).join("."));
      }
      views.push(`  deployment view ${serviceDeployViewId(service)} {`);
      views.push(`    title ${q(`${service.name} — where it runs`)}`);
      views.push(`    include ${[...frames].join(", ")}`);
      views.push("  }");
    }
  }
  return { deployment };
}
