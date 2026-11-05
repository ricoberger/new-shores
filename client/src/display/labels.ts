// Island name labels at the far view: where a label goes (an island
// larger than the view at the zoom cap keeps the label of the island the
// camera is over) and, at the zoom cap on phones, of two overlapping
// labels the smaller island's is hidden (the focused island's always
// stays). Display logic only.

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

/**
 * Where an island's far-LOD name label goes (canvas CSS px, the label's
 * centre), or null when it is hidden: at the island's centre when that
 * lies in the viewport with `edge` px to spare (the whole label inside);
 * else, for the island the camera is over (`over`: the camera target lies
 * on its rectangle), its centre moved into that area — at the zoom cap
 * (D-072) a large island's centre is often out of view while the view
 * shows nothing but that island. Other islands' labels stay with their
 * centres (no labels pinned to the edges for the islands around).
 */
export function labelPosition(
  centre: { x: number; y: number },
  halfWidth: number,
  width: number,
  height: number,
  edge: number,
  over: boolean,
): { x: number; y: number } | null {
  if (!Number.isFinite(centre.x) || !Number.isFinite(centre.y)) return null;
  const minX = edge + halfWidth;
  const maxX = width - edge - halfWidth;
  const minY = edge;
  const maxY = height - edge;
  if (minX > maxX || minY > maxY) return null;
  if (centre.x >= minX && centre.x <= maxX && centre.y >= minY && centre.y <= maxY) return centre;
  if (!over) return null;
  return { x: Math.min(maxX, Math.max(minX, centre.x)), y: Math.min(maxY, Math.max(minY, centre.y)) };
}
