// What a developer types against the checkout, one row per entry of the
// runner files.
//
// The line to type is the row's identity and its copy target: `make gen`,
// `npm run test`, `just dev`. What it does is the file's own description when
// the file gives one, and most files give none - so the body, the recipe or
// script the runner would execute, stands in, folded to its first line. A
// build script that runs three tools is still one command, and the table
// should read as a list of commands, not as a second copy of the Makefile.
// The whole body is a click away, and the source link is where the rest of
// the file is.

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { Command, Service } from "../catalog";
import { allRepos } from "../catalog";
import { catalog } from "../data";
import { sourceHref, splitLine } from "../lib/source-link";
import { RowActions } from "./RowActions";

/** The runner as a chip: the tool, not the whole line, so the eye can group by it. */
function RunnerChip({ runner }: { runner: string }) {
  return (
    <span className="chip mono" title={`typed at ${runner}`}>
      {runner}
    </span>
  );
}

function firstLine(body: string): { line: string; more: boolean } {
  const [line = "", ...rest] = body.split("\n");
  return { line, more: rest.some((l) => l.trim() !== "") };
}

function SourceLink({
  where,
  service,
}: {
  where: string;
  service: Service;
}) {
  const href = sourceHref(where, service, allRepos(catalog));
  const { path, line } = splitLine(where);
  const label = `${path.split("/").pop() ?? path}${line ? `:${line}` : ""}`;
  if (!href) {
    return (
      <span className="mono text-muted" title={where}>
        {label}
      </span>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="mono text-muted hover:text-ink hover:underline"
      title={`${where} on the forge, at the built commit`}
    >
      {label}
    </a>
  );
}

function CommandRow({
  command,
  service,
}: {
  command: Command;
  service: Service;
}) {
  const [open, setOpen] = useState(false);
  const body = command.body ?? "";
  const { line, more } = firstLine(body);
  // The body folds only when there is something under the fold: a one-line
  // script shown twice would be the table repeating itself.
  const foldable = more;
  const shown = open ? body : line;

  return (
    <div className="row items-start px-2 py-1.5">
      <RunnerChip runner={command.runner} />
      <span className="mono text-ink">{command.run}</span>
      <div className="min-w-0">
        {command.doc ? <p className="text-ink">{command.doc}</p> : null}
        {body ? (
          <div className="flex min-w-0 items-start gap-1">
            {foldable ? (
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                className="mt-0.5 shrink-0 rounded-control text-muted hover:text-ink"
                title={open ? "fold the recipe" : "show the whole recipe"}
              >
                <ChevronRight
                  size={14}
                  className={`transition-transform ${open ? "rotate-90" : ""}`}
                />
              </button>
            ) : null}
            <pre
              className={`mono min-w-0 whitespace-pre-wrap break-words text-muted ${command.doc ? "mt-0.5" : ""}`}
            >
              {shown}
              {foldable && !open ? " …" : ""}
            </pre>
          </div>
        ) : null}
      </div>
      {command.source ? (
        <SourceLink where={command.source} service={service} />
      ) : (
        <span />
      )}
      <RowActions copy={command.run} label={command.run} />
    </div>
  );
}

export function CommandRows({
  commands,
  service,
}: {
  commands: Command[];
  service: Service;
}) {
  return (
    <div className="rows grid-cols-[auto_auto_1fr_auto_auto]">
      {commands.map((command) => (
        <CommandRow key={command.run} command={command} service={service} />
      ))}
    </div>
  );
}
