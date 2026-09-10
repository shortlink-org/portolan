// The mark beside a plugin's name: the brand's own where the plugin reads one
// technology the reader knows by its logo, a lucide glyph where it reads a
// format or a convention that has none. Both are drawn at the size and weight
// of the lucide row they sit in, which is what TechIcon's opened viewBox is for.

import {
  BookOpen,
  CodeXml,
  Database,
  FileCode2,
  FileSignature,
  FolderGit2,
  GitFork,
  Globe,
  Inbox,
  MessageSquare,
  Package,
  PenLine,
  Route,
  Share2,
  ShieldCheck,
  SpellCheck,
  Terminal,
  Users,
  Waves,
  Workflow,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { PluginGlyph, PluginIconSpec } from "../lib/plugins";
import { techGlyph } from "../lib/tech";
import { TechIcon } from "./TechIcon";

const GLYPHS: Record<PluginGlyph, LucideIcon> = {
  code: CodeXml,
  contract: FileSignature,
  message: MessageSquare,
  database: Database,
  repository: FolderGit2,
  pen: PenLine,
  shield: ShieldCheck,
  fork: GitFork,
  share: Share2,
  inbox: Inbox,
  "file-code": FileCode2,
  package: Package,
  waves: Waves,
  workflow: Workflow,
  users: Users,
  globe: Globe,
  terminal: Terminal,
  book: BookOpen,
  "spell-check": SpellCheck,
  route: Route,
};

export function PluginIcon({
  icon,
  size = 14,
  className = "",
}: {
  icon: PluginIconSpec;
  size?: number;
  className?: string;
}) {
  if ("brand" in icon) {
    const glyph = techGlyph(icon.brand);
    // A brand the mark list does not carry is a mistake the test catches; at
    // run time it falls back to the generic code glyph rather than to nothing.
    if (glyph) return <TechIcon glyph={glyph} size={size} className={className} />;
    return <CodeXml size={size} aria-hidden className={`block shrink-0 ${className}`} />;
  }
  const Glyph = GLYPHS[icon.lucide];
  return <Glyph size={size} aria-hidden className={`block shrink-0 ${className}`} />;
}
