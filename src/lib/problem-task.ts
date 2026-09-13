import type { Problem } from "./derive";
import type { RulePassport } from "./problem-rules";

/** Catalog text is plain text, even when it contains Markdown punctuation. */
const plain = (value: string): string =>
  value.replace(/\s+/g, " ").replace(/[\\`*_{}\[\]<>()#!|]/g, "\\$&");

export function problemTaskMarkdown(
  problem: Problem,
  rule: Pick<RulePassport, "title" | "description" | "action"> | undefined,
  problemUrl: string,
  sourceUrl?: string | null,
): string {
  const lines = [
    `### ${plain(rule?.title || problem.rule)}: ${plain(problem.id)}`,
    "",
    `- Rule: ${plain(problem.rule)}`,
    `- Severity: ${plain(problem.severity)}`,
  ];
  if (problem.context) lines.push(`- Context: ${plain(problem.context)}`);
  if (problem.service) lines.push(`- Service: ${plain(problem.service)}`);
  if (problem.peer) lines.push(`- Related entity: ${plain(problem.peer)}`);
  if (rule?.description) lines.push("", plain(rule.description));
  if (problem.note) lines.push("", plain(problem.note));
  if (rule?.action) lines.push("", `**Recommended action:** ${plain(rule.action)}`);
  if (problem.source) {
    lines.push("", sourceUrl
      ? `Source: [${plain(problem.source)}](<${sourceUrl.replace(/>/g, "%3E")}>)`
      : `Source: ${plain(problem.source)}`);
  }
  lines.push("", `[Open in Portolan](<${problemUrl.replace(/>/g, "%3E")}>)`);
  return lines.join("\n") + "\n";
}
