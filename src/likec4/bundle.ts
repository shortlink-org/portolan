// The LikeC4 model of the estate on screen.
//
// Every catalog profile is its own LikeC4 project, bundled on its own
// (portolan.0034): two estates may each have a `payments` context or a `bus`,
// and one model would make them one box. The page loads one profile's catalog
// when it starts, and so it loads that profile's bundle; a workspace without
// profiles has the one unnamed bundle.

import type { JSX } from "react/jsx-runtime";
import type { LikeC4Model } from "@likec4/core/model";
import type { ReactLikeC4Props } from "likec4/react";
import { activeCatalogProfile } from "../data";

interface LikeC4Bundle {
  likec4model: LikeC4Model.Layouted;
  isLikeC4ViewId(value: unknown): value is string;
  ReactLikeC4(props: ReactLikeC4Props): JSX.Element;
  RenderIcon(props: { node: { id: string; title: string; icon?: string | undefined } }): JSX.Element;
}

const bundles = import.meta.glob<LikeC4Bundle>("./generated/*.jsx");
const load =
  bundles[`./generated/${activeCatalogProfile.id}.jsx`] ??
  bundles["./generated/default.jsx"] ??
  Object.values(bundles)[0];
if (!load) throw new Error("no LikeC4 bundle under src/likec4/generated/; run npm run likec4:gen");

const bundle = await load();

export const { likec4model, isLikeC4ViewId, ReactLikeC4, RenderIcon } = bundle;
