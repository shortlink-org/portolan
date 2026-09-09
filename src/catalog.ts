// Stable public surface for the catalog contract. The data model, derived
// indexes, and validation rules live separately so changing one concern does
// not make every other concern part of the same file.

export * from "./catalog-model.ts";
export * from "./catalog-index.ts";
export * from "./catalog-validation.ts";
