// The rules as portolan.json holds them, for a page that writes them.
//
// The file on disk is the truth in local mode: the bundle's copy of the
// manifest may be older than the server's, and a save must quote the
// revision it read. The rules list and a rule's own page both write through
// here, so the two cannot disagree about which revision they are editing.

import { useEffect, useState } from "react";
import { useToastStore } from "../app/toast";
import { problemRules as readProblemRules, saveProblemRules } from "./local-api";
import type { ProblemRuleEntry } from "./problem-rules";
import { useRuleEntries } from "./problem-rules";

export interface RuleFile {
  entries: ProblemRuleEntry[];
  /** The revision a save quotes; null until it is read, and always outside local mode. */
  revision: string | null;
  busy: boolean;
  /** Writes the entries and says `done`; resolves to whether the write went through. */
  write: (next: ProblemRuleEntry[], done: string) => Promise<boolean>;
}

export function useRuleFile(local: boolean): RuleFile {
  const say = useToastStore((s) => s.say);
  const entries = useRuleEntries((s) => s.entries);
  const setEntries = useRuleEntries((s) => s.setEntries);
  const [revision, setRevision] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!local) return;
    let cancelled = false;
    readProblemRules()
      .then((state) => {
        if (cancelled) return;
        setRevision(state.revision);
        setEntries(state.rules);
      })
      .catch((cause) => say(cause instanceof Error ? cause.message : String(cause)));
    return () => {
      cancelled = true;
    };
  }, [local, setEntries, say]);

  async function write(next: ProblemRuleEntry[], done: string): Promise<boolean> {
    if (!revision) return false;
    setBusy(true);
    try {
      const saved = await saveProblemRules(revision, next);
      setRevision(saved.revision);
      setEntries(saved.rules);
      say(done);
      return true;
    } catch (cause) {
      say(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { entries, revision, busy, write };
}
