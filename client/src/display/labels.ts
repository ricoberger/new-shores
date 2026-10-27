// Island name labels at the far view's zoom cap on phones: of two
// overlapping labels the smaller island's is hidden (the focused island's
// always stays). Display logic only.

/** A label on screen: its island, its centre and size (CSS px) and the island's size (tiles). */
export interface LabelBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** The island's area (tiles): the larger island keeps its label. */
  area: number;
}

/** Gap (CSS px) kept between two labels that both show. */
export const LABEL_GAP_PX = 4;

/**
 * The labels to hide so that no two shown labels overlap: the focused
 * island's first, then by island area (larger first, ties by ID), each
 * shown unless it overlaps one already shown.
 */
export function declutterLabels(labels: readonly LabelBox[], focus: string | null): Set<string> {
  const order = [...labels].sort((a, b) => Number(b.id === focus) - Number(a.id === focus) || b.area - a.area || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const shown: LabelBox[] = [];
  const hidden = new Set<string>();
  for (const l of order) {
    const overlaps = shown.some((s) => Math.abs(s.x - l.x) * 2 < s.width + l.width + 2 * LABEL_GAP_PX && Math.abs(s.y - l.y) * 2 < s.height + l.height + 2 * LABEL_GAP_PX);
    if (overlaps) hidden.add(l.id);
    else shown.push(l);
  }
  return hidden;
}
