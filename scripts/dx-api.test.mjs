import { describe, expect, it, vi } from "vitest";

import { DXRequestError, requestJSON } from "./dx-api.mjs";

describe("DX API requests", () => {
  it.each([429, 503])("retries transient HTTP %s responses", async (status) => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('{"ok":false,"error":"busy"}', {
        status,
        headers: { "Retry-After": "0.01" },
      }))
      .mockResolvedValueOnce(new Response('{"ok":true,"entities":[]}'));
    const wait = vi.fn();

    await expect(requestJSON("/catalog.entities.list", {
      token: "secret", fetch, wait, retries: 1,
    })).resolves.toMatchObject({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(10);
  });

  it("does not retry authentication or configuration errors", async () => {
    const fetch = vi.fn(async () => new Response('{"ok":false,"error":"invalid_auth"}', { status: 401 }));
    const wait = vi.fn();

    await expect(requestJSON("/catalog.entities.list", {
      token: "bad", fetch, wait,
    })).rejects.toMatchObject({
      name: "DXRequestError",
      status: 401,
      code: "invalid_auth",
      transient: false,
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(wait).not.toHaveBeenCalled();
  });

  it("marks a network failure as transient after retries are exhausted", async () => {
    const fetch = vi.fn(async () => { throw new Error("socket closed"); });
    const wait = vi.fn();

    await expect(requestJSON("/catalog.entities.list", {
      token: "secret", fetch, wait, retries: 1,
    })).rejects.toBeInstanceOf(DXRequestError);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledOnce();
  });
});
