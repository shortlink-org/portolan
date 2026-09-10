import { ArrowRight, BookOpen, CircleDot, GitBranch, Puzzle, ShieldCheck } from "lucide-react";
import type { Variants } from "motion/react";
import { Link } from "react-router";

import { CatIllustration } from "../../components/CatIllustration";
import { m, transitions } from "../../lib/motion";
import {
  PRODUCT_ISSUES,
  PRODUCT_LICENSE,
  PRODUCT_README,
  PRODUCT_REPOSITORY,
} from "../../lib/product";
import { paths } from "../../routes";

const ABOUT_CARD_MOTION: Variants = {
  hidden: { opacity: 0, y: 8 },
  shown: {
    opacity: 1,
    y: 0,
    transition: { ...transitions.page, staggerChildren: 0.05 },
  },
  hover: {},
};

const ABOUT_COPY_MOTION: Variants = {
  hidden: { opacity: 0, y: 6 },
  shown: { opacity: 1, y: 0, transition: transitions.panel },
};

const ABOUT_CAT_MOTION: Variants = {
  hidden: { opacity: 0, x: 18, rotate: 3 },
  shown: {
    opacity: 1,
    x: 0,
    rotate: 0,
    transition: transitions.narrative,
  },
  hover: {
    y: -7,
    rotate: -2,
    scale: 1.035,
    transition: transitions.settle,
  },
};

export function AboutSettings() {
  return (
    <section>
      <div className="grid gap-grid lg:grid-cols-[minmax(0,1.25fr)_minmax(17rem,0.75fr)]">
        <m.div
          data-about-card
          className="card grid items-center gap-4 sm:grid-cols-[minmax(0,1fr)_180px]"
          variants={ABOUT_CARD_MOTION}
          initial="hidden"
          animate="shown"
          whileHover="hover"
        >
          <m.div
            className="flex flex-col items-start"
            variants={ABOUT_COPY_MOTION}
          >
            <p className="max-w-prose text-muted">
              Architecture from code and evidence. Product source,
              documentation, releases and issue tracking live in the public
              GitHub repository.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link to={paths.landing()} className="product-primary">
                Product page <ArrowRight size={15} aria-hidden />
              </Link>
              <a
                href={PRODUCT_REPOSITORY}
                target="_blank"
                rel="noreferrer"
                className="tbtn text-ink"
              >
                <GitBranch size={15} aria-hidden /> View product on GitHub
              </a>
            </div>
          </m.div>
          <m.div
            data-about-cat
            className="h-44 w-full justify-self-center sm:h-52"
            variants={ABOUT_CAT_MOTION}
          >
            <CatIllustration scene="about" className="h-full w-full" />
          </m.div>
        </m.div>
        <m.div
          className="card"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...transitions.page, delay: 0.06 }}
        >
          <div className="label mb-2">resources</div>
          <div className="divide-y divide-line">
            <Link
              to={paths.plugins()}
              className="flex items-center gap-2 py-2.5 text-muted transition-colors hover:text-ink"
            >
              <Puzzle size={15} aria-hidden className="shrink-0" />
              Plugin reference
            </Link>
            <a
              href={PRODUCT_README}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 py-2.5 text-muted transition-colors hover:text-ink"
            >
              <BookOpen size={15} aria-hidden className="shrink-0" />
              Documentation
            </a>
            <a
              href={PRODUCT_ISSUES}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 py-2.5 text-muted transition-colors hover:text-ink"
            >
              <CircleDot size={15} aria-hidden className="shrink-0" />
              Issues and feedback
            </a>
            <a
              href={PRODUCT_LICENSE}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 py-2.5 text-muted transition-colors hover:text-ink"
            >
              <ShieldCheck size={15} aria-hidden className="shrink-0" />
              MIT License
            </a>
          </div>
        </m.div>
      </div>
    </section>
  );
}
