export type PortolanUpdate = {
  current: string;
  latest: string;
};

declare const __PORTOLAN_UPDATE__: PortolanUpdate | null | undefined;

// The value exists only for `portolan dev`. Static builds and tests have no
// registry check to report and therefore render no update notice.
export const portolanUpdate: PortolanUpdate | null =
  typeof __PORTOLAN_UPDATE__ === "undefined" ? null : __PORTOLAN_UPDATE__;
