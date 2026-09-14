import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { UPDATE_COMMAND, UpdateNotice, changelogHref } from "./UpdateNotice";

describe("UpdateNotice", () => {
  it("shows the current and latest versions with one update action", () => {
    const markup = renderToStaticMarkup(
      <UpdateNotice update={{ current: "0.4.0", latest: "0.5.0" }} />,
    );

    expect(markup).toContain("Portolan 0.5.0 is available");
    expect(markup).toContain("You are running");
    expect(markup).toContain("0.4.0");
    expect(markup).toContain("Copy update command");
    expect(markup).toContain("Changelog");
    expect(markup).toContain(
      "https://github.com/shortlink-org/portolan/compare/0.4.0...0.5.0",
    );
    expect(markup).toContain("Dismiss update notice");
    expect(UPDATE_COMMAND).toBe(
      "npm install --save-dev @shortlink-org/portolan@latest",
    );
  });

  it("renders nothing without an available update", () => {
    expect(renderToStaticMarkup(<UpdateNotice update={null} />)).toBe("");
  });

  it("escapes versions in the changelog URL", () => {
    expect(changelogHref({ current: "1.0.0+local", latest: "1.1.0-rc.1" })).toBe(
      "https://github.com/shortlink-org/portolan/compare/1.0.0%2Blocal...1.1.0-rc.1",
    );
  });
});
