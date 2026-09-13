import "@daypicker/react/style.css";

import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { DayPicker } from "@daypicker/react";
import { CalendarDays, ChevronDown } from "lucide-react";

function parseDate(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function serializeDate(date: Date): string {
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const displayDate = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

export function DatePicker({
  value,
  onChange,
  label,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  disabled?: boolean;
}) {
  const selected = parseDate(value);

  return (
    <Popover className="w-full">
      {({ close }) => (
        <>
          <PopoverButton
            aria-label={label}
            disabled={disabled}
            className={({ open }) => `group flex w-full items-center justify-between gap-2 rounded-control border bg-canvas px-3 py-1.5 shadow-xs outline-none transition-colors ${
              open
                ? "border-accent text-ink"
                : "border-line text-muted hover:border-line-strong hover:bg-surface"
            }`}
          >
            {({ open }) => (
              <>
                <span className="mono flex min-w-0 items-center gap-2 truncate">
                  <CalendarDays size={13} className="shrink-0 text-accent" aria-hidden />
                  {selected ? displayDate.format(selected) : "Choose date"}
                </span>
                <ChevronDown
                  size={13}
                  aria-hidden
                  className="shrink-0 t-micro transition-transform"
                  style={{ transform: open ? "rotate(180deg)" : "none" }}
                />
              </>
            )}
          </PopoverButton>
          <PopoverPanel
            anchor={{ to: "bottom end", gap: 4, padding: 8 }}
            className="palette-in z-50 rounded-card border bg-canvas p-2 border-line-strong shadow-md focus:outline-none"
          >
            <DayPicker
              className="adr-date-calendar"
              mode="single"
              required
              selected={selected}
              defaultMonth={selected}
              onSelect={(next) => {
                onChange(serializeDate(next));
                close();
              }}
              navLayout="around"
              showOutsideDays
              fixedWeeks
              animate
            />
          </PopoverPanel>
        </>
      )}
    </Popover>
  );
}
