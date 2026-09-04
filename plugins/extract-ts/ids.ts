// How a name in the source becomes an id in the catalog. These are the rules
// extract-go lives by, spelled the same, so a TypeScript service and a Go
// service with the same aggregate get the same id.

/** PriceList → price-list, Address → address, ID → id, email.Address → email-address. */
export function slug(name: string): string {
  let out = "";
  const chars = [...name];
  chars.forEach((c, i) => {
    const upper = c >= "A" && c <= "Z";
    if (upper && i > 0) {
      const prev = chars[i - 1]!;
      const next = chars[i + 1];
      const prevLower = prev >= "a" && prev <= "z";
      const nextLower = next !== undefined && next >= "a" && next <= "z";
      if (prevLower || nextLower) out += "-";
    }
    let r = upper ? c.toLowerCase() : c;
    if (r === "_" || r === ".") r = "-";
    out += r;
  });
  while (out.includes("--")) out = out.replaceAll("--", "-");
  return out.replace(/^-+|-+$/g, "");
}

/** change_password → ChangePassword: the operation id a directory name becomes. */
export function camel(name: string): string {
  return name
    .split(/[_-]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join("");
}

/** price_list → Price List: the human name for a directory. */
export function title(name: string): string {
  return name
    .split(/[_-]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}

/** A directory name in PascalCase, which is what its root class is called. */
export function pascal(name: string): string {
  return camel(name);
}

export const serviceID = (context: string, service: string) => `${context}.${service}`;
export const aggregateID = (service: string, aggregate: string) => `${service}.${aggregate}`;
export const blockID = (aggregate: string, block: string) => `${aggregate}.${block}`;
export const eventID = (aggregate: string, name: string) => `${aggregate}.${name}`;
