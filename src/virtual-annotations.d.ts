declare module "virtual:portolan-annotations" {
  const value: { entries: import("./catalog-model").CatalogAnnotation[]; stamps: Record<string, { commit: string; generatedAt: string }>; error: string | null };
  export default value;
}
