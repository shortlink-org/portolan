const TECHNICAL_PARTS = [
  ["endpoint '", "Endpoint"],
  ["request '", "Request"],
  ["response '", "Response"],
] as const;

interface NotePart {
  label: string;
  value: string;
  path?: boolean;
}

export interface ParsedStepNote {
  details: NotePart[];
  prose: string[];
}

/**
 * HTTP extraction keeps compact, machine-derived facts in the note. Separate
 * those facts from authored prose so the detail rail reads as evidence rather
 * than as one long sentence.
 */
export function parseStepNote(note: string): ParsedStepNote {
  const details: NotePart[] = [];
  const prose: string[] = [];

  for (const part of note
    .split("; ")
    .map((value) => value.trim())
    .filter(Boolean)) {
    const quoted = TECHNICAL_PARTS.find(([prefix]) => part.startsWith(prefix));
    if (quoted && part.endsWith("'")) {
      details.push({ label: quoted[1], value: part.slice(quoted[0].length, -1) });
      continue;
    }
    if (part.startsWith("URL source ")) {
      details.push({
        label: "URL source",
        value: part.slice("URL source ".length),
        path: true,
      });
      continue;
    }
    if (part.startsWith("via ")) {
      details.push({
        label: "Call path",
        value: part.slice("via ".length),
        path: true,
      });
      continue;
    }
    if (part.startsWith("when ")) {
      details.push({ label: "Condition", value: part.slice("when ".length) });
      continue;
    }
    prose.push(part);
  }

  return { details, prose };
}

function PathValue({ value }: { value: string }) {
  const segments = value.split(" → ");
  return (
    <div className="flex flex-wrap items-baseline gap-x-1 gap-y-0.5">
      {segments.map((segment, index) => (
        <span key={`${segment}:${index}`} className="contents">
          {index > 0 ? (
            <span className="text-faint" aria-hidden>
              →
            </span>
          ) : null}
          <code className="mono break-all text-ink">{segment}</code>
        </span>
      ))}
    </div>
  );
}

export function StepNoteEvidence({
  note,
  omitEndpoint = false,
}: {
  note: string;
  omitEndpoint?: boolean;
}) {
  const details = parseStepNote(note).details.filter(
    (detail) => !omitEndpoint || detail.label !== "Endpoint",
  );
  if (details.length === 0) return null;

  return (
    <div>
      <div className="label mb-1.5">Call reconstruction</div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">
        {details.map((detail, index) => (
          <div key={`${detail.label}:${index}`} className="contents">
            <dt className="text-muted">{detail.label}</dt>
            <dd className="min-w-0">
              {detail.path ? (
                <PathValue value={detail.value} />
              ) : (
                <code className="mono break-all text-ink">{detail.value}</code>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function StepNote({
  note,
  unresolved = false,
}: {
  note: string;
  unresolved?: boolean;
}) {
  const prose = parseStepNote(note).prose;
  if (prose.length === 0) return null;

  return (
    <div>
      <div className="label mb-1">Note</div>
      <p
        className="border-l-2 pl-2 text-muted"
        style={{
          borderColor: unresolved
            ? "var(--status-unresolved)"
            : "var(--border-strong)",
        }}
      >
        {prose.join("; ")}
      </p>
    </div>
  );
}
