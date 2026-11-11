// The renderer's view of one region (D-076): a RenderSource that passes the
// sync through with the server payload, the extrapolated model and the
// island statics narrowed to the region shown. Switching the region
// notifies the renderer, which rebuilds its scene for the other
// archipelago (its seed changes, so the camera is placed anew). With one
// region the snapshots pass through unchanged.
import type { SyncSnapshot } from "../api/sync";
import { regionStatics, regionView } from "../display/regions";
import type { RenderSource } from "./engine";

export class RegionSource implements RenderSource {
  private region = "";
  private readonly listeners = new Set<() => void>();
  private last: SyncSnapshot | null = null;
  private lastRegion = "";
  private view: SyncSnapshot | null = null;

  constructor(private readonly source: RenderSource) {}

  /** Shows another region (the ID of the payload's regions[]). */
  setRegion(id: string): void {
    if (id === this.region) return;
    this.region = id;
    for (const l of [...this.listeners]) l();
  }

  regionId(): string {
    return this.region;
  }

  subscribe(l: () => void): () => void {
    this.listeners.add(l);
    const off = this.source.subscribe(l);
    return () => {
      this.listeners.delete(l);
      off();
    };
  }

  getSnapshot(): SyncSnapshot {
    const snap = this.source.getSnapshot();
    if (snap === this.last && this.region === this.lastRegion && this.view) return this.view;
    this.last = snap;
    this.lastRegion = this.region;
    this.view = narrow(snap, this.region || (snap.server?.display.regions[0]?.id ?? ""));
    return this.view;
  }

  serverNowMs(): number {
    return this.source.serverNowMs();
  }

  setTilePriority(focus: string | null, inView: readonly string[]): void {
    this.source.setTilePriority?.(focus, inView);
  }
}

/** The snapshot of one region; the same object when nothing is narrowed. */
export function narrow(snap: SyncSnapshot, region: string): SyncSnapshot {
  const server = snap.server;
  if (!server) return snap;
  const display = regionView(server.display, region);
  const model = snap.model ? regionView(snap.model, region) : null;
  if (display === server.display && model === snap.model) return snap;
  return { ...snap, server: { ...server, display }, model, islands: regionStatics(snap.islands, display) };
}
