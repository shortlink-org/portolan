// What the recordings said about one step.
//
// A flow carries its examples whole - one per trace, in the order the trace
// ran - and a step's panel wants the other cut: every trace that showed this
// step, with what the span said. This is that cut, kept apart from the panel
// so a test can hold it.

import type { ExampleStep, Flow, FlowExample, Step } from "../catalog";

export interface ExampleRow {
  example: FlowExample;
  shown: ExampleStep;
}

/** Every recorded run of the step, in the order the flow keeps its examples. */
export function exampleRowsFor(
  flow: Pick<Flow, "examples">,
  step: Pick<Step, "id">,
): ExampleRow[] {
  return (flow.examples ?? []).flatMap((example) =>
    example.steps
      .filter((shown) => shown.step === step.id)
      .map((shown) => ({ example, shown })),
  );
}

/** Milliseconds the way a reader says them: 0.4 ms, 12 ms, 1.3 s. */
export function formatMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms >= 10_000 ? 0 : 1)} s`;
  if (ms >= 10) return `${Math.round(ms)} ms`;
  return `${ms.toFixed(ms >= 1 ? 1 : 2)} ms`;
}

/** The distinct steps a recording showed, in the order it showed them. */
export function stepsShownBy(example: Pick<FlowExample, "steps">): string[] {
  return [...new Set(example.steps.map((shown) => shown.step))];
}
