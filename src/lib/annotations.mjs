// Shared by Node authoring, generators and browser rendering. No Node imports.
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v, max = 200) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const only = (v, keys) => Object.keys(v).every((key) => keys.includes(key));
export const PROPERTY_TYPES = ["link", "text", "number", "boolean", "tags", "json"];
export const LINK_PURPOSES = ["runbook", "dashboard", "documentation", "repository", "generic"];
export function safePropertyUrl(value) {
  if (typeof value !== "string" || value.length > 4096) return false;
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
}
export function annotationTargetKey(target) { return `${target.kind}:${target.id}`; }
export function annotationTargetExists(catalog, target) {
  return (catalog.contexts ?? []).some((context) => target.kind === "context"
    ? context.id === target.id
    : (context.services ?? []).some((service) => service.id === target.id));
}
export function propertyError(property) {
  if (!object(property) || !text(property.label)) return "A property needs a label (up to 200 characters).";
  if (property.group !== undefined && !text(property.group, 100)) return "Group must be a non-empty name (up to 100 characters).";
  if (!only(property, ["type", "label", "group", "value", ...(property.type === "number" ? ["unit"] : [])])) return "Unknown property field.";
  const v = property.value;
  switch (property.type) {
    case "link": return object(v) && only(v, ["url", "label", "purpose"]) && safePropertyUrl(v.url) && text(v.label) && LINK_PURPOSES.includes(v.purpose) ? null : "A link needs a title, an http/https URL without credentials, and a supported purpose.";
    case "text": return typeof v === "string" && v.length <= 20000 ? null : "Text must be at most 20,000 characters.";
    case "number": return typeof v === "number" && Number.isFinite(v) && (property.unit === undefined || text(property.unit, 40)) ? null : "Enter a finite number and an optional unit (up to 40 characters).";
    case "boolean": return typeof v === "boolean" ? null : "Choose Yes or No.";
    case "tags": return Array.isArray(v) && v.length <= 100 && v.every((tag) => text(tag)) ? null : "Use up to 100 non-empty tags.";
    case "json": {
      const valid = (value, depth = 0) => depth <= 20 && (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value) || Array.isArray(value) && value.every((child) => valid(child, depth + 1)) || object(value) && Object.values(value).every((child) => valid(child, depth + 1)));
      return (object(v) || Array.isArray(v)) && valid(v) && JSON.stringify(v).length <= 20000 ? null : "Use a JSON object or array, up to 20,000 characters and 20 levels deep.";
    }
    default: return "Unsupported property type.";
  }
}
export function validateAnnotationDocument(doc) {
  if (!object(doc) || !only(doc, ["version", "catalog", "target", "properties", "order"]) || doc.version !== 1 || typeof doc.catalog !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(doc.catalog)) throw new Error("Invalid annotation document or catalog id.");
  if (!object(doc.target) || !only(doc.target, ["kind", "id"]) || !["service", "context"].includes(doc.target.kind) || !text(doc.target.id, 300)) throw new Error("Choose a service or context target.");
  if (!object(doc.properties) || Object.keys(doc.properties).length > 100) throw new Error("Use up to 100 properties per resource.");
  for (const [key, property] of Object.entries(doc.properties)) {
    if (!/^x-[a-z0-9][a-z0-9-]{0,98}$/.test(key)) throw new Error(`Invalid property key ${JSON.stringify(key)}; use x- followed by lowercase letters, numbers or hyphens.`);
    const error = propertyError(property); if (error) throw new Error(`${key}: ${error}`);
  }
  if (!Array.isArray(doc.order) || doc.order.length !== Object.keys(doc.properties).length || new Set(doc.order).size !== doc.order.length || doc.order.some((key) => typeof key !== "string" || !Object.hasOwn(doc.properties, key))) throw new Error("Property order must contain each key exactly once.");
  return doc;
}
export function validateCatalogAnnotations(annotations) {
  if (!Array.isArray(annotations)) throw new Error("Annotations must be a list.");
  const seen = new Set();
  for (const entry of annotations) {
    const { source, basis, unresolved, ...doc } = entry;
    validateAnnotationDocument(doc);
    if (!text(source, 1000) || source.startsWith("/") || source.includes("\\") || source.split("/").includes("..") || basis !== "declared" || (unresolved !== undefined && typeof unresolved !== "boolean")) throw new Error("Invalid annotation provenance.");
    const key = `${doc.catalog}:${annotationTargetKey(doc.target)}`;
    if (seen.has(key)) throw new Error(`Duplicate annotations for ${key}. Resolve the source files.`);
    seen.add(key);
  }
}
export function applyAnnotations(catalog, annotations, profile) {
  validateCatalogAnnotations(annotations);
  const entries = annotations.filter((entry) => !profile || entry.catalog === profile).map((entry) => {
    const { unresolved: _, ...rest } = entry;
    return { ...rest, ...(!annotationTargetExists(catalog, entry.target) ? { unresolved: true } : {}) };
  });
  if (!entries.length) return catalog;
  const combined = [...(catalog.annotations ?? []), ...entries];
  validateCatalogAnnotations(combined);
  return { ...catalog, annotations: combined };
}
