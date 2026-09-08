import { Moon, Rows2, Rows4, Sun } from "lucide-react";
import { useDensity } from "../../app/density";
import { useTheme } from "../../app/theme";
import { ChatSection } from "../../chat/ChatSettings";
import { BUILD as CHAT_BUILD } from "../../chat/flags";
import { useEditorStore } from "../../components/EditorLink";
import { Select } from "../../components/Select";
import { EDITORS } from "../../lib/editor-link";
import { parseEditor } from "../../lib/editor-prefs";
import { SectionTitle } from "../../components/PageHeader";

function EditorChoice() {
  const editor = useEditorStore((state) => state.editor);
  const setEditor = useEditorStore((state) => state.set);
  const options = EDITORS.map((item) => ({
    value: item.id,
    label: item.name,
  }));
  return (
    <div className="rounded-card border border-line p-card shadow-xs">
      <div className="label mb-3">open source in</div>
      <Select
        value={editor}
        options={options}
        onChange={(value) => setEditor(parseEditor(value))}
        label="Editor for source links"
        menuWidth={200}
      />
      <p className="mono mt-2 text-muted">Used by the edit links in local mode.</p>
    </div>
  );
}

function Appearance() {
  const { theme, toggle: toggleTheme } = useTheme();
  const { density, toggle: toggleDensity } = useDensity();
  return (
    <div className="grid gap-grid sm:grid-cols-2 xl:grid-cols-3">
      <div className="rounded-card border border-line p-card shadow-xs">
        <div className="label mb-3">theme</div>
        <div className="seg inline-flex" role="group" aria-label="Theme">
          <button
            type="button"
            aria-pressed={theme === "dark"}
            onClick={() => theme !== "dark" && toggleTheme()}
            className={`flex items-center gap-1.5 ${theme === "dark" ? "is-on" : ""}`}
          >
            <Moon size={15} aria-hidden /> dark
          </button>
          <button
            type="button"
            aria-pressed={theme === "light"}
            onClick={() => theme !== "light" && toggleTheme()}
            className={`flex items-center gap-1.5 ${theme === "light" ? "is-on" : ""}`}
          >
            <Sun size={15} aria-hidden /> light
          </button>
        </div>
      </div>
      <div className="rounded-card border border-line p-card shadow-xs">
        <div className="label mb-3">row density</div>
        <div className="seg inline-flex" role="group" aria-label="Row density">
          <button
            type="button"
            aria-pressed={density === "comfortable"}
            onClick={() => density !== "comfortable" && toggleDensity()}
            className={`flex items-center gap-1.5 ${density === "comfortable" ? "is-on" : ""}`}
          >
            <Rows4 size={15} aria-hidden /> comfortable
          </button>
          <button
            type="button"
            aria-pressed={density === "compact"}
            onClick={() => density !== "compact" && toggleDensity()}
            className={`flex items-center gap-1.5 ${density === "compact" ? "is-on" : ""}`}
          >
            <Rows2 size={15} aria-hidden /> compact
          </button>
        </div>
      </div>
      <EditorChoice />
    </div>
  );
}

export function PreferencesSettings() {
  return (
    <div className="space-y-section">
      <section>
        <SectionTitle right="stored in this browser">Appearance</SectionTitle>
        <Appearance />
      </section>
      {CHAT_BUILD.built ? (
        <section>
          <SectionTitle right="stored in this browser">Ask the catalog</SectionTitle>
          <ChatSection />
        </section>
      ) : null}
    </div>
  );
}
