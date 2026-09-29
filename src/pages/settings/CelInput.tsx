// A CEL text box that knows what the rule may read.
//
// Typing `event.` offers the fields of the subject, and `estate.` the
// estate's lists, filtered by what follows the dot. The list replaces the row
// of field chips the old editor had under the box: the vocabulary is where
// the cursor is, and out of sight otherwise. Arrow keys move, Enter or Tab
// takes, Escape closes; the box stays a plain textarea for everything else.
// The compile error, when there is one, sits under the box that caused it.

import { useId, useRef, useState } from "react";
import { ESTATE_SCHEMA, SUBJECTS } from "../../lib/problem-rules-cel.mjs";
import type { FieldType, RuleSubject } from "../../lib/problem-rules-cel.mjs";

export interface Suggestion {
  name: string;
  type: FieldType;
}

/**
 * What to offer at the cursor: the fields of `subject.` or `estate.` whose
 * names start with what is typed after the dot, and where that prefix
 * begins. Nothing when the cursor is not right after such a path.
 */
export function suggestionsAt(subject: RuleSubject, text: string, cursor: number): { from: number; items: Suggestion[] } | null {
  const match = /\b([A-Za-z_]\w*)\.(\w*)$/.exec(text.slice(0, cursor));
  if (!match) return null;
  const schema: Record<string, FieldType> | undefined =
    match[1] === subject ? SUBJECTS[subject].schema : match[1] === "estate" ? (ESTATE_SCHEMA as Record<string, FieldType>) : undefined;
  if (!schema) return null;
  const typed = match[2]!;
  const items = Object.entries(schema)
    .filter(([name]) => name.startsWith(typed) && name !== typed)
    .map(([name, type]) => ({ name, type }));
  return items.length > 0 ? { from: cursor - typed.length, items } : null;
}

const MAX_SHOWN = 8;

export function CelInput({
  subject,
  value,
  onChange,
  label,
  placeholder,
  error,
  rows = 2,
  readOnly = false,
}: {
  subject: RuleSubject;
  value: string;
  onChange: (next: string) => void;
  /** The accessible name; the page shows its own words beside the box. */
  label: string;
  placeholder?: string;
  error?: string | undefined;
  rows?: number;
  readOnly?: boolean;
}) {
  const box = useRef<HTMLTextAreaElement | null>(null);
  const listId = useId();
  const errorId = useId();
  const [open, setOpen] = useState<{ from: number; items: Suggestion[] } | null>(null);
  const [active, setActive] = useState(0);

  function look(text: string, cursor: number) {
    const next = suggestionsAt(subject, text, cursor);
    setOpen(next ? { from: next.from, items: next.items.slice(0, MAX_SHOWN) } : null);
    setActive(0);
  }

  function take(item: Suggestion) {
    const el = box.current;
    if (!el || !open) return;
    const cursor = el.selectionStart ?? value.length;
    const next = `${value.slice(0, open.from)}${item.name}${value.slice(cursor)}`;
    onChange(next);
    setOpen(null);
    const at = open.from + item.name.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(at, at);
    });
  }

  return (
    <div className="relative">
      <textarea
        ref={box}
        rows={rows}
        aria-label={label}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open !== null}
        aria-controls={listId}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        readOnly={readOnly}
        spellCheck={false}
        placeholder={placeholder}
        value={value}
        className={`mono block w-full resize-y rounded-control border bg-canvas px-3 py-2 text-ink outline-none focus:border-accent ${error ? "border-unresolved" : "border-line-strong"} ${readOnly ? "resize-none text-muted" : ""}`}
        onChange={(event) => {
          onChange(event.target.value);
          look(event.target.value, event.target.selectionStart ?? event.target.value.length);
        }}
        onClick={(event) => look(value, event.currentTarget.selectionStart ?? value.length)}
        onBlur={() => setOpen(null)}
        onKeyDown={(event) => {
          if (!open) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((at) => (at + 1) % open.items.length);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((at) => (at - 1 + open.items.length) % open.items.length);
          } else if (event.key === "Enter" || event.key === "Tab") {
            event.preventDefault();
            take(open.items[active]!);
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            setOpen(null);
          }
        }}
      />
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={`Fields of ${subject}`}
          className="absolute left-0 z-20 mt-1 min-w-56 overflow-hidden rounded-control border border-line bg-canvas py-1 shadow-md"
        >
          {open.items.map((item, at) => (
            <li
              key={item.name}
              id={`${listId}-${at}`}
              role="option"
              aria-selected={at === active}
              className={`mono flex cursor-pointer items-baseline justify-between gap-4 px-3 py-1 ${at === active ? "bg-surface text-ink" : "text-muted"}`}
              // Before blur, so the box does not close the list under the click.
              onMouseDown={(event) => {
                event.preventDefault();
                take(item);
              }}
              onMouseEnter={() => setActive(at)}
            >
              <span>{item.name}</span>
              <span className="text-faint">{item.type}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p id={errorId} className="mono mt-1 text-unresolved">
          {error}
        </p>
      ) : null}
    </div>
  );
}
