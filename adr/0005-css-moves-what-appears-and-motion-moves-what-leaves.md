# portolan.0005 — CSS moves what appears; Motion moves what leaves or changes place

- **Status:** accepted
- **Date:** 2026-09-06
- **Scope:** portolan

## Context and Problem Statement

The site has one motion system: three durations and two easings as CSS
tokens, a handful of keyframes, and a stagger for lists. Every animation in
it runs once, on mount. Nothing leaves - the palette, the drawer, the toast
are on screen one frame and gone the next - and nothing changes place: a tab
becomes active by repainting, a branch opens by appearing, the current step of
a flow jumps down the rail. A reader sees a site that arrives but never
moves, and reads that as "no animations".

CSS can express a mount. It cannot express an exit, because the element is
already unmounted when it would need to animate; it cannot animate `height:
auto`; and it cannot say that the highlight on tab two is the same highlight
that was on tab one. Those three need JavaScript that measures, keeps a node
alive while it leaves, and interpolates between two layouts.

## Decision Drivers

- One clock: a panel must leave at the speed it arrived, and a spring must
  land in about the panel duration.
- `prefers-reduced-motion` is obeyed everywhere, by one mechanism, not by
  each call site remembering.
- The first paint does not pay for it: the first screen has nothing that
  leaves or moves.
- Hover, focus and colour stay CSS. They are hundreds of sites; a library
  component at each would be the wrong trade.

## Considered Options

1. **Motion (motion.dev) for exit, layout and shared elements; CSS for
   everything else.** The `m` component under `LazyMotion`, features loaded
   after first paint, presets that spell the CSS tokens as numbers.
2. **CSS only, with the exits done by hand**: keep the node mounted on a
   timer, toggle a class, unmount when the timer fires. Layout and shared
   elements stay impossible, or become a FLIP written per site.
3. **Motion for everything**, hover and colour included: one library, one
   syntax, every interactive element a Motion element.

## Decision Outcome

Chosen option: **Motion for exit, layout and shared elements; CSS for the
rest**.

| | exits | layout, shared | hover, colour | first paint |
|---|---|---|---|---|
| Motion where CSS cannot | yes | yes | CSS, as now | +0 kB; ~30 kB after |
| CSS with hand-rolled exits | timers per site | no | CSS | +0 kB |
| Motion everywhere | yes | yes | Motion, hundreds of sites | ~30 kB before |

The clock is shared by construction: `src/lib/motion.tsx` declares the
durations and easings as numbers, and a test reads `index.css` and holds the
two to each other. `MotionConfig reducedMotion="user"` reads the same media
query the CSS does, so a reader who asked for less motion sees opacity
crossfade and nothing travel, on both halves.

The library is loaded through `LazyMotion` in strict mode with `domMax`
behind a dynamic import. Until it arrives an `m.*` element is its plain tag
at its resting values, which is the right first frame. `strict` throws on the
full `motion.*` element, so the bundle cannot quietly grow back to the full
library by one careless import.

### Consequences

- Good: the palette, the drawer, the sheet and the toast leave the way they
  came, on the same duration.
- Good: a tab indicator, a chevron and the current-step highlight move
  instead of repainting, on one spring that does not bounce.
- Good: a branch of the tree opens to its height instead of appearing.
- Bad: two ways to say "fade in" exist, `overlay-in` in CSS and `fade` in
  Motion. The rule is the file: a thing that only ever mounts uses the CSS
  utility; a thing that also leaves uses the preset. Utilities that Motion
  takes over are deleted from `index.css` as each site moves.
- Bad: about 30 kB of JavaScript after first paint, in a chunk of its own.
- Neutral: `useCountUp` and `staggerStyle` stay as they were. A count and a
  stagger are neither exits nor layout.
