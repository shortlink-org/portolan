import type { ReactNode } from "react";

export function PageHeader({
  kind,
  name,
  id,
  right,
  children,
}: {
  kind: string;
  name: string;
  id?: string;
  right?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="border-b border-line px-4 py-3">
      <div className="label">{kind}</div>
      <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-[15px] font-semibold">{name}</h1>
        {id ? <span className="mono text-muted">{id}</span> : null}
        {right ? (
          <div className="ml-auto flex items-center gap-2">{right}</div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export function SectionTitle({
  children,
  right,
}: {
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <h2 className="label">{children}</h2>
      {right ? <div className="ml-auto">{right}</div> : null}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
