// What src/likec4/generated exports, typed for no catalog in particular.
//
// `likec4 gen react` writes generated.jsx and generated.d.ts beside the code
// that imports them, and both are ignored: they follow from likec4/ and are a
// megabyte of output. A checkout that has not generated them yet still has to
// typecheck, so tsconfig.json lists this directory in `rootDirs` after `src`:
// `./generated` resolves to the real declarations when they exist and falls
// back to these when they do not. The ids here are plain strings where the
// generated file names every element and view of the estate; code that
// compiles against these compiles against any catalog's.

import type { PropsWithChildren } from "react";
import type { JSX } from "react/jsx-runtime";
import type { LayoutedView, LikeC4Model, UnknownLayouted } from "likec4/model";
import type {
  LikeC4ViewProps as GenericLikeC4ViewProps,
  ReactLikeC4Props as GenericReactLikeC4Props,
} from "likec4/react";

type $Aux = UnknownLayouted;
type $ViewId = $Aux["ViewId"];

declare function isLikeC4ViewId(value: unknown): value is $ViewId;

declare const likec4model: LikeC4Model<$Aux>;
declare function useLikeC4Model(): LikeC4Model<$Aux>;
declare function useLikeC4View(viewId: $ViewId): LayoutedView<$Aux>;

declare function LikeC4ModelProvider(props: PropsWithChildren): JSX.Element;

type IconRendererProps = {
  node: {
    id: string;
    title: string;
    icon?: string | undefined;
  };
};
declare function RenderIcon(props: IconRendererProps): JSX.Element;

type LikeC4ViewProps = GenericLikeC4ViewProps<$Aux>;
declare function LikeC4View({ viewId, ...props }: LikeC4ViewProps): JSX.Element;

type ReactLikeC4Props = GenericReactLikeC4Props<$Aux>;
declare function ReactLikeC4({ viewId, ...props }: ReactLikeC4Props): JSX.Element;

export {
  type LikeC4ViewProps,
  type ReactLikeC4Props,
  isLikeC4ViewId,
  useLikeC4Model,
  useLikeC4View,
  likec4model,
  LikeC4ModelProvider,
  LikeC4View,
  RenderIcon,
  ReactLikeC4,
};
