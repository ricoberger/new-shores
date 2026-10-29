import { useEffect } from "react";
import styles from "./almanac.module.css";

/** Scrolls the element with this DOM ID into view and marks it for a moment (deep links to one entry of a list). */
export function useScrollTo(id: string | undefined, prefix = ""): void {
  useEffect(() => {
    if (!id) return;
    const el = document.getElementById(`${prefix}${id}`);
    if (!el) return;
    el.scrollIntoView({ block: "start" });
    el.classList.add(styles.highlight as string);
    return () => el.classList.remove(styles.highlight as string);
  }, [id, prefix]);
}
