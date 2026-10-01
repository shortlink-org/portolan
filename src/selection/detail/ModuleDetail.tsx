import { Link } from "react-router";
import { index } from "../../data";
import {
  consumersOf,
  countsOf,
  dependenciesOf,
  registryUrl,
} from "../../lib/registry";
import { Ident } from "../../components/Ident";
import { modulePath, paths } from "../../routes";
import type { Resolved } from "../model";
import { Label, Row, SelectLink } from "./shared";

export function ModuleBody({
  resolved,
}: {
  resolved: Extract<Resolved, { kind: "module" }>;
}) {
  const { module } = resolved;
  const counts = countsOf(index, module);
  const consumers = consumersOf(index, module);
  const deps = dependenciesOf(index, module);
  const owner = module.owner ? index.serviceById.get(module.owner) : undefined;
  const url = registryUrl(module);
  const to = modulePath(module.id);

  return (
    <>
      {module.registry ? <Label>{module.registry}</Label> : null}
      <Label>commit</Label>
      <Row>
        {module.commit ? (
          <Ident value={module.commit.slice(0, 12)} />
        ) : (
          /* Not pinned is a fact worth saying: it means two builds a day apart
             can describe two different modules under one name. */
          <span className="text-muted">not pinned</span>
        )}
      </Row>

      <Label>holds</Label>
      <div className="rows">
        <div className="row">
          <span className="flex-1">packages</span>
          <span className="tnum text-muted">{counts.packages}</span>
        </div>
        <div className="row">
          <span className="flex-1">interfaces</span>
          <span className="tnum text-muted">{counts.interfaces}</span>
        </div>
        <div className="row">
          <span className="flex-1">methods</span>
          <span className="tnum text-muted">{counts.methods}</span>
        </div>
        <div className="row">
          <span className="flex-1">messages</span>
          <span className="tnum text-muted">{counts.messages}</span>
        </div>
      </div>

      {/* Who publishes it, and - the more interesting half - who else reads it. */}
      <Label>published by</Label>
      {owner ? (
        <SelectLink id={owner.id}>{owner.id}</SelectLink>
      ) : (
        <p className="text-muted">
          nobody in this catalog — the module is published elsewhere
        </p>
      )}

      {consumers.length > 0 ? (
        <>
          <Label>read by</Label>
          <div className="rows">
            {consumers.map((service) => (
              <SelectLink key={service.id} id={service.id}>
                {service.id}
              </SelectLink>
            ))}
          </div>
        </>
      ) : null}

      {deps.length > 0 ? (
        <>
          <Label>depends on</Label>
          <div className="rows">
            {deps.map((dep) =>
              dep.module ? (
                <Link
                  key={dep.id}
                  to={paths.module(dep.module.slug)}
                  className="row mono hover:text-ink"
                >
                  {dep.module.name}
                </Link>
              ) : (
                /* A module may depend on one the estate never vendored. Naming
                   it and saying so beats a link into nothing. */
                <div key={dep.id} className="row mono text-muted">
                  {dep.id}
                  <span className="ml-auto">not in this catalog</span>
                </div>
              ),
            )}
          </div>
        </>
      ) : null}

      {to ? (
        <Link to={to} className="mt-3 block text-muted hover:text-ink">
          open the module →
        </Link>
      ) : null}
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="mt-1 block text-muted hover:text-ink"
        >
          {module.name} on {module.registry} ↗
        </a>
      ) : null}
    </>
  );
}
