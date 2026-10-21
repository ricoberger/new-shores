import { useEffect, useState } from "react";
import { type LayoutMode, layoutMode } from "../display/layout";

export interface Layout {
  mode: LayoutMode;
  width: number;
  height: number;
}

const COARSE = "(pointer: coarse)";

function measure(): Layout {
  const width = globalThis.innerWidth ?? 1280;
  const height = globalThis.innerHeight ?? 800;
  const coarse = globalThis.matchMedia?.(COARSE).matches ?? false;
  return { mode: layoutMode(width, height, coarse), width, height };
}

/** The layout of the viewport, re-evaluated on resize, orientation and pointer changes. */
export function useLayout(): Layout {
  const [layout, setLayout] = useState(measure);
  useEffect(() => {
    const update = () =>
      setLayout((cur) => {
        const next = measure();
        return next.mode === cur.mode && next.width === cur.width && next.height === cur.height ? cur : next;
      });
    const mql = globalThis.matchMedia?.(COARSE);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    mql?.addEventListener("change", update);
    update();
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      mql?.removeEventListener("change", update);
    };
  }, []);
  return layout;
}
