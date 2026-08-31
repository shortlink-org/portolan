// Density, globally.
//
// Two settings, not a slider: comfortable is the default and compact is what a
// reader switches to when they are scanning a hundred rows rather than reading
// ten. It is written to <html data-density> rather than threaded through props,
// because everything that responds to it responds in CSS - a row height and a
// meta type size, both tokens - and nothing needs to re-render to obey.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";

export type Density = "comfortable" | "compact";

interface DensityCtx {
  density: Density;
  toggle: () => void;
}

const Ctx = createContext<DensityCtx>({
  density: "comfortable",
  toggle: () => {},
});

const KEY = "portolan.density";

function initial(): Density {
  try {
    return localStorage.getItem(KEY) === "compact" ? "compact" : "comfortable";
  } catch {
    /* private mode: this session still toggles, it just does not persist */
    return "comfortable";
  }
}

export function DensityProvider({ children }: { children: ReactNode }) {
  const [density, setDensity] = useState<Density>(initial);

  useEffect(() => {
    document.documentElement.dataset["density"] = density;
    try {
      localStorage.setItem(KEY, density);
    } catch {
      /* see above */
    }
  }, [density]);

  const toggle = useCallback(
    () => setDensity((d) => (d === "compact" ? "comfortable" : "compact")),
    [],
  );
  const value = useMemo(() => ({ density, toggle }), [density, toggle]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDensity(): DensityCtx {
  return useContext(Ctx);
}
