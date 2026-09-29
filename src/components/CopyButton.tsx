import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toClipboard } from "../lib/clipboard";

const SHOWN_MS = 1000;

/**
 * A copy action that stays visible beside a block of text - a command, a
 * JSON body - and says for a moment that it worked.
 */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = () => {
    void toClipboard(value).then((ok) => {
      setCopied(ok);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), SHOWN_MS);
    });
  };

  return (
    <button
      type="button"
      onClick={copy}
      className="row-action opacity-100"
      aria-label={`Copy ${label}`}
      title={`Copy ${label}`}
    >
      {copied ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
      {copied ? "copied" : "copy"}
    </button>
  );
}
