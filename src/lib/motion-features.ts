// The Motion feature bundle, in a file of its own so that Vite can put it in
// a chunk of its own. `domMax` is everything: animations, exit, gestures and
// layout - layout is what `layoutId` needs, and an indicator that slides
// from one tab to the next is the reason the library is here at all.
//
// Nothing imports this statically. The provider in motion.tsx loads it with
// a dynamic import, after first paint.

import { domMax } from "motion/react";

export default domMax;
