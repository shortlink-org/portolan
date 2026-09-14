// A picker that looks like the rest of the app.
//
// A native <select> is a control the operating system draws: a different font,
// a different radius, a different focus ring and, on macOS, a popup that
// ignores the dark theme entirely. Two of them sat in the middle of pages
// otherwise built out of six radii and one border colour, and both were the
// only place where the app stopped looking like itself.
//
// The behaviour is Headless UI's Listbox and the paint is ours. That division
// is the whole point of the dependency: the ARIA wiring, the focus return, the
// typeahead, the scroll-into-view and the outside-click are a listbox's boring
// half and are the half that is easy to get subtly wrong, while the part this
// app actually cares about - that a control is `.tbtn` and a popup is a
// hairline on --bg - stays here, in tokens, where every other control keeps it.
//
// Positioning comes with it: `anchor` puts the panel under the button and
// flips it to the other edge when the button is near the side of the window.
// A picker in a page header's right slot has no room to its right, and a panel
// that opens off the edge does not clip - it widens the pane and scrolls the
// whole page sideways.

import {
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
} from "@headlessui/react";
import { Check, ChevronDown } from "lucide-react";

export interface SelectOption {
  value: string;
  label: string;
  /** Second line, for the options that need saying rather than naming. */
  note?: string;
}

export function Select({
  value,
  options,
  onChange,
  label,
  title,
  className = "",
  menuWidth,
  disabled = false,
  appearance = "compact",
}: {
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  /** Accessible name. Rendered by the caller when it is visible. */
  label: string;
  title?: string;
  className?: string;
  /** Width of the panel. Defaults to "as wide as the button, at least 160px". */
  menuWidth?: number;
  disabled?: boolean;
  /** A roomier picker with option notes, matching the Buf version picker. */
  appearance?: "compact" | "detail";
}) {
  const selected = options.find((o) => o.value === value);
  const detailed = appearance === "detail";

  return (
    <Listbox value={value} onChange={onChange} disabled={disabled}>
      {/* Open state comes back as a render prop rather than a `data-open:`
          variant: `.tbtn-on` is a component class, and Tailwind variants
          compose utilities, not those. */}
      <ListboxButton
        aria-label={label}
        title={title ?? label}
        className={({ open }) =>
          detailed
            ? `group flex items-center justify-between gap-2 rounded-control border bg-canvas px-3 py-1.5 shadow-xs outline-none transition-colors ${
              open
                ? "border-accent text-ink"
                : "border-line text-muted hover:border-line-strong hover:bg-surface"
            } ${className}`
            : `tbtn justify-between gap-1.5 ${open ? "tbtn-on" : ""} ${className}`
        }
      >
        {({ open }) => (
          <>
            <span className="min-w-0 truncate">{selected?.label ?? value}</span>
            <ChevronDown
              size={13}
              aria-hidden
              className="shrink-0 t-micro transition-transform"
              style={{ transform: open ? "rotate(180deg)" : "none" }}
            />
          </>
        )}
      </ListboxButton>

      <ListboxOptions
        aria-label={label}
        /* `padding` is the gap the panel keeps from the window edge; below it
           Floating UI flips the panel to the button's other side rather than
           letting it hang off the page. */
        anchor={{ to: "bottom start", gap: 4, padding: 8 }}
        className={detailed
          ? "palette-in z-50 max-h-72 overflow-y-auto rounded-card border bg-canvas p-1.5 border-line-strong shadow-md focus:outline-none"
          : "palette-in z-50 max-h-64 overflow-y-auto rounded-control border bg-canvas py-1 border-line-strong shadow-md focus:outline-none"}
        style={{ ...(menuWidth ? { width: menuWidth } : { minWidth: 160 }), maxWidth: "calc(100vw - 1rem)" }}
      >
        {options.map((option) => (
          <ListboxOption
            key={option.value}
            value={option.value}
            className={({ focus }) =>
              detailed
                ? `mono flex cursor-pointer items-start gap-2.5 rounded-control px-2.5 py-2 outline-none ${focus ? "bg-raised" : ""}`
                : `mono flex cursor-pointer items-start gap-2 px-2 py-1 ${focus ? "bg-raised" : ""}`
            }
          >
            {({ selected: on }) => (
              <>
                {detailed ? (
                  <span
                    aria-hidden
                    className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border ${
                      on ? "border-accent bg-accent" : "border-line-strong text-transparent"
                    }`}
                  >
                    <Check size={10} strokeWidth={3} style={on ? { color: "var(--bg)" } : undefined} />
                  </span>
                ) : (
                  <Check
                    size={12}
                    aria-hidden
                    className="mt-0.5 shrink-0"
                    style={{ opacity: on ? 1 : 0, color: "var(--accent)" }}
                  />
                )}
                <span
                  className="min-w-0"
                  style={on ? { color: "var(--accent)" } : undefined}
                >
                  <span className="block truncate">{option.label}</span>
                  {option.note ? (
                    <span className={`block text-muted ${detailed ? "whitespace-normal" : "truncate"}`}>
                      {option.note}
                    </span>
                  ) : null}
                </span>
              </>
            )}
          </ListboxOption>
        ))}
      </ListboxOptions>
    </Listbox>
  );
}
