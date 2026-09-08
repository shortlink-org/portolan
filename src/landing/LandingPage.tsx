import {
  ArrowRight,
  Braces,
  Check,
  CircleDotDashed,
  Code2,
  Database,
  FileSearch,
  GitBranch,
  Moon,
  Network,
  Search,
  ShieldCheck,
  Sun,
  Terminal,
} from "lucide-react";
import { lazy, Suspense } from "react";
import { Link } from "react-router";
import { CompassRose, Wordmark } from "../components/logo";
import { DiagramSkeleton } from "../components/DiagramSkeleton";
import { useTheme } from "../app/theme";
import { useDocumentTitle } from "../app/title";
import { catalog } from "../data";
import { m } from "../lib/motion";
import { paths } from "../routes";
import { catalogTo } from "./catalog";
import { heroColumn, heroLine, Reveal } from "./motion";
import { ProductFrame } from "./ProductFrame";
import { ProductTour } from "./ProductTour";

const REPOSITORY = "https://github.com/shortlink-org/portolan";
const exampleTo = catalogTo(paths.overview());

// The hero's map carries elk and React Flow. The words arrive first; the map
// follows a moment later into a frame that already has its height.
const HeroMap = lazy(() =>
  import("./HeroMap").then((mod) => ({ default: mod.HeroMap })),
);

function Header() {
  const { theme, toggle } = useTheme();

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-canvas/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-5 px-5 sm:px-8">
        <a href="#top" aria-label="Portolan home">
          <Wordmark size={19} />
        </a>
        <nav
          aria-label="Landing page"
          className="ml-5 hidden items-center gap-5 text-sm text-muted md:flex"
        >
          <a className="hover:text-ink" href="#product">
            Product
          </a>
          <a className="hover:text-ink" href="#how-it-works">
            How it works
          </a>
          <a className="hover:text-ink" href="#get-started">
            Get started
          </a>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={toggle}
            className="tbtn size-8 justify-center p-0"
            aria-label={`Use ${theme === "dark" ? "light" : "dark"} theme`}
          >
            {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <a
            href={REPOSITORY}
            className="tbtn hidden sm:flex"
            target="_blank"
            rel="noreferrer"
          >
            <GitBranch size={15} /> GitHub
          </a>
          <Link to={exampleTo} className="btn-accent">
            Explore example <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </header>
  );
}

function HeroDemo() {
  const services = catalog.contexts.reduce((n, c) => n + c.services.length, 0);
  const stats: Array<[number, string]> = [
    [catalog.contexts.length, "contexts"],
    [services, "services"],
    [catalog.flows.length, "flows"],
  ];

  return (
    <ProductFrame
      title="Context map · example estate"
      eyebrow="estate"
      className="landing-product-shadow"
      aside={false}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-canvas px-4 py-3">
        <div className="min-w-0">
          <div className="font-semibold text-ink">Context map</div>
          <div className="mono mt-0.5 truncate text-faint">
            one line per relationship · click a domain · double-click opens it
          </div>
        </div>
        <div className="flex gap-2">
          {stats.map(([value, label]) => (
            <div
              key={label}
              className="rounded-control border border-line bg-canvas px-2 py-1"
            >
              <span className="tnum font-semibold text-ink">{value}</span>{" "}
              <span className="mono text-faint">{label}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="relative h-[440px]">
        <Suspense fallback={<DiagramSkeleton />}>
          <HeroMap />
        </Suspense>
      </div>
    </ProductFrame>
  );
}

const inputs = [
  "Go",
  "TypeScript",
  "Java",
  "Rust",
  "Django",
  "OpenAPI",
  "GraphQL",
  "Protobuf",
  "SQL",
  "OTel",
];

const features = [
  {
    icon: Network,
    title: "One navigable model",
    copy: "Contexts, services, aggregates, APIs, events, stores and ADRs stay connected instead of becoming separate documentation islands.",
  },
  {
    icon: GitBranch,
    title: "Flows across boundaries",
    copy: "Follow behavior across HTTP, RPC, messaging, workers and persistence with the responsible source beside every step.",
  },
  {
    icon: ShieldCheck,
    title: "Declared versus verified",
    copy: "See what the code says, what traces have observed and what references still point outside the known architecture.",
  },
  {
    icon: FileSearch,
    title: "Reviewable by design",
    copy: "Generated fragments, docs and exports are ordinary files. Architecture changes can travel through the same review as code.",
  },
  {
    icon: Search,
    title: "Source-level answers",
    copy: "Open the exact file and line behind an event, field, call or flow step without leaving the architecture context.",
  },
  {
    icon: Database,
    title: "Data relationships included",
    copy: "Explore stores, tables, views, foreign keys and column lineage—including ownership violations across service boundaries.",
  },
];

const pipeline = [
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
];

export function LandingPage() {
  useDocumentTitle("Architecture from code");

  return (
    <div className="h-full overflow-y-auto scroll-smooth bg-canvas text-ink">
      <Header />
      <main id="top">
        <section className="landing-hero relative overflow-hidden border-b border-line">
          <div className="landing-orbit landing-orbit-one" aria-hidden />
          <div className="landing-orbit landing-orbit-two" aria-hidden />
          <div className="relative mx-auto grid max-w-[1200px] items-center gap-14 px-5 py-20 sm:px-8 sm:py-28 lg:grid-cols-[minmax(0,0.92fr)_minmax(500px,1.08fr)] lg:py-32">
            <m.div
              className="max-w-[680px]"
              variants={heroColumn}
              initial="hidden"
              animate="shown"
            >
              <m.div
                variants={heroLine}
                className="mono mb-6 flex items-center gap-2 text-accent"
              >
                <CompassRose size={15} />
                ARCHITECTURE CATALOG
              </m.div>
              <m.h1
                variants={heroLine}
                className="max-w-[760px] text-[clamp(3rem,6.4vw,5.8rem)] leading-[0.96] font-semibold tracking-[-0.055em] text-ink"
              >
                Your architecture, read from the code.
              </m.h1>
              <m.p
                variants={heroLine}
                className="mt-7 max-w-[620px] text-[17px] leading-7 text-muted sm:text-[19px] sm:leading-8"
              >
                Portolan turns code, specifications, schemas, traces and ADRs
                into a static, navigable map of your software estate.
              </m.p>
              <m.div
                variants={heroLine}
                className="mt-8 flex flex-wrap items-center gap-3"
              >
                <Link to={exampleTo} className="btn-accent px-4 py-2.5">
                  Explore example catalog <ArrowRight size={15} />
                </Link>
                <a
                  href="#get-started"
                  className="tbtn px-4 py-2.5 text-ink"
                >
                  <Terminal size={15} /> Get started
                </a>
              </m.div>
              <m.div
                variants={heroLine}
                className="mono mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-faint"
              >
                <span className="flex items-center gap-1.5">
                  <Check size={12} className="text-verified" /> no backend
                </span>
                <span className="flex items-center gap-1.5">
                  <Check size={12} className="text-verified" /> static output
                </span>
                <span className="flex items-center gap-1.5">
                  <Check size={12} className="text-verified" /> reviewable in git
                </span>
              </m.div>
            </m.div>
            <m.div
              className="relative mx-auto w-full max-w-[650px] lg:translate-x-5"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.2, 0, 0, 1], delay: 0.25 }}
            >
              <HeroDemo />
            </m.div>
          </div>
        </section>

        <section aria-label="Supported inputs" className="border-b border-line">
          <div className="mx-auto flex max-w-[1200px] flex-col gap-5 px-5 py-7 sm:px-8 lg:flex-row lg:items-center">
            <div className="mono shrink-0 text-faint">
              READS WHAT ALREADY EXISTS
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-2 lg:ml-auto lg:justify-end">
              {inputs.map((input) => (
                <span key={input} className="mono text-muted">
                  {input}
                </span>
              ))}
            </div>
          </div>
        </section>

        <section id="product" className="scroll-mt-20 border-b border-line">
          <div className="mx-auto max-w-[1200px] px-5 py-20 sm:px-8 sm:py-28">
            <Reveal className="mb-12 max-w-[720px]">
              <div className="label text-accent">THE PRODUCT</div>
              <h2 className="mt-4 text-[clamp(2rem,4vw,3.75rem)] leading-[1.04] font-semibold tracking-[-0.04em]">
                Start wide. Follow the evidence all the way down.
              </h2>
              <p className="mt-5 max-w-[650px] text-[17px] leading-7 text-muted">
                The catalog is not a poster. Every map, relationship and health
                signal leads to the entity, contract and source that produced
                it.
              </p>
            </Reveal>
            <Reveal delay={0.08}>
              <ProductTour />
            </Reveal>
          </div>
        </section>

        <section id="how-it-works" className="scroll-mt-20 border-b border-line bg-surface/40">
          <div className="mx-auto max-w-[1200px] px-5 py-20 sm:px-8 sm:py-28">
            <Reveal className="max-w-[760px]">
              <div className="label text-accent">HOW IT WORKS</div>
              <h2 className="mt-4 text-[clamp(2rem,4vw,3.75rem)] leading-[1.04] font-semibold tracking-[-0.04em]">
                Architecture documentation that begins with evidence.
              </h2>
            </Reveal>
            <div className="mt-12 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {pipeline.map((item, index) => {
                const Icon = item.icon;
                return (
                  <Reveal
                    key={item.title}
                    delay={index * 0.07}
                    className="relative rounded-card border border-line bg-canvas p-5 shadow-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="flow-tile text-accent">
                        <Icon size={14} />
                      </span>
                      <span className="mono text-faint">{item.label}</span>
                    </div>
                    <h3 className="mt-8 text-md font-semibold">{item.title}</h3>
                    <p className="mt-2 text-sm text-muted">{item.copy}</p>
                    {index < pipeline.length - 1 ? (
                      <ArrowRight
                        size={16}
                        className="absolute top-1/2 -right-[11px] z-10 hidden -translate-y-1/2 rounded-full bg-canvas text-faint xl:block"
                        aria-hidden
                      />
                    ) : null}
                  </Reveal>
                );
              })}
            </div>
          </div>
        </section>

        <section className="border-b border-line">
          <div className="mx-auto max-w-[1200px] px-5 py-20 sm:px-8 sm:py-28">
            <Reveal className="grid items-end gap-5 md:grid-cols-2">
              <div>
                <div className="label text-accent">ONE CONNECTED VIEW</div>
                <h2 className="mt-4 max-w-[700px] text-[clamp(2rem,4vw,3.75rem)] leading-[1.04] font-semibold tracking-[-0.04em]">
                  Read the system, not six disconnected inventories.
                </h2>
              </div>
              <p className="max-w-[520px] text-[17px] leading-7 text-muted md:justify-self-end">
                Domain structure, runtime relationships and persistence stay in
                one model, while deeper tools remain one click away.
              </p>
            </Reveal>
            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((feature, index) => {
                const Icon = feature.icon;
                return (
                  <Reveal
                    key={feature.title}
                    delay={(index % 3) * 0.07}
                    className="rounded-card border border-line p-5 transition-colors hover:border-line-strong hover:bg-surface"
                  >
                    <span className="flow-tile text-accent">
                      <Icon size={14} />
                    </span>
                    <h3 className="mt-7 text-md font-semibold">
                      {feature.title}
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-muted">
                      {feature.copy}
                    </p>
                  </Reveal>
                );
              })}
            </div>
          </div>
        </section>

        <section id="get-started" className="scroll-mt-20 border-b border-line">
          <div className="mx-auto grid max-w-[1200px] items-center gap-12 px-5 py-20 sm:px-8 sm:py-28 lg:grid-cols-[minmax(0,0.9fr)_minmax(440px,1.1fr)]">
            <Reveal>
              <div className="label text-accent">GET STARTED</div>
              <h2 className="mt-4 text-[clamp(2rem,4vw,3.75rem)] leading-[1.04] font-semibold tracking-[-0.04em]">
                Point Portolan at a repository.
              </h2>
              <p className="mt-5 max-w-[580px] text-[17px] leading-7 text-muted">
                The initializer detects projects and specifications, proposes a
                manifest, and keeps generated artifacts beside the code they
                describe.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link to={exampleTo} className="btn-accent px-4 py-2.5">
                  Open the example <ArrowRight size={15} />
                </Link>
                <a
                  href={`${REPOSITORY}#use-it-in-your-project`}
                  className="tbtn px-4 py-2.5 text-ink"
                  target="_blank"
                  rel="noreferrer"
                >
                  Read the guide
                </a>
              </div>
            </Reveal>
            <Reveal
              delay={0.1}
              className="overflow-hidden rounded-[14px] border border-line bg-[#090c10] shadow-md"
            >
              <div className="flex h-11 items-center gap-1.5 border-b border-white/10 px-4">
                <span className="size-2 rounded-full bg-white/15" />
                <span className="size-2 rounded-full bg-white/15" />
                <span className="size-2 rounded-full bg-white/15" />
                <span className="mono ml-auto text-white/35">terminal</span>
              </div>
              <pre className="overflow-x-auto p-5 text-[13px] leading-7 text-white/75 sm:p-7"><code><span className="text-white/35">$</span> npx @shortlink-org/portolan init{"\n"}<span className="text-white/35">$</span> npm install --save-dev @shortlink-org/portolan{"\n"}<span className="text-white/35">$</span> npx portolan generate{"\n"}<span className="text-white/35">$</span> npx portolan dev{"\n\n"}<span className="text-[#72d5c4]">✓</span> catalog merged and validated{"\n"}<span className="text-[#72d5c4]">✓</span> site ready at http://localhost:5173</code></pre>
            </Reveal>
          </div>
        </section>

        <section className="landing-final relative overflow-hidden">
          <Reveal className="mx-auto max-w-[920px] px-5 py-24 text-center sm:px-8 sm:py-32">
            <CompassRose size={28} className="mx-auto text-accent" />
            <h2 className="mt-7 text-[clamp(2.4rem,5vw,4.8rem)] leading-[1] font-semibold tracking-[-0.05em]">
              Make the architecture explorable.
            </h2>
            <p className="mx-auto mt-5 max-w-[600px] text-[17px] leading-7 text-muted">
              Give every diagram, flow and dependency a path back to the code
              that made it true.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link to={exampleTo} className="btn-accent px-4 py-2.5">
                Explore example catalog <ArrowRight size={15} />
              </Link>
              <a
                href={REPOSITORY}
                target="_blank"
                rel="noreferrer"
                className="tbtn px-4 py-2.5 text-ink"
              >
                <GitBranch size={15} /> View on GitHub
              </a>
            </div>
          </Reveal>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-4 px-5 py-7 text-sm text-muted sm:flex-row sm:items-center sm:px-8">
          <Wordmark />
          <span className="sm:ml-3">Architecture from code and evidence.</span>
          <div className="flex gap-5 sm:ml-auto">
            <a className="hover:text-ink" href={`${REPOSITORY}#readme`}>
              Docs
            </a>
            <a className="hover:text-ink" href={`${REPOSITORY}/blob/main/LICENSE`}>
              MIT License
            </a>
            <a className="hover:text-ink" href={REPOSITORY}>
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
