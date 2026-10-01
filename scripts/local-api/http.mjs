// The request and the reply: JSON in and out, the bytes of an upload, and
// the check that the caller is the page on this machine.

export function send(res, status, value) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(`${JSON.stringify(value)}\n`);
}

export async function body(req) {
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 64 * 1024) throw new Error("Request body is too large.");
  }
  return text ? JSON.parse(text) : {};
}

/** The bytes of an upload, as they came, up to a limit that is said out loud. */
export async function rawBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error(`The upload is larger than ${Math.round(limit / 1024 / 1024)} MB.`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function localRequest(req) {
  const address = req.socket.remoteAddress ?? "";
  const localAddress = address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
  const authority = String(req.headers.host ?? "");
  const host = authority.startsWith("[") ? authority.slice(1, authority.indexOf("]")) : authority.split(":")[0];
  const localHost = ["localhost", "127.0.0.1", "::1"].includes(host);
  let localOrigin = true;
  if (req.headers.origin) {
    try { localOrigin = ["localhost", "127.0.0.1", "::1"].includes(new URL(req.headers.origin).hostname); }
    catch { localOrigin = false; }
  }
  return localAddress && localHost && localOrigin;
}
