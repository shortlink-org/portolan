import { djangoAggregateCandidates, djangoAggregateMessage } from "./django-aggregates";
import type { DjangoAggregateCandidates } from "./django-aggregates";

export type WarningSeverity = "error" | "warning" | "info";

export interface RawWarning {
  plugin: string;
  message: string;
}

export interface WarningDiagnostic extends RawWarning {
  aggregateCandidates?: DjangoAggregateCandidates;
  rule: string;
  severity: WarningSeverity;
  action: string;
  count?: number;
  project?: string;
  phase?: string;
  ref?: string;
  suppressed: boolean;
  suppressionReason?: string;
}

export interface WarningGroup {
  plugin: string;
  rule: string;
  severity: WarningSeverity;
  action: string;
  messages: WarningDiagnostic[];
  count: number;
  suppressed: boolean;
  suppressionReason?: string;
}

interface RuleDefinition {
  id: string;
  matches: RegExp;
  severity: WarningSeverity;
  action: string;
}

// Rules describe the recurring limitation, not the source-specific value in a
// message. Their ids are therefore stable enough to use in portolan.json.
const RULES: RuleDefinition[] = [
  {
    id: "openapi.missing-operation-id",
    matches: /\bno operationId\b/i,
    severity: "warning",
    action: "Add stable operationId values to the OpenAPI operations.",
  },
  {
    id: "schema.duplicate-declaration",
    matches: /\bduplicate declaration\b/i,
    severity: "warning",
    action: "Remove or reconcile duplicate schema declarations; Portolan currently uses the first.",
  },
  {
    id: "analysis.typed-fallback",
    matches: /\btyped call graph unavailable\b/i,
    severity: "warning",
    action: "Run an extractor build with typed analysis support or inspect calls found by the syntax fallback.",
  },
  {
    id: "catalog.unresolved-call",
    matches: /\bcalls .+ which nothing in this catalog resolves\b/i,
    severity: "warning",
    action: "Add or correct the provider contract, then regenerate to resolve the call.",
  },
  {
    id: "catalog.unmapped-proto-peer",
    matches: /\bmanifest names no peer for (?:that package|it)\b/i,
    severity: "warning",
    action: "Map the protobuf package under peers, or declare it under externals.",
  },
  {
    id: "flow.unresolved-step",
    matches: /\bstep .+ is unresolved\b/i,
    severity: "warning",
    action: "Declare the referenced endpoint, message, or store so this flow step can be joined.",
  },
  {
    id: "flow.unknown-port",
    matches: /\bis neither a domain port(?:,| nor) a use case\b/i,
    severity: "warning",
    action: "Model this dependency as a domain port or use case, or accept that its calls stay outside the flow.",
  },
  {
    id: "flow.unreached-event",
    matches: /\bno flow reaches this event\b/i,
    severity: "warning",
    action: "Connect the event to its publisher flow or remove the stale event declaration.",
  },
  {
    id: "flow.unknown-event",
    matches: /\breacts to the message named .+ which no event .+ declares is called\b/i,
    severity: "warning",
    action: "Declare the event name used by the handler or correct the handler mapping.",
  },
  {
    id: "django.invalid-aggregate-root",
    matches: /\baggregates names .+ and no model there is called that\b/i,
    severity: "warning",
    action: "Choose an existing concrete model for the application's aggregates option.",
  },
  {
    id: "django.unknown-http-verb",
    matches: /\bmounted as an HTTP view, but no HTTP verb is declared\b/i,
    severity: "warning",
    action: "Declare the accepted HTTP methods on the view or route.",
  },
  {
    id: "river.missing-worker",
    matches: /\bno registered Worker\b/i,
    severity: "warning",
    action: "Register the River worker in this component or remove the unmatched insert.",
  },
  {
    id: "watermill.unresolved-topic",
    matches: /\bWatermill .+\btopic (?:generator could not be resolved|unresolved)\b/i,
    severity: "warning",
    action: "Use a literal, constant, or configuration default for the Watermill topic.",
  },
  {
    id: "messaging.unresolved-subject",
    matches: /\bsubject of .+ could not be resolved\b/i,
    severity: "warning",
    action: "Use a literal, constant, configuration default, or visible caller argument for the subject.",
  },
  {
    id: "store.external-migrations",
    matches: /\bmigrations are applied from .+ whose schema is not in this tree\b/i,
    severity: "warning",
    action: "Vendor or expose the external migrations so their tables can be included in the store.",
  },
  {
    id: "store.missing-foreign-table",
    matches: /\bcolumn .+ references .+ which no migration here creates\b/i,
    severity: "warning",
    action: "Include the referenced table migration or correct the foreign-key target.",
  },
  {
    id: "schema.unresolved-type",
    matches: /\bis not declared in the protos read here\b/i,
    severity: "warning",
    action: "Include the imported protobuf declaration or map the type to an external schema.",
  },
  {
    id: "source.offline-cache",
    matches: /\bnot (?:fetched|read) \(offline\)/i,
    severity: "info",
    action: "Regenerate with network access when the vendored copy must be refreshed.",
  },
  {
    id: "source.unreachable",
    matches: /\bnot (?:fetched|read) \((?!offline\))/i,
    severity: "warning",
    action: "The far end could not be reached and the committed copy was used; check the server and the credential, then regenerate.",
  },
  {
    id: "source.unpinned",
    matches: /\bnot pinned\b/i,
    severity: "warning",
    action: "Pin the source to an immutable commit or schema version.",
  },
  {
    id: "source.parse-failed",
    matches: /\bcould not (?:be read|parse|be parsed|be encoded)\b/i,
    severity: "error",
    action: "Open the referenced source and fix the parse or read error.",
  },
  {
    id: "extraction.no-match",
    matches: /\b(?:no .+ (?:was|were) found|no .+ matched|declares no |no models in this application)\b/i,
    severity: "info",
    action: "Confirm this capability is absent, or point the extractor at the source that declares it.",
  },
];

const FALLBACK_ACTION = "Inspect the referenced source and either fix the extraction gap or add a reviewed CEL policy with a reason.";

export function warningDiagnostic(
  warning: RawWarning,
): WarningDiagnostic {
  const definition = RULES.find((candidate) => candidate.matches.test(warning.message));
  const rule = definition?.id ?? `plugin.${slug(warning.plugin)}.other-${fingerprint(warning.message)}`;
  const ref = warningRef(warning.message);

  return {
    ...warning,
    message: djangoAggregateMessage(warning.message),
    ...(djangoAggregateCandidates(warning.message) ? { aggregateCandidates: djangoAggregateCandidates(warning.message)! } : {}),
    rule,
    severity: definition?.severity ?? "warning",
    action: definition?.action ?? FALLBACK_ACTION,
    ...(ref ? { ref } : {}),
    suppressed: false,
  };
}

export function groupWarnings(
  warnings: RawWarning[],
): WarningGroup[] {
  return groupDiagnostics(warnings.map((warning) => warningDiagnostic(warning)));
}

export function groupDiagnostics(diagnostics: WarningDiagnostic[]): WarningGroup[] {
  const groups = new Map<string, WarningGroup>();
  for (const warning of diagnostics) {
    const key = `${warning.plugin}\0${warning.rule}\0${warning.severity}\0${warning.suppressed}`;
    const existing = groups.get(key);
    if (existing) {
      existing.messages.push(warning);
      existing.count += 1;
      continue;
    }
    groups.set(key, {
      plugin: warning.plugin,
      rule: warning.rule,
      severity: warning.severity,
      action: warning.action,
      messages: [warning],
      count: 1,
      suppressed: warning.suppressed,
      ...(warning.suppressionReason ? { suppressionReason: warning.suppressionReason } : {}),
    });
  }
  const order: Record<WarningSeverity, number> = { error: 0, warning: 1, info: 2 };
  return [...groups.values()].sort(
    (left, right) => order[left.severity] - order[right.severity]
      || Number(left.suppressed) - Number(right.suppressed)
      || right.count - left.count
      || left.plugin.localeCompare(right.plugin)
      || left.rule.localeCompare(right.rule),
  );
}

function warningRef(message: string): string | undefined {
  const match = message.match(/^(.+?):\s+(?=[A-Za-z/])/);
  return match?.[1]?.trim() || undefined;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
}

function fingerprint(message: string): string {
  const ref = warningRef(message);
  const body = (ref ? message.slice(message.indexOf(":", ref.length) + 1) : message)
    .toLowerCase()
    .replace(/`[^`]*`|"[^"]*"|'[^']*'/g, "<value>")
    .replace(/\b\d+\b/g, "#")
    .replace(/\s+/g, " ")
    .trim();
  let hash = 0x811c9dc5;
  for (let index = 0; index < body.length; index += 1) {
    hash ^= body.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
