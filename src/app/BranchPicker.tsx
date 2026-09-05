import {
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
} from "@headlessui/react";
import { Check, ChevronDown, ExternalLink, GitBranch } from "lucide-react";
import { useEffect } from "react";
import { useSearchParams } from "react-router";
import { branchCompareHref } from "../lib/branch-compare";
import { buildInfo } from "../lib/build-info";
import type { BranchInfo } from "../lib/build-info";
import { relativeTime } from "../lib/format";

const COMPARE_PARAM = "compare";
const MEMORY_KEY = "portolan:compare-branch";

function rememberedBranch(): string {
  try {
    return sessionStorage.getItem(MEMORY_KEY) ?? "";
  } catch {
    return "";
  }
}

function rememberBranch(branch: string): void {
  try {
    if (branch) sessionStorage.setItem(MEMORY_KEY, branch);
    else sessionStorage.removeItem(MEMORY_KEY);
  } catch {
    // URL state still works where storage is unavailable.
  }
}

function note(branch: BranchInfo, current: string): string {
  const parts = [];
  if (branch.name === current) parts.push("current catalog");
  if (branch.commit) parts.push(branch.commit);
  if (branch.committedAt) parts.push(relativeTime(branch.committedAt));
  return parts.join(" · ") || "branch";
}

/**
 * Selects the base branch for the product's comparison mode. The catalog on
 * screen remains the build's head branch; `?compare=` is deliberately URL
 * state so the coming diff view is linkable and survives navigation/reload.
 */
export function BranchPicker({ compact = false }: { compact?: boolean }) {
  const [search, setSearch] = useSearchParams();
  const current = buildInfo.branch || buildInfo.branches[0]?.name || "current";
  const branches = buildInfo.branches.length > 0
    ? buildInfo.branches
    : [{ name: current, commit: buildInfo.shortCommit, committedAt: buildInfo.builtAt }];
  const requested = search.get(COMPARE_PARAM) ?? rememberedBranch();
  const selected = branches.some((branch) => branch.name === requested)
    ? requested
    : current;
  const comparing = selected !== current;
  const compareHref = branchCompareHref(selected, current);

  // Most catalog links own their own query parameters and should not need to
  // know comparison mode exists. Restore the selected base after navigation;
  // this also leaves every resulting location copyable as a complete URL.
  useEffect(() => {
    if (!comparing || search.has(COMPARE_PARAM)) return;
    const next = new URLSearchParams(search);
    next.set(COMPARE_PARAM, selected);
    setSearch(next, { replace: true });
  }, [comparing, search, selected, setSearch]);

  const choose = (name: string) => {
    const next = new URLSearchParams(search);
    if (name === current) {
      next.delete(COMPARE_PARAM);
      rememberBranch("");
    } else {
      next.set(COMPARE_PARAM, name);
      rememberBranch(name);
    }
    setSearch(next, { replace: true });
  };

  return (
    <Listbox value={selected} onChange={choose}>
      <ListboxButton
        aria-label={comparing ? `Compare ${current} against ${selected}` : `Branch ${current}`}
        title={comparing ? `${current} compared with ${selected}` : `Branch ${current}`}
        className={({ open }) =>
          compact
            ? `flex size-8 shrink-0 items-center justify-center rounded-control border t-micro transition-colors border-line hover:bg-surface ${open || comparing ? "text-accent" : "text-muted hover:text-ink"}`
            : `mono flex max-w-56 shrink-0 items-center gap-1.5 rounded-control border px-2 py-1.5 t-micro transition-colors ${open || comparing ? "border-accent text-accent" : "border-line text-muted hover:border-line-strong hover:bg-surface hover:text-ink"}`
        }
      >
        {({ open }) => (
          <>
            <GitBranch size={16} aria-hidden className="shrink-0" />
            {!compact ? (
              <span className="min-w-0 truncate">
                {comparing ? `${current} ← ${selected}` : current}
              </span>
            ) : null}
            {!compact ? (
              <ChevronDown
                size={13}
                aria-hidden
                className={`shrink-0 t-micro transition-transform ${open ? "rotate-180" : ""}`}
              />
            ) : null}
          </>
        )}
      </ListboxButton>

      <ListboxOptions
        aria-label="Comparison base branch"
        anchor={{ to: "bottom end", gap: 4, padding: 8 }}
        className="branch-options palette-in z-50 w-80 overflow-y-auto rounded-control border bg-canvas py-1 border-line-strong shadow-md focus:outline-none"
      >
        <div className="label px-3 pt-2 pb-1">compare {current} against</div>
        {branches.map((branch) => (
          <ListboxOption
            key={branch.name}
            value={branch.name}
            className={({ focus }) =>
              `mono flex cursor-pointer items-start gap-2 px-3 py-2 ${focus ? "bg-raised" : ""}`
            }
          >
            {({ selected: on }) => (
              <>
                <Check size={13} aria-hidden className="mt-0.5 shrink-0 text-accent" style={{ opacity: on ? 1 : 0 }} />
                <span className="min-w-0 flex-1">
                  <span className={`block truncate ${on ? "text-accent" : "text-ink"}`}>{branch.name}</span>
                  <span className="block truncate text-muted">{note(branch, current)}</span>
                </span>
              </>
            )}
          </ListboxOption>
        ))}
        <div className="sticky bottom-0 mt-1 border-t border-line bg-canvas px-3 py-2">
          {compareHref ? (
            <a href={compareHref} target="_blank" rel="noreferrer" className="mono flex items-center gap-1.5 rounded-control text-accent hover:underline">
              open this comparison on the forge <ExternalLink size={12} aria-hidden />
            </a>
          ) : (
            <span className="mono text-muted">Choose another branch as the comparison base.</span>
          )}
        </div>
      </ListboxOptions>
    </Listbox>
  );
}
