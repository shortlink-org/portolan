import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseStepNote, StepNote, StepNoteEvidence } from "./StepNote";

describe("step note", () => {
  it("separates generated HTTP facts from prose", () => {
    expect(
      parseStepNote(
        "endpoint 'http://localhost:8000/settings/raw/{key}'; via Search.Search → RunSteps → Client.GET; kept for review",
      ),
    ).toEqual({
      details: [
        {
          label: "Endpoint",
          value: "http://localhost:8000/settings/raw/{key}",
        },
        {
          label: "Call path",
          value: "Search.Search → RunSteps → Client.GET",
          path: true,
        },
      ],
      prose: ["kept for review"],
    });
  });

  it("keeps generated details out of the visible note and puts the call path in evidence", () => {
    const note =
      "endpoint 'http://localhost:8000/settings/raw/{key}'; via Search.Search → RunSteps → Client.GET";
    expect(renderToStaticMarkup(<StepNote note={note} />)).toBe("");
    const html = renderToStaticMarkup(
      <StepNoteEvidence note={note} omitEndpoint />,
    );
    expect(html).toContain("Call reconstruction");
    expect(html).toContain("Call path");
    expect(html).toContain("Search.Search");
    expect(html).toContain("RunSteps");
    expect(html).not.toContain("Endpoint");
    expect(html).not.toContain("localhost");
    expect(html).not.toContain(">Note<");
  });

  it("keeps an ordinary note as prose", () => {
    const html = renderToStaticMarkup(
      <StepNote note="Retries are disabled for this call." />,
    );
    expect(html).toContain(">Note<");
    expect(html).toContain("Retries are disabled for this call.");
    expect(html).not.toContain("Call details");
  });
});
