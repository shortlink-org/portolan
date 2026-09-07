// Which column the rows fold under.
//
// Only offered where a chip-set is: a column worth filtering by is a column
// worth folding by, and no other column is. One choice at a time, so the menu
// closes on the pick - unlike the columns menu, where a pick is usually one of
// several.

import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { Check, Group } from "lucide-react";
import type { GroupOption } from "./grouping";

export function GroupMenu({
  options,
  value,
  onChange,
}: {
  options: readonly GroupOption[];
  /** The column the rows are grouped by, or null for a flat table. */
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const current = options.find((option) => option.id === value);
  const items: { id: string | null; header: string }[] = [
    { id: null, header: "none" },
    ...options,
  ];
  return (
    <Menu>
      <MenuButton
        aria-label="Group rows"
        title="Group rows by a column"
        className={({ open }) => `tbtn ${open || value !== null ? "tbtn-on" : ""}`}
      >
        <Group size={13} aria-hidden />
        {current ? `group: ${current.header}` : "group"}
      </MenuButton>
      <MenuItems
        anchor={{ to: "bottom end", gap: 4, padding: 8 }}
        className="palette-in z-50 max-h-72 min-w-44 overflow-y-auto rounded-control border bg-canvas py-1 border-line-strong shadow-md focus:outline-none"
      >
        {items.map((item) => {
          const on = item.id === value;
          return (
            <MenuItem key={item.id ?? "none"}>
              {({ focus }) => (
                <button
                  type="button"
                  onClick={() => onChange(item.id)}
                  aria-pressed={on}
                  className={`mono flex w-full cursor-pointer items-center gap-2 px-2 py-1 text-left ${
                    focus ? "bg-raised" : ""
                  }`}
                >
                  <Check
                    size={12}
                    aria-hidden
                    className="shrink-0"
                    style={{ opacity: on ? 1 : 0, color: "var(--accent)" }}
                  />
                  <span className="truncate">{item.header}</span>
                </button>
              )}
            </MenuItem>
          );
        })}
      </MenuItems>
    </Menu>
  );
}
