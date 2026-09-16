# portolan.0027 — The picture of one opened door is fetched, not bundled

*Generated from the portolan catalog. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-09-16
- **Scope:** [portolan](../portolan/README.md)
- **Source:** [`adr/0027-the-picture-of-one-opened-door-is-fetched-not-bundled.md`](https://github.com/shortlink-org/portolan/blob/main/adr/0027-the-picture-of-one-opened-door-is-fetched-not-bundled.md)
- **Committed:** Victor Login, 2026-09-16 (`767cac3`)

### Context and Problem Statement

portolan.0026 drew the whole path and left a partly opened one without a
picture: the canvas kept the flow's own view while the rail read further. The
first attempt at fixing that narrowed the whole-path view down to the opened
steps, and it looked broken — the lanes, the spacing and the numbering belong
to a hundred and fifty steps, so six of them stand scattered across the canvas
with gaps where the rest was. It was reverted.

What a reader actually does is open one door: follow the call into the next
service, read it, close it again. That shape can be laid out ahead of time,
the same way the flow and the whole path are. What stops it being in the
bundle is arithmetic: the example estate has 46 doors, a real avia estate has
about 120, and the bundle the browser already downloads for its views is
2.87 MB and 8.25 MB respectively. Paying a third more on the first page a
reader opens, for pictures almost none of them will look at, is the wrong
trade.

### Decision Drivers

- A LikeC4 view is drawn from a layout, and there is no layouter in the
  browser: only a shape decided beforehand can be drawn.
- Combinations are not a shape: five doors are thirty-two pictures, fourteen
  are sixteen thousand.
- What a reader pays for should be what they opened, not what the estate has.
- Runtime-supplied views are not new here: a branch's picture is laid out when
  the draft is made and put into the model in the browser
  (portolan.0019), and the containers view is laid out in the browser with elk.

### Considered Options

1. **Lay a view out per door, beside the site, and fetch one when its door is
   opened.** Written to `public/portolan-assets/likec4/journeys/`, put into
   the model under the flow's own view id, drawn by the same renderer.
2. **Put the door views in the bundle.** +40% views in the example, +120 in
   avia, every reader paying on first load.
3. **Render the opened path with mermaid instead.** Any combination works and
   no layout is needed, but it is a second sequence renderer beside LikeC4,
   without lanes, walkthrough or click-to-select.
4. **Leave it at portolan.0026.** The picture reacts only to "follow
   everything".

### Decision Outcome

Chosen option: **1.**

`gen-likec4` builds one dynamic view per first-level door of every flow -
the flow's steps with that one continuation followed - and, when asked for
them (`{ doors: true }`, which only the script run does), hands them back as
`journeys.c4` rather than as a source of the bundle. The script lays that file
out in a temporary workspace alongside the real sources and writes each view
to `public/portolan-assets/likec4/journeys/<view id>.json`. They are generated
artifacts, like the React bundle beside them, and are not committed.

The page fetches one when the reader has exactly one door open, caches it for
the session, and puts it into the model under the flow's own view id — so the
canvas asks for what it always asks for and gets this reading of it, the way a
branch's canvas does. Nothing open is the flow's own view; everything open is
the whole path's, which is in the bundle because it is one view per flow and
the reader who asks for it has asked for the biggest picture there is.

Between one and all — two doors of five — there is still no picture, and the
canvas keeps drawing the flow. That is the honest state: the reader opened a
shape nobody laid out.

##### Consequences

The bundle does not grow at all: 2.87 MB in the example and 8.25 MB in avia
stay as they are, and a reader who never follows a door never fetches one. One
opened door costs a single request of about 13 KB.

Generation costs one extra LikeC4 layout pass per run — about four seconds on
the example estate — and writes 46 files there, about 120 on avia.

The door's picture is laid out for its own content, so it reads like every
other view: continuous numbering, lanes that are all used, no gaps. That is
what the reverted attempt could not do by hiding steps in a bigger view.
