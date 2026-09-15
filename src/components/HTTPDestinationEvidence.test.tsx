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

it("says a link rests on an inferred verb, and what it was read from", () => {
  const html = renderToStaticMarkup(<HTTPDestinationEvidence destination={{
    callSite: "client.go:10", endpointExpression: "/geo/upload_csv", method: "POST",
    resolution: { basis: "exact-route", provider: "avia.aviaadmin", route: "/geo/upload_csv", confidence: "medium", methodEvidence: { rule: "reads request.FILES", source: "geo/views.py:64" } },
  }} />);
  expect(html).toContain("medium (the provider&#x27;s HTTP verb is inferred, not declared)");
  expect(html).toContain("reads request.FILES at geo/views.py:64");
  const declared = renderToStaticMarkup(<HTTPDestinationEvidence destination={{
    callSite: "client.go:10", endpointExpression: "/book", method: "POST",
    resolution: { basis: "exact-route", provider: "aviasupp", route: "/book" },
  }} />);
  expect(declared).not.toContain("Confidence");
});

it("labels suffix resolution as a heuristic", () => {
  const html = renderToStaticMarkup(<HTTPDestinationEvidence destination={{
    callSite: "client.go:10", endpointExpression: "/settings", method: "POST",
    resolution: { basis: "unique-suffix", provider: "admin", route: "/admin/settings" },
  }} />);
  expect(html).toContain("Unique route suffix (heuristic)");
});
