import { ICON_VIEWBOX } from "../theme/icons";
import styles from "./hud.module.css";

interface Props {
  /** Path data from the icon set (theme/iconSet.ts). */
  path: string;
  className?: string;
}

/**
 * A HUD icon (game-icons.net, CC BY 3.0) in the current text colour (ink
 * or brass via CSS). Decorative: hidden from assistive technology — the
 * control or text next to it carries the meaning.
 */
export function Icon({ path, className }: Props) {
  return (
    <svg className={className ? `${styles.glyph} ${className}` : styles.glyph} viewBox={`0 0 ${ICON_VIEWBOX} ${ICON_VIEWBOX}`} aria-hidden="true" focusable="false">
      <path d={path} fill="currentColor" />
    </svg>
  );
}
