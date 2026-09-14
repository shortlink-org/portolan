# Design Portolan as an evidence-first architecture map

Portolan turns code, contracts, schemas, traces, deployments, and decisions into a navigable map of a software estate. Design it as a calm technical instrument: dense enough to investigate, clear enough to orient quickly, and honest about what the evidence does and does not establish.

## Scope and authority

Read this repository guide for catalog UI, the public product tour, and product copy, as directed by [`AGENTS.md`](AGENTS.md). It does not govern extractor internals, backend work, or unrelated documents, and it is not a registered agent skill or a standalone design kit.

This first edition is distilled from implementation and code comments; its effectiveness has not yet been measured with matched design evaluations. Treat the review failures below as things to check, not a measured history of agent failures.

This file carries design judgment. [`src/index.css`](src/index.css) defines tokens and reusable styles; [`src/app/responsive.ts`](src/app/responsive.ts) defines shell breakpoints; existing React components define behavior. Inspect the relevant implementation before editing. Values quoted below describe the current baseline: if they drift, reconcile the documentation with the implementation rather than restoring old values. Existing components are starting points, not proof that every state is accessible or bug-free.

Explicit task requirements may change an established pattern. Keep the change scoped, explain a material design departure, and update its owning primitive and guidance together when appropriate. Do not turn a local feature into a redesign solely to enforce this file.

## Start with the reader's job

The primary reader is an architect, platform engineer, technical lead, or developer trying to answer one of these questions:

- What exists in this estate, and how does it fit together?
- Where did this architectural fact come from, and can I trust it?
- What crosses a boundary, has drifted, or lands nowhere?
- What happens along this flow, including failures and context crossings?
- Who owns this thing, where does it run, and what should I inspect next?

Before changing a screen, write down privately:

1. The question that brought the reader here.
2. The strongest answer the catalog actually supports.
3. The evidence that earns that answer.
4. The uncertainty, missing fact, or status that limits it.
5. The next useful place the reader can go.

Support two reading speeds:

- **Orientation path:** page identity, summary, decisive status, diagram, counts, and section headings should explain the page at a glance.
- **Audit path:** identifiers, source locations, exact rows, traces, formulas, versions, timestamps, and generated artifacts should preserve the record without competing with the first read.

Never invent ownership, intent, causation, runtime behavior, deployment state, urgency, or completeness. `declared`, `verified`, `unresolved`, and absent are materially different states.

## Use this priority order

When requirements compete, protect them in this order:

1. Preserve catalog facts, identifiers, qualifiers, provenance, relationships, and task constraints.
2. Preserve the established shell, routes, theme and density behavior, keyboard model, and component conventions.
3. Make the reader's question, answer, and next useful action clear.
4. Keep evidence reachable from every summary, count, relationship, or warning.
5. Keep the interface visually coherent in light and dark themes and at its intended breakpoints.
6. Add polish only when it strengthens hierarchy, comprehension, or feedback.

## Shape the information before styling it

Order content by reader need, not by catalog field order. Every section should answer a new question. Combine duplicate summaries and give each claim one primary evidence home.

- A count of things is a link to those things, not decoration.
- A relationship leads to the entities and source evidence that created it.
- A warning names what is wrong and offers the closest useful inspection or remediation path.
- A status is attached to the fact it qualifies.
- A diagram is an explorable index, not a poster.
- A table is for aligned lookup. Cards are for distinct things with their own summaries or actions.
- Omit an unsupported section when showing it would imply a false claim. Show absence only when the absence itself answers the reader or points to a useful setup action.

Do not repeat the page title, entity kind, and identifier in several forms. The page header owns identity. Later sections explain the entity.

Use existing route helpers in `src/routes.ts` and preserve the active catalog, relevant filters, and selection. A link must open the same evidence after reload. When a destination or source is unavailable, show the identifier and explain the limitation; never invent a link to satisfy the navigation rule.

## Choose a composition for the page's question

Portolan has two related but different presentation modes.

### Catalog application

The catalog is a desktop-first investigation tool with graceful narrow-screen behavior. Its fixed shell, sidebar, top bar, page pane, optional detail rail, and overlays are one working environment. A route owns the scrolling inside its pane; the document does not scroll.

Match the opening to the route:

- **Overview:** establish estate health and the landscape first, then let the reader descend into contexts, deployments, bridges, and problems.
- **Entity page:** lead with kind, human name, exact identifier, material status, short summary, and useful counts. Keep the name row sticky; let introductory metadata scroll away.
- **Flow page:** make sequence and current step primary. Put commands, consequences, recordings, crossings, and source evidence next to the step they explain.
- **Problems page:** order attention by severity and actionability. Group repeated findings without hiding their individual subjects or rules.
- **Index page:** choose rows when comparison across stable columns is the task; choose cards when each result needs a summary, metadata, and several destinations.
- **Diagram page:** give the canvas enough area to answer the question. Controls float as one compact group and should not compete with the graph.
- **Settings or editor:** make current state, consequences, validation, and save/discard behavior explicit. Product actions are allowed; decorative product marketing is not.

### Public product tour

The `/landing` route may use larger editorial type, more open pacing, demonstrations, and a stronger call to action. It still shares the catalog's compass mark, neutral palette, accent, canvas language, typefaces, control shapes, and evidence-first voice.

Lead with the product promise and a working visual demonstration. Show how a reader travels from the estate to a fact and back to source. Claims about inputs, output, validation, privacy, or deployment must be true of the current product and should link to a demonstration or documentation where practical.

Do not make the landing page look like a separate brand, a generic SaaS template, or a gallery of disconnected feature cards.

## Use the existing visual system

### Layout and rhythm

The base rhythm is 4 px. Use the named tokens rather than nearby literals:

- `--gutter`: 24 px page gutter
- `--pad-card`: 20 px card padding
- `--gap-section`: 32 px between major product sections
- `--gap-grid`: 20 px between peers in a grid
- `--gap-card`: 16 px inside card-scale compositions
- `--w-prose`: 900 px maximum for reading prose
- `--w-table`: 1200 px maximum for wide evidence

Align related names, values, metadata, and actions across repeated rows or cards. Use CSS grid or subgrid when the eye should scan vertically. An optional field still owns its track; omitting the cell must not shift later fields sideways.

Open space should clarify grouping, not leave an underfilled rail beside compressed evidence. Let tables, canvases, timelines, and wide comparisons use the available width. Keep prose narrower.

### Typography

The catalog's default type scale is 12, 13, 14, 16, 20, and 28 px (`text-xs`, `text-sm`, `text-base`, `text-md`, `text-lg`, `text-xl`). Reuse those configured roles. The landing's display type and existing compact diagram annotations have their own local scales; do not normalize them as part of unrelated work.

- Use the configured system sans and mono stacks; do not add web fonts for a local feature.
- Sans is for human-readable names, headings, explanations, and prose.
- Mono is for identifiers, paths, commands, versions, raw tokens, compact labels, and operational metadata. Existing `.tbtn`, `.seg`, and primary action primitives also use mono; preserve their typography when reusing them.
- Use `.label` for a compact uppercase eyebrow and `.section-title` for a section heading. Do not set paragraphs or explanatory sentences as labels.
- Use tabular numerals for counts and aligned values.
- Keep page names and main section headings in sentence case. An uppercase mono label may name the kind or section, but it must not carry the main claim.
- Prefer one plain sentence over several fragments of faint microcopy.

The catalog should feel exact, not tiny. Do not shrink text to make a crowded composition fit; restructure the composition.

### Color and themes

Use semantic tokens. Every new surface and state must work in both the default and `.dark` themes.

- Neutral ink, muted text, surfaces, and borders carry most of the interface.
- Accent blue identifies interaction, focus, and selected product emphasis.
- Context colors identify bounded contexts and their related entities. They do not rank quality or importance.
- Evidence badges use the status tokens for `verified`, `declared`, and `unresolved`. Existing ADR badges, warnings, and diffs also reuse this palette with their own explicit labels; preserve those mappings without treating an accepted ADR or added field as runtime verification.
- Direction colors mean send and receive.
- Event amber identifies domain events; it is not a generic warning or call-to-action color.
- `--response-error` and `--response-error-bg` mark failed flow responses. Use the existing `.product-danger` variant for destructive actions; it is a separate treatment.
- Primary product actions use the existing warm light-theme and blue dark-theme treatment through `.product-primary` or `.landing-primary`.

Color is never the only cue. Pair it with text, shape, icon, border style, or position. Do not assign arbitrary colors to categories when the catalog has no semantic palette for them.

Use `ctxStyle` or `contextVar` from `src/lib/context-color.ts` for context identity. The six-color palette repeats, so retain names or identifiers even when context colors are visible. Check essential text and focus indicators against the actual surface in both themes; a token's existence does not guarantee sufficient contrast. Preserve the deliberate light `.spec-sheet` for third-party documents without dark-mode support.

Use existing gradient-bearing utilities and landing surfaces only where they already apply: `hero-wash`, `glow`, primary actions, and the landing's map atmosphere. Do not introduce decorative gradients, gradient text, glass, blobs, textures, or glows into ordinary catalog pages.

### Surfaces and elevation

The page is a continuous canvas. Add a boundary when it communicates a real grouping, interaction, selection, warning, or embedded tool.

- `.card` is a single hoverable destination.
- `.card-static` is a container with several destinations and must not react as though the whole surface were clickable.
- `.card-tagged` carries context identity on its left edge.
- `.card-link` makes one-entity cards clickable without stealing the controls inside.
- `.row` and `.rows` are for aligned, scan-heavy records.
- `.tbl` is for exact multi-column evidence.
- `.seg` and `.seg-stack` group related controls under one boundary.
- `.flow-card` is a node on a canvas; `.flow-card-ghost` marks a referenced node missing from the catalog. A known external system is not unresolved merely because it is outside the estate; preserve the renderer's external-node semantics.
- `Panel` from `src/components/primitives.tsx` is for a bounded body with one label, not a default wrapper for every section. It is distinct from the resizable layout `Panel` in `src/app/panels.tsx`.

Cards use the quiet `shadow-xs`; overlays use `shadow-md`; canvas nodes use the card shadow. A normal card firms its border on hover and does not jump toward the reader.

Do not wrap every metric, paragraph, section, or nested group in a card. Avoid panels inside panels.

### Brand assets and illustrations

Use `CompassRose` and `Wordmark` from `src/components/logo.tsx`. The mark is an eight-point rose crossing a ring, drawn in `currentColor`. Do not redraw it, add gradients, or substitute a generic compass icon.

Cat illustrations are a warm counterpoint used for rare positive empty states, milestones, onboarding, and not-found experiences. They do not decorate ordinary missing rows, errors, dense evidence, or every page. Reuse `CatIllustration` and `CatEmptyState`; do not synthesize a new mascot style inside a feature.

## Treat evidence as the visual material

### Status and provenance

Every status, source link, build stamp, owner, deployment, and trace is part of the product's trust model.

- Keep exact identifiers copyable and visibly distinct from display names.
- Put provenance close to the claim it supports.
- Preserve the difference between catalog build provenance and the provenance of an individual fact.
- When a fact is derived, make its basis inspectable.
- When evidence is missing, say what is missing; do not render a confident zero or a completed-looking empty panel.

### Authored resource properties

Keep actionable links in compact Resources rows and other authored values in Properties, with each value appearing once. Link purpose chooses an icon, never a health claim. Show the destination host and keep open/copy actions available without hover. Preserve explicit `false`, `0`, empty strings, and empty collections. Group labels organize values without adding nested cards.

Show `declared` provenance next to authored content and expose its file and exact keys in a disclosure. Editing belongs to the local workspace capability and uses the shared SidePanel. Keep save/discard and the difference between a saved file and an updated catalog explicit; a rebuild error must retain a retry action. Static catalogs omit editing controls and empty property sections.

### Tables and repeated rows

Use semantic tables for stable multi-column lookup and rows/subgrid for shorter interactive records.

- Left-align text; right-align comparable numbers and their headers.
- Keep peer units and precision consistent.
- Give identifiers and short labels enough room before shrinking other columns.
- Let wide evidence own the full content width rather than squeezing it beside prose.
- Keep row actions in the same column and reveal them consistently on hover or focus.
- Essential actions must also be discoverable on touch. Truncated identifiers need a keyboard/touch-accessible way to read and copy the full value; a native `title` tooltip alone is insufficient.
- If the table scrolls, keep enough context visible to understand what is moving.

### Diagrams and canvases

Diagrams answer relationship, sequence, ownership, or deployment questions. Use the renderer already assigned to that question: LikeC4, React Flow/ELK, Mermaid, or the ER canvas. Do not create a competing diagram dialect for convenience.

- A node's title and context must remain legible at the default fit.
- Edges must encode a real relationship, with direction and protocol or evidence where relevant.
- Selection, hover, and the detail rail should reveal more information without changing the graph's meaning.
- Ghosts, dashed lines, status markers, and context colors retain their existing semantics.
- Avoid crossings and overlaps when the layout can resolve them. Focus, filtering, and collapsing are legitimate ways to make a large graph readable: show the active scope and provide a way to reveal omitted records. Never silently drop inconvenient edges or nodes.
- At narrow sizes, reduce the shell and controls before making graph labels unreadable.
- In L2, services remain readable leaf cards even when they own stores. Put stores beside the service inside its context and show ownership explicitly; a database must not replace its service as the dominant block. Keep repository paths in details.
- Keep the LikeC4 renderer and model for L2; use compound ELK placement and orthogonal routing to allocate separate corridors across context boundaries. Translate routes and labels from their containing context into canvas coordinates together. Do not use a synthetic ownership group to place a shared broker.
- Aggregate call labels only across matching protocols and evidence statuses. Keep unlike relationships distinct, and keep individual methods and sources reachable from the summary. Focus emphasizes a node, its immediate neighbours and enclosing contexts without moving the graph; reset restores the complete view.

## Write like the catalog knows what it measured

Use calm, direct, technically literate language.

- Prefer “3 unresolved calls” to “Connectivity needs attention.”
- Prefer “declared in AsyncAPI” to “documented.”
- Prefer “no trace covers this hop” to “not verified yet” when the missing evidence is known.
- Keep source vocabulary exact in the audit path; explain unfamiliar terms once in plain language.
- Use active headings that name the subject or finding.
- Do not use hype, generic praise, fake certainty, or anthropomorphic claims about the architecture.
- Do not expose implementation diary, agent instructions, or design vocabulary in product copy.

Empty states have three distinct jobs:

- `Empty`: the reader asked a question and the answer is nothing.
- `Blank`: the catalog does not yet contain this kind of fact; explain where it would come from.
- `CapabilityEmpty`: the reader can take a concrete next step to make the page useful.

## Interaction, motion, and responsive behavior

Every apparent control must act, and every whole-surface hover treatment must correspond to a whole-surface action. Do not create a hover lie.

- Preserve keyboard navigation, visible focus, accessible names, current/pressed state, and full touch targets.
- Button cursors come from the shared `.button-base` baseline in `src/index.css`, applied automatically to native buttons and `[role="button"]`: `pointer` when enabled, `not-allowed` when disabled. Do not add `cursor-pointer` to each new button. Preserve deliberate copy, drag, or busy cursors; a class or ARIA role alone does not implement keyboard interaction or disable an action.
- The button baseline also supplies a visible hover tint; `.tbtn` strengthens its surface, border and ink. Keep hover feedback in shared styles, not per-button patches. Custom primary/copy controls may retain their own treatment. Hover must not change geometry or signal availability on `:disabled` or `[aria-disabled="true"]` controls; use hover-capable media queries for hover-only feedback.
- Use `Modal` and `SidePanel` from `src/components/Overlay.tsx` for modal surfaces. Verify focus stays inside, Escape dismisses only the active overlay, and focus returns to its trigger.
- Do not nest links. Use the established card-link overlay pattern when a card represents one entity.
- Preserve the user's light/dark theme, comfortable/compact density, panel sizes, and navigation state where the existing app does.
- Use native controls first. Keep units, constraints, validation, and consequences visible.
- Loading should occupy the surface that will arrive, so a click never appears to do nothing.

Motion has four established clocks: 150 ms micro feedback, 250 ms panels, 250 ms pages, and 400 ms narrative playback. Use the shared motion helpers and tokens. New motion must explain arrival, selection, continuity, or playback; it must not merely make the page feel busy.

Respect `prefers-reduced-motion`: opacity may cross-fade, but travel, scale, repetition, and animated sweeps stop.

Responsive behavior has two product thresholds:

- Below 1100 px, the three-pane desktop shell becomes one main pane with the tree and detail rail available as overlays.
- Below 640 px, the top bar remains one row and moves secondary controls behind a menu.

Treat these as changes of composition, not scaled-down desktop. Test long names, wide tables, diagrams, menus, sticky headers, and open overlays. At phone width, preserve the central question and next action even when audit detail requires horizontal scroll or a secondary surface.

## Check for these design failures

Name the failure during review so the correction can become a reusable rule.

- **Dashboard confetti:** disconnected KPI tiles appear because numbers exist, not because they answer the page's question.
- **Card carpet:** every section and row gets a rounded rectangle, flattening hierarchy into a grid of equal boxes.
- **Evidence cul-de-sac:** a count, claim, warning, or edge has no route to the records or source behind it.
- **Rainbow architecture:** arbitrary colors are assigned to technologies or categories, colliding with context and status semantics.
- **Prose as log output:** explanatory copy is rendered as tiny uppercase mono metadata.
- **Invented emptiness:** missing evidence is shown as zero, healthy, unowned, or complete.
- **Hover lie:** a surface reacts on hover but has no corresponding click or keyboard action.
- **Decorative map:** a diagram is visually prominent but omits labels, direction, evidence, or a way to inspect nodes.
- **Orphan metadata:** an identifier, count, action, or qualifier floats in a different place on each peer.
- **Shell creep:** a feature adds a new navigation bar, theme system, modal style, or scrolling model inside the established application.
- **Desktop shrink:** the wide composition is merely compressed until labels truncate and controls wrap into chrome.
- **Mascot wallpaper:** cat art is used to fill ordinary gaps instead of marking a rare state worth pausing for.

## Reuse before adding

Start with these sources:

- Tokens, component classes, tables, states, and motion CSS: `src/index.css`
- Shell, route transitions, responsive panes, and overlays: `src/app/`
- Page identity and empty-state hierarchy: `src/components/PageHeader.tsx`
- Status, context, decision, and panel primitives: `src/components/primitives.tsx`
- Logo and wordmark: `src/components/logo.tsx`
- Motion helpers: `src/lib/motion.tsx`
- Sortable, resizable, density-aware evidence tables: `src/table/DataTable.tsx`
- Copyable identifiers and contextual actions: `src/components/Ident.tsx`, `src/components/RowActions.tsx`
- Source evidence: `src/components/SourcePreview.tsx`, `src/components/RelationEvidence.tsx`
- Entity icons: `src/components/kind.tsx`; general UI icons use the existing `lucide-react` dependency
- Diagram implementations: `src/likec4/`, `src/graph/`, `src/map/`, `src/er/`, and `src/flow/`
- Public product-tour compositions: `src/landing/`

For concrete composition examples, inspect `ContextPage.tsx` for `PageHeader` with linked counts, `Overview.tsx` for aligned cards with independent controls, and `RegistryIndex.tsx` for a table-driven index, all under `src/pages/`. Reuse the relevant pattern after checking it against this task; do not copy an entire page.

For example, `p-gutter`, `p-card`, `gap-grid`, `mt-section`, `max-w-prose`, and `max-w-table` expose the layout tokens through Tailwind. Use `tnum` for aligned sans digits and `Ident` for copyable raw identifiers. Inspect a component's props before using it; a CSS class supplies appearance, not routing, sorting, focus management, or copy behavior.

Extend the nearest existing primitive when a behavior recurs. Keep a one-off composition local when it expresses that page's unique question. Add shared tokens or components for a clear shared role or behavior; avoid both speculative abstraction and duplicating critical interaction behavior merely to wait for a second use.

## Verify the rendered result

Source code and generated catalogs are not visual verification. For every material UI change:

1. Finish the implementation, then run the focused tests and generators that cover it.
2. Open the exact affected route and state, including the same selection, filter, tab, or diagram level.
3. If generated data or diagrams changed, run every derived presentation step and reload with a cache-busting query; restart an eager dev server when necessary.
4. Inspect the rendered region at a representative desktop width, below 1100 px, and below 640 px when the composition can change.
5. Check light and dark themes, keyboard focus, reduced motion when motion changed, long identifiers, empty data, and dense data as relevant.
6. State which layer was verified: source fragment, merged catalog, generated model, or rendered UI.

Documentation-only edits do not require catalog generation or browser checks. For implementation work, follow the focused verification scope in `AGENTS.md`; run additional states only where the changed behavior or a shared primitive can affect them.

For a matched design comparison, keep the route, catalog, viewport, theme, density, and interaction state fixed. Review the first attempt against a short rubric:

- Did every supplied fact and qualifier survive?
- Is the reader's question and strongest supported answer clear?
- Can every summary or warning reach its evidence?
- Does hierarchy remain clear with the text blurred or at a squint?
- Did the change avoid the named generated-design failures above?
- Is the result usable with keyboard and at the affected breakpoints?

Good recurring evaluation scenarios are the estate overview, a dense service page, a cross-context flow with a failed response, a Problems page with repeated findings, first-run onboarding, a narrow diagram with its detail panel, and the public landing hero plus product demo.

Start with one scenario affected by the rule being changed. Save the exact task prompt, input/catalog revision, starting code revision, model configuration, route and UI state, viewport, and baseline screenshot before changing the guidance. Generate both attempts from the same starting code and input, varying only the guidance; retain the first output from each. Record pass/fail for factual and interaction checks and brief human judgments for hierarchy and clarity. These are proposed evaluation scenarios until runs and results are actually recorded; one successful comparison does not establish reliability.

When reviewers repeat the same correction, encode it in the narrowest durable layer: judgment in this file, reusable mechanics in `src/index.css` or a shared component, and deterministic failures in a focused test. Keep final design changes human-reviewed.
