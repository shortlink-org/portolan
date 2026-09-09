import type { ReactNode } from "react";

type CatScene = "clear" | "unchanged" | "onboarding" | "search" | "trial";

const IMAGE: Record<CatScene, string> = {
  clear: "cat-clear-skies-v1.webp",
  unchanged: "cat-no-changes-v1.webp",
  onboarding: "cat-onboarding-v1.webp",
  search: "404-cat-v1.webp",
  trial: "cat-trial-success-v1.webp",
};

export function CatIllustration({ scene, className = "" }: { scene: CatScene; className?: string }) {
  return <img src={`${import.meta.env.BASE_URL}${IMAGE[scene]}`} alt="" aria-hidden draggable={false} className={`cat-illustration ${className}`} />;
}

/** A rare, positive empty state. Ordinary missing rows keep using `Empty`. */
export function CatEmptyState({ scene, title, children, meta, className = "" }: { scene: Extract<CatScene, "clear" | "unchanged" | "onboarding">; title: string; children: ReactNode; meta?: ReactNode; className?: string }) {
  return (
    <div className={`cat-empty-state ${className}`}>
      <CatIllustration scene={scene} className="cat-empty-illustration" />
      <div className="min-w-0">
        <h2 className="text-md font-semibold text-ink">{title}</h2>
        <div className="mt-1 text-muted">{children}</div>
        {meta ? <div className="mono mt-3 text-faint">{meta}</div> : null}
      </div>
    </div>
  );
}
