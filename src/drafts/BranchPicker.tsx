// The branch a new draft is made of: searchable, newest first, each with the
// subject and age of its last commit, and the stale ones kept out of the way
// until they are searched for or asked for (PORTOLAN-23).

import { Combobox, ComboboxButton, ComboboxInput, ComboboxOption, ComboboxOptions, Description, Field, Label } from "@headlessui/react";
import { Check, ChevronDown, LoaderCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { relativeTime } from "../lib/format";
import { STALE_AFTER_DAYS, arrangeBranches, isStale } from "./branch-picker";
import type { BranchChoice } from "./model";

const plural = (n: number, one: string, many = `${one}es`) => `${n} ${n === 1 ? one : many}`;

export function BranchPicker({
  choices,
  value,
  onChange,
  disabled,
  main,
  now: fixed,
}: {
  choices: BranchChoice[];
  value: BranchChoice | undefined;
  onChange: (branch: string) => void;
  disabled: boolean;
  /** The main a branch without its own is ahead of. */
  main: string;
  /** The moment ages are measured from; a test pins it. */
  now?: Date;
}) {
  const [query, setQuery] = useState("");
  const [showStale, setShowStale] = useState(false);
  const [mounted] = useState(() => new Date());
  const now = fixed ?? mounted;
  const list = useMemo(() => arrangeBranches(choices, { query, now, showStale }), [choices, query, now, showStale]);
  const searching = query.trim() !== "";

  return (
    // `contents`: the field lays out as its two children in the form's row -
    // the input beside the other pickers, the note on a line of its own under
    // them - while Field still ties the label and the note to the input.
    <Field className="contents" disabled={disabled}>
      <div className="flex w-full min-w-0 flex-col gap-1 sm:w-[28rem]">
        <Label className="label">branch</Label>
        <Combobox
          value={value ?? null}
          by="branch"
          onChange={(next: BranchChoice | null) => {
            if (next) onChange(next.branch);
            setQuery("");
          }}
          onClose={() => setQuery("")}
          disabled={disabled}
          immediate
        >
          <div className="relative min-w-0">
            <ComboboxInput
              displayValue={(choice: BranchChoice | null) => choice?.branch ?? ""}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search branches"
              spellCheck={false}
              autoComplete="off"
              className="mono w-full min-w-0 rounded-control border border-line bg-canvas py-1.5 pr-9 pl-2 text-sm text-ink outline-none focus:border-accent disabled:opacity-60"
            />
            <ComboboxButton aria-label="Show branches" className="tbtn absolute inset-y-1 right-1 px-1.5">
              <ChevronDown size={14} aria-hidden />
            </ComboboxButton>
          </div>
          <ComboboxOptions
            aria-label="Branches, newest commit first"
            anchor={{ to: "bottom start", gap: 4, padding: 8 }}
            className="palette-in z-50 max-h-80 overflow-y-auto rounded-card border border-line-strong bg-canvas p-1.5 shadow-md focus:outline-none"
            style={{ width: "max(var(--input-width), 26rem)", maxWidth: "calc(100vw - 1rem)" }}
          >
            {list.shown.map((choice) => (
              <ComboboxOption key={choice.branch} value={choice} className="group flex cursor-pointer gap-2 rounded-control px-2.5 py-2 data-focus:bg-raised">
                <Check size={13} aria-hidden className="mt-1 shrink-0 text-accent invisible group-data-selected:visible" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-3">
                    <span className="mono min-w-0 flex-1 text-sm break-all text-ink">{choice.branch}</span>
                    {choice.date ? (
                      <time dateTime={choice.date} className="mono tnum shrink-0 text-xs text-muted">
                        {relativeTime(choice.date, now)}
                      </time>
                    ) : null}
                  </span>
                  {choice.subject ? <span className="mt-0.5 line-clamp-2 block text-xs break-words text-muted">{choice.subject}</span> : null}
                  <span className="mono mt-0.5 block text-xs text-faint">
                    {choice.tip} · {choice.ahead} ahead of {choice.main ?? main}
                    {isStale(choice, now) ? " · stale" : ""}
                  </span>
                </span>
              </ComboboxOption>
            ))}
            {list.shown.length === 0 ? (
              <div className="px-2.5 py-2 text-sm text-muted">
                {searching ? <>No branch name or last commit matches “{query.trim()}”.</> : "Every branch here is stale. Show them below the field, or search by name."}
              </div>
            ) : null}
          </ComboboxOptions>
        </Combobox>
      </div>
      <Description as="p" aria-live="polite" className="order-last basis-full text-xs text-muted">
        {searching ? (
          <>
            {list.shown.length} of {plural(choices.length, "branch")} match, stale ones included.
          </>
        ) : (
          <>
            Newest commit first.{" "}
            {list.stale === 0 ? (
              <>Every branch has a commit in the last {STALE_AFTER_DAYS} days.</>
            ) : showStale ? (
              <>
                Showing all {plural(choices.length, "branch")}, {list.stale} with no commit in the last {STALE_AFTER_DAYS} days.{" "}
                <button type="button" aria-pressed="true" onClick={() => setShowStale(false)} className="text-accent hover:underline">
                  Hide stale
                </button>
              </>
            ) : (
              <>
                {plural(list.hidden, "branch")} with no commit in the last {STALE_AFTER_DAYS} days {list.hidden === 1 ? "is" : "are"} hidden.{" "}
                <button type="button" aria-pressed="false" onClick={() => setShowStale(true)} className="text-accent hover:underline">
                  Show {list.hidden} stale
                </button>
              </>
            )}
          </>
        )}
      </Description>
    </Field>
  );
}

/**
 * What stands where the pickers will be while dev lists the branches: every
 * branch of every repository is read, which takes seconds on a large one, and
 * the form keeps its shape meanwhile rather than arriving all at once.
 */
export function BranchPickerLoading() {
  return (
    <div role="status" className="mt-3 flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <span className="label">project</span>
        <span className="h-[34px] w-40 rounded-control border border-line bg-canvas opacity-60" aria-hidden />
      </div>
      <div className="flex w-full min-w-0 flex-col gap-1 sm:w-[28rem]">
        <span className="label">branch</span>
        <span className="mono flex h-[34px] items-center gap-2 rounded-control border border-line bg-canvas px-2 text-sm text-muted">
          <LoaderCircle size={13} aria-hidden className="shrink-0 motion-safe:animate-spin" /> Reading the branches…
        </span>
      </div>
      <p className="basis-full text-xs text-muted">Every branch of each repository is read once; a repository with hundreds of branches takes a few seconds.</p>
    </div>
  );
}
