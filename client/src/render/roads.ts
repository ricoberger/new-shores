// Roads (ART_DIRECTION §4): the road tiles are paths painted into the island's
// terrain (render/roadvoxels.ts, render/terrain.ts); this module keeps their
// tile type. The ghost of a road drag is drawn by render/paint.ts from the
// hint of display/roaddrag.ts.
import type { TilePos } from "../display/geometry";

/** A road tile with its content type (dirt unless the type is paved). */
export type RoadTile = TilePos & { type?: string };
