// Which columns are on screen.
//
// Only offered above five columns: below that, every column fits, and a menu
// for hiding one of four is a menu that exists to be discovered rather than
// used. The primary column never appears here - hiding the column that names
// the row leaves a table of attributes belonging to nothing.

import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { Check, Columns3 } from "lucide-react";

export interface ColumnToggle {
  id: string;
  header: string;
  visible: boolean;
}

export function ColumnsMenu({
  columns,
  onToggle,
}: {
  columns: readonly ColumnToggle[];
  onToggle: (id: string) => void;
}) {
  return (
    <Menu>
      <MenuButton
        aria-label="Choose columns"
        title="Choose columns"
        className={({ open }) => `tbtn ${open ? "tbtn-on" : ""}`}
      >
        <Columns3 size={13} aria-hidden />
        columns
      </MenuButton>
      <MenuItems
        anchor={{ to: "bottom end", gap: 4, padding: 8 }}
        className="palette-in z-50 max-h-72 min-w-44 overflow-y-auto rounded-control border bg-canvas py-1 border-line-strong shadow-md focus:outline-none"
      >
        {columns.map((column) => (
          <MenuItem key={column.id}>
            {({ focus }) => (
              <button
                type="button"
                /* The menu stays open: choosing columns is choosing several,
                   and a menu that closes on each pick is four trips for four
                   columns. */
                onClick={(event) => {
                  event.preventDefault();
                  onToggle(column.id);
                }}
                aria-pressed={column.visible}
                className={`mono flex w-full cursor-pointer items-center gap-2 px-2 py-1 text-left ${
                  focus ? "bg-raised" : ""
                }`}
              >
                <Check
                  size={12}
                  aria-hidden
                  className="shrink-0"
                  style={{
                    opacity: column.visible ? 1 : 0,
                    color: "var(--accent)",
                  }}
                />
                <span className="truncate">{column.header}</span>
              </button>
            )}
          </MenuItem>
        ))}
      </MenuItems>
    </Menu>
  );
}
