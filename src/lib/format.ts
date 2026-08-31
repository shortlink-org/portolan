/** "3 days ago" style, coarse on purpose: precision here is noise. */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const seconds = Math.round((now.getTime() - then) / 1000);
  const future = seconds < 0;
  const abs = Math.abs(seconds);
  const units: [number, string][] = [
    [60, "second"],
    [3600, "minute"],
    [86400, "hour"],
    [604800, "day"],
    [2629800, "week"],
    [31557600, "month"],
    [Number.POSITIVE_INFINITY, "year"],
  ];
  let value = abs;
  let label = "second";
  let prev = 1;
  for (const [limit, name] of units) {
    if (abs < limit) {
      value = Math.floor(abs / prev);
      label = name;
      break;
    }
    prev = limit;
    label = name;
  }
  if (label === "second" && value < 45)
    return future ? "in a moment" : "just now";
  const plural = value === 1 ? label : `${label}s`;
  return future ? `in ${value} ${plural}` : `${value} ${plural} ago`;
}

export function absoluteTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d+Z$/, "Z");
}

/**
 * Middle truncation for file paths: the repo tells you where you are, the
 * basename tells you what it is, and the middle is the part nobody reads.
 * Returns the input untouched when it already fits.
 */
export function middleTruncate(value: string, max = 44): string {
  if (value.length <= max) return value;
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  const tail = Math.floor(keep / 2);
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}
