declare const __PROJECT_PREVIEW__: boolean | undefined;

/** True only for the temporary site served from an isolated onboarding trial. */
export const projectPreview =
  typeof __PROJECT_PREVIEW__ === "undefined" ? false : __PROJECT_PREVIEW__;
