// The flow as a Mermaid sequence diagram, for copying out.
//
// This is the same picture plugins/gen-markdown/flow.go draws into docs/, line
// for line, and mermaid.test.ts holds the two to each other: a reader who
// pastes this into a wiki and a reader of the generated page see one diagram.
// Participants are aliased p0, p1, … because Mermaid wants an identifier where
// the catalog has a dotted service id.

import type { Flow, FlowNode, Step } from "../catalog";

export function flowMermaid(flow: Flow): string {
  const alias = new Map<string, string>();
  flow.participants.forEach((p, i) => alias.set(p.id, `p${i}`));
  const of = (id: string) => alias.get(id) ?? id;

  const lines: string[] = ["sequenceDiagram", "    autonumber"];
  for (const p of flow.participants) {
    const keyword = p.kind === "actor" ? "actor" : "participant";
    lines.push(`    ${keyword} ${of(p.id)} as ${text(p.label || p.id)}`);
  }
  emit(flow.steps, of, 1, lines);
  return `${lines.join("\n")}\n`;
}

function emit(
  nodes: FlowNode[],
  of: (id: string) => string,
  depth: number,
  out: string[],
): void {
  const indent = "    ".repeat(depth);
  for (const node of nodes) {
    switch (node.type) {
      case "step": {
        // An event is drawn with the async arrow. A reader who cannot tell a
        // call from a publication is reading a different flow.
        const arrow = node.kind === "event" ? "-)" : "->>";
        out.push(`${indent}${of(node.from)}${arrow}${of(node.to)}: ${text(stepLabel(node))}`);
        break;
      }
      case "parallel": {
        out.push(`${indent}par ${text(node.title?.trim() ? node.title : "in parallel")}`);
        node.branches.forEach((branch, i) => {
          if (i > 0) out.push(`${indent}and`);
          emit(branch, of, depth + 1, out);
        });
        out.push(`${indent}end`);
        break;
      }
      case "alt": {
        node.branches.forEach((branch, i) => {
          out.push(`${indent}${i === 0 ? "alt " : "else "}${text(branch.title)}`);
          emit(branch.steps, of, depth + 1, out);
          // A branch that ends the flow has to say so inside the diagram, or
          // the steps drawn after the alt read as if they follow it too.
          if (branch.terminal) {
            const last = lastParticipant(branch.steps);
            if (last)
              out.push(`${"    ".repeat(depth + 1)}Note over ${of(last)}: flow ends here`);
          }
        });
        out.push(`${indent}end`);
        break;
      }
      case "loop": {
        out.push(`${indent}loop ${text(node.title)}`);
        emit(node.steps, of, depth + 1, out);
        out.push(`${indent}end`);
        break;
      }
    }
  }
}

function stepLabel(step: Step): string {
  return step.label || step.ref || step.kind;
}

function lastParticipant(nodes: FlowNode[]): string {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i]!;
    switch (node.type) {
      case "step":
        return node.to;
      case "parallel":
        for (let j = node.branches.length - 1; j >= 0; j--) {
          const p = lastParticipant(node.branches[j]!);
          if (p) return p;
        }
        break;
      case "alt":
        for (let j = node.branches.length - 1; j >= 0; j--) {
          const p = lastParticipant(node.branches[j]!.steps);
          if (p) return p;
        }
        break;
      case "loop": {
        const p = lastParticipant(node.steps);
        if (p) return p;
        break;
      }
    }
  }
  return "";
}

/**
 * A label made safe on a Mermaid line: a newline ends the statement, so does
 * a semicolon, and a bare # opens an entity code. Semicolons go first, or the
 * escape for # is mangled into text.
 */
function text(s: string): string {
  return s
    .replace(/\r\n/g, "\n")
    .replace(/\n/g, " ")
    .replace(/;/g, ",")
    .replace(/#/g, "#35;")
    .trim();
}
