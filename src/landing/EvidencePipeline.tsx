import { ArrowRight, Braces, CircleDotDashed, Code2, Network } from "lucide-react";
import { useRef } from "react";
import { useInView } from "motion/react";
import { m, useReducedMotion } from "../lib/motion";

const steps = [
  {
    icon: Code2,
    label: "01 / read",
    title: "Code and specifications",
    copy: "Existing source, schemas, contracts, ADRs and traces.",
  },
  {
    icon: Braces,
    label: "02 / extract",
    title: "Local fragments",
    copy: "Each service publishes the architectural facts it owns.",
  },
  {
    icon: CircleDotDashed,
    label: "03 / validate",
    title: "One estate model",
    copy: "Portolan merges the union and checks every relationship.",
  },
  {
    icon: Network,
    label: "04 / publish",
    title: "A static catalog",
    copy: "Browse the site or export Markdown, Mermaid and Backstage entities.",
  },
] as const;

// One shared cycle keeps the arrows in sync, including the quiet pause.
const cycle = 6.8;
const pulse = (index: number) => {
  const start = 0.4 + index * 0.85;
  return {
    duration: cycle,
    repeat: Infinity,
    ease: "easeInOut" as const,
    times: [0, start, start + 0.2, start + 0.65, start + 1.15, cycle].map(
      (time) => time / cycle,
    ),
  };
};

export function EvidencePipeline() {
  const ref = useRef<HTMLOListElement>(null);
  const inView = useInView(ref, { amount: 0.2 });
  const reduced = useReducedMotion();
  const playing = inView && !reduced;

  return (
    <ol
      ref={ref}
      aria-label="How Portolan turns evidence into architecture documentation"
      className="mt-12 grid gap-4 md:grid-cols-2 xl:grid-cols-4"
    >
      {steps.map((item, index) => {
        const Icon = item.icon;
        const continues = index < steps.length - 1;
        const connectsWithinRow = index === 0 || index === 2;

        return (
          <li
            key={item.title}
            className="relative rounded-card border border-line bg-canvas p-5 shadow-xs"
          >
            <div className="flex items-center justify-between">
              <span className="flow-tile text-accent">
                <Icon size={14} aria-hidden />
              </span>
              <span className="mono text-faint">{item.label}</span>
            </div>

            <h3 className="mt-8 text-md font-semibold">{item.title}</h3>
            <p className="mt-2 text-sm text-muted">{item.copy}</p>

            {continues ? (
              <span
                aria-hidden
                className={`absolute top-[22px] -right-[17px] z-10 h-[18px] w-4 items-center justify-center bg-canvas text-faint ${
                  connectsWithinRow ? "hidden md:flex" : "hidden xl:flex"
                }`}
              >
                <ArrowRight size={11} />
                <m.span
                  className="absolute inset-0 flex items-center justify-center text-accent drop-shadow-[0_0_4px_var(--color-accent)]"
                  initial={{ opacity: 0, x: -4 }}
                  animate={playing ? {
                    opacity: [0, 0, 1, 1, 0, 0],
                    x: [-4, -4, -2, 2, 4, 4],
                  } : { opacity: 0, x: -4 }}
                  transition={playing ? pulse(index + 0.65) : { duration: 0.2 }}
                >
                  <ArrowRight size={11} />
                </m.span>
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
