import type { AnnotationDocument, CustomProperty } from "../catalog";
import { propertyError, validateAnnotationDocument } from "./annotations.mjs";

export interface PropertyDraft {
  key: string;
  type: CustomProperty["type"];
  label: string;
  group: string;
  value: string;
  url: string;
  purpose: Extract<CustomProperty, { type: "link" }>["value"]["purpose"];
  unit: string;
  checked: boolean;
}
export function propertyDraft(key: string | null, property?: CustomProperty, type: CustomProperty["type"] = "text"): PropertyDraft {
  return {
    key: key ?? "x-", type: property?.type ?? type, label: property?.label ?? "", group: property?.group ?? "",
    value: !property ? "" : property.type === "link" ? property.value.label : property.type === "tags" ? property.value.join(", ") : property.type === "json" ? JSON.stringify(property.value, null, 2) : String(property.value),
    url: property?.type === "link" ? property.value.url : "", purpose: property?.type === "link" ? property.value.purpose : "generic",
    unit: property?.type === "number" ? property.unit ?? "" : "", checked: property?.type === "boolean" ? property.value : false,
  };
}
export function draftProperty(draft: PropertyDraft): CustomProperty {
  let value: unknown = draft.value;
  if (draft.type === "number") {
    if (!draft.value.trim()) throw new Error("Enter a number; zero is a valid value.");
    value = Number(draft.value);
  }
  if (draft.type === "boolean") value = draft.checked;
  if (draft.type === "tags") value = draft.value.split(",").map((v) => v.trim()).filter(Boolean);
  if (draft.type === "link") value = { url: draft.url.trim(), label: draft.value.trim() || draft.label.trim(), purpose: draft.purpose };
  if (draft.type === "json") { try { value = JSON.parse(draft.value); } catch { throw new Error("Enter valid JSON."); } }
  const property = { label: draft.label.trim(), type: draft.type, value, ...(draft.group.trim() ? { group: draft.group.trim() } : {}), ...(draft.type === "number" && draft.unit.trim() ? { unit: draft.unit.trim() } : {}) };
  const error = propertyError(property);
  if (error) throw new Error(error);
  return property as CustomProperty;
}
export function editPropertyDocument(base: AnnotationDocument, draft: PropertyDraft, originalKey: string | null, remove = false): AnnotationDocument {
  const next = structuredClone(base);
  if (remove) {
    if (!originalKey) throw new Error("Choose an existing property to remove.");
    delete next.properties[originalKey]; next.order = next.order.filter((key) => key !== originalKey);
  } else {
    const key = draft.key.trim();
    if (Object.hasOwn(next.properties, key) && key !== originalKey) throw new Error("That property key already exists.");
    if (originalKey && originalKey !== key) { delete next.properties[originalKey]; next.order = next.order.map((k) => k === originalKey ? key : k); }
    next.properties[key] = draftProperty(draft);
    if (!next.order.includes(key)) next.order.push(key);
  }
  return validateAnnotationDocument(next);
}
