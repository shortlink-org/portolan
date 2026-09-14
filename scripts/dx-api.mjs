export const DX_API = "https://api.getdx.com";

export class DXRequestError extends Error {
  constructor(message, { status = 0, code = "", transient = false, cause } = {}) {
    super(message, { cause });
    this.name = "DXRequestError";
    this.status = status;
    this.code = code;
    this.transient = transient;
  }
}

export const isTransientDXError = (error) => error instanceof DXRequestError && error.transient;

export async function requestJSON(pathname, {
  server = DX_API,
  token,
  method = "GET",
  query = {},
  body,
  fetch: fetchFn = globalThis.fetch,
  retries = 3,
  wait = sleep,
  timeoutMs = 60_000,
} = {}) {
  const url = new URL(`${String(server).replace(/\/+$/, "")}${pathname}`);
  for (const [name, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(name, String(value));
  }

  for (let attempt = 0; ; attempt += 1) {
    let response;
    try {
      response = await fetchFn(url, {
        method,
        headers: {
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          Authorization: `Bearer ${token}`,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      const error = new DXRequestError(`${pathname}: ${cause instanceof Error ? cause.message : String(cause)}`, {
        transient: true,
        cause,
      });
      if (attempt >= retries) throw error;
      await wait(backoff(attempt));
      continue;
    }

    const raw = await response.text();
    let answer;
    try {
      answer = JSON.parse(raw);
    } catch (cause) {
      const transient = response.status === 429 || response.status >= 500;
      const error = new DXRequestError(`${pathname}: the answer is not JSON (http ${response.status})`, {
        status: response.status,
        transient,
        cause,
      });
      if (!transient || attempt >= retries) throw error;
      await wait(retryDelay(response, attempt));
      continue;
    }

    if (response.ok && answer?.ok !== false) return answer;

    const code = errorCode(answer);
    const transient = response.status === 429 || response.status >= 500;
    const error = new DXRequestError(`${pathname}: ${errorMessage(answer, response.status)}`, {
      status: response.status,
      code,
      transient,
    });
    if (!transient || attempt >= retries) throw error;
    await wait(retryDelay(response, attempt));
  }
}

function errorCode(answer) {
  if (typeof answer?.error === "string") return answer.error;
  return String(answer?.error?.code ?? "");
}

function errorMessage(answer, status) {
  if (typeof answer?.error === "string") return answer.error;
  if (typeof answer?.error?.message === "string") return answer.error.message;
  if (typeof answer?.message === "string") return answer.message;
  return `http ${status}`;
}

function retryDelay(response, attempt) {
  const value = response.headers?.get?.("retry-after")?.trim();
  if (value && /^\d+(?:\.\d+)?$/.test(value)) return Math.min(30_000, Number(value) * 1_000);
  if (value) {
    const date = Date.parse(value);
    if (Number.isFinite(date)) return Math.min(30_000, Math.max(0, date - Date.now()));
  }
  return backoff(attempt);
}

const backoff = (attempt) => Math.min(4_000, 250 * (2 ** attempt));
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
