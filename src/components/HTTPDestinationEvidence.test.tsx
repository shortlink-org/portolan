import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { HTTPDestinationEvidence } from "./HTTPDestinationEvidence";

it("shows the join and the config default behind a resolved destination", () => {
  const html = renderToStaticMarkup(<HTTPDestinationEvidence destination={{
    callSite: "client.go:10", endpointExpression: "c.baseURL + path", method: "POST",
    localPath: "/get-admin-settings", fullPath: "/settings/get-admin-settings",
    baseURL: { expression: "cfg.SettingAddr", configField: "Config.SettingAddr", environmentVariable: "SETTINGS_ADDR", kind: "config-default", value: "http://localhost:8000/settings", source: "config.go:84", optionSource: "modules_tree.go:212" },
    join: { expression: "c.baseURL + path", source: "client.go:10" },
    resolution: { basis: "full-path", provider: "avia.aviaadmin", route: "/settings/get-admin-settings" },
  }} />);
  for (const value of ["Recovered full path", "Config default (runtime may override)", "SETTINGS_ADDR", "modules_tree.go:212", "Config.SettingAddr", "/settings/get-admin-settings", "avia.aviaadmin"]) expect(html).toContain(value);
  expect(html).not.toContain("heuristic");
});

it("labels suffix resolution as a heuristic", () => {
  const html = renderToStaticMarkup(<HTTPDestinationEvidence destination={{
    callSite: "client.go:10", endpointExpression: "/settings", method: "POST",
    resolution: { basis: "unique-suffix", provider: "admin", route: "/admin/settings" },
  }} />);
  expect(html).toContain("Unique route suffix (heuristic)");
});
