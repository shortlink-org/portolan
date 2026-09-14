import { Ticket } from "lucide-react";
import YouTrackIcon from "@likec4/icons/tech/youtrack";
import { siGithub, siGitlab, siJira, siLinear } from "simple-icons";
import { TechIcon } from "./TechIcon";

const marks = { github: siGithub, gitlab: siGitlab, jira: siJira, linear: siLinear };

/** Local brand assets, aligned with the app's neutral technology marks. */
export function TaskTrackerIcon({ provider, size = 18, className = "" }: { provider: string; size?: number; className?: string }) {
  if (provider === "youtrack") return <YouTrackIcon width={size} height={size} aria-hidden className={`block shrink-0 grayscale ${className}`} />;
  if (Object.hasOwn(marks, provider)) return <TechIcon glyph={marks[provider as keyof typeof marks]} size={size} className={className} />;
  return <Ticket size={size} aria-hidden className={`shrink-0 ${className}`} />;
}
