// Babylon engine and scene of the island view. Created once per canvas and
// disposed once (React Strict Mode safe: the owner disposes in its effect
// cleanup). Renders only what the payloads contain: terrain, buildings,
// roads, carts and status icons — no shadows, sky or post-processing.
import { Engine } from "@babylonjs/core/Engines/engine";
import { EngineStore } from "@babylonjs/core/Engines/engineStore";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Scene } from "@babylonjs/core/scene";
import type { ContentBuilding, Island, WorldResponse } from "../api/client";
import type { GameSync, SyncSnapshot } from "../api/sync";
import { buildingAt, lPath, missingRoadHint, rotatedFootprint, type TilePos, tileKey } from "../display/geometry";
import type { Tool } from "../ui/tools";
import { BuildingLayer } from "./buildings";
import { CameraRig } from "./camera";
import { CartLayer } from "./carts";
import { footprintBox, tileCenter, worldToTile } from "./coords";
import { IconLayer } from "./icons";
import { GHOST, GHOST_NO_ROAD } from "./palette";
import { type Point, PointerInput } from "./picking";
import { RoadLayer } from "./roads";
import { buildTerrain } from "./terrain";

export interface RendererEvents {
  select(buildingId: number | null): void;
  place(x: number, y: number): void;
  move(x: number, y: number): void;
  road(from: TilePos, to: TilePos): void;
  demolish(x: number, y: number): void;
  cancelTool(): void;
}

export class GameRenderer {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly rig: CameraRig;
  private readonly buildings: BuildingLayer;
  private readonly roads: RoadLayer;
  private readonly carts: CartLayer;
  private readonly icons: IconLayer;
  private readonly ghost: Mesh;
  private readonly ghostMaterial: StandardMaterial;
  /** Server road tiles (tileKey) for the ghost's road hint. */
  private roadTiles = new Set<string>();
  private readonly input: PointerInput;
  private readonly unsubscribe: () => void;
  private terrain: Mesh[] = [];
  private terrainRevision = "";
  private lastServer: WorldResponse | null = null;
  private lastContent: unknown = null;
  private defs = new Map<string, ContentBuilding>();
  private hover: Point | null = null;
  private roadStart: TilePos | null = null;
  private selected: number | null = null;
  private firstFrameMarked = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly sync: GameSync,
    private readonly tool: () => Tool,
    private readonly events: RendererEvents,
  ) {
    this.engine = new Engine(canvas, true, { stencil: false, preserveDrawingBuffer: false }, true);
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.12, 0.27, 0.42, 1);
    this.scene.skipPointerMovePicking = true;
    const light = new HemisphericLight("light", new Vector3(0.3, 1, -0.5), this.scene);
    light.intensity = 0.95;
    light.groundColor = new Color3(0.45, 0.45, 0.5);
    this.rig = new CameraRig(this.scene, this.engine);
    this.buildings = new BuildingLayer(this.scene);
    this.roads = new RoadLayer(this.scene);
    this.carts = new CartLayer(this.scene);
    this.icons = new IconLayer(this.scene);

    this.ghost = CreateBox("ghost", { size: 1 }, this.scene);
    this.ghostMaterial = new StandardMaterial("ghost", this.scene);
    this.ghostMaterial.diffuseColor = GHOST;
    this.ghostMaterial.alpha = 0.45;
    this.ghost.material = this.ghostMaterial;
    this.ghost.isPickable = false;
    this.ghost.setEnabled(false);

    this.input = new PointerInput(canvas, () => this.ratio(), {
      tap: (p, button) => this.onTap(p, button),
      dragStart: (p, button) => this.onDragStart(p, button),
      dragMove: (prev, cur, button) => this.onDragMove(prev, cur, button),
      dragEnd: (p, button) => this.onDragEnd(p, button),
      hover: (p) => (this.hover = p),
      wheel: (p, dy) => this.rig.zoom(Math.exp(dy * 0.0015), p),
    });

    this.unsubscribe = sync.subscribe(() => this.onSnapshot(sync.getSnapshot()));
    this.onSnapshot(sync.getSnapshot());
    window.addEventListener("resize", this.onResize);
    this.engine.runRenderLoop(() => {
      this.carts.frame(this.sync.serverNowMs());
      this.updateGhost();
      this.scene.render();
      if (!this.firstFrameMarked && this.terrain.length > 0) {
        this.firstFrameMarked = true;
        performance.mark("ns-first-frame");
      }
    });
  }

  dispose(): void {
    window.removeEventListener("resize", this.onResize);
    this.unsubscribe();
    this.input.dispose();
    this.engine.stopRenderLoop();
    this.scene.dispose();
    this.engine.dispose();
  }

  /** Number of live Babylon engines (Strict Mode check). */
  static engineCount(): number {
    return EngineStore.Instances.length;
  }

  private readonly onResize = (): void => {
    this.engine.resize();
    this.rig.update();
  };

  /** Render pixels per CSS pixel. */
  private ratio(): number {
    return this.engine.getRenderWidth() / Math.max(1, this.canvas.clientWidth);
  }

  private island(): Island | undefined {
    const snap = this.sync.getSnapshot();
    const id = snap.server?.display.islands[0]?.id;
    return id ? snap.islands.get(id) : undefined;
  }

  private onSnapshot(snap: SyncSnapshot): void {
    if (snap.content !== this.lastContent && snap.content) {
      this.lastContent = snap.content;
      this.defs = new Map(snap.content.buildings.map((b) => [b.id, b]));
      this.lastServer = null; // rebuild with the new definitions
    }
    const island = this.island();
    if (island && island.revision + island.id !== this.terrainRevision) {
      for (const m of this.terrain) m.dispose();
      this.terrain = buildTerrain(this.scene, island);
      this.terrainRevision = island.revision + island.id;
      this.rig.setBounds(island.width, island.height, true);
    }
    if (snap.server !== this.lastServer && snap.server && this.defs.size > 0) {
      this.lastServer = snap.server;
      const is = snap.server.display.islands[0];
      this.buildings.update(is?.buildings ?? [], this.defs);
      this.roads.update(is?.roads ?? []);
      this.roadTiles = new Set((is?.roads ?? []).map(tileKey));
      this.carts.update(is, this.defs);
      this.icons.update(is?.buildings ?? [], this.defs);
      this.setSelected(this.selected);
    }
  }

  setSelected(id: number | null): void {
    this.selected = id;
    const b = this.sync.getSnapshot().server?.display.islands[0]?.buildings.find((x) => x.id === id);
    this.buildings.select(b, b ? this.defs.get(b.type) : undefined);
  }

  /** Centres the camera on a building. */
  focusBuilding(id: number): void {
    const b = this.sync.getSnapshot().server?.display.islands[0]?.buildings.find((x) => x.id === id);
    const def = b && this.defs.get(b.type);
    if (!b || !def) return;
    const { cx, cz } = footprintBox(b.x, b.y, def.width, def.height, b.rotation);
    this.rig.focus(new Vector3(cx, 0, cz));
  }

  /** CSS-pixel viewport position of the centre of a tile. */
  tileToScreen(islandId: string, x: number, y: number): { x: number; y: number } {
    void islandId; // one island per view in M1b
    const p = this.rig.project(tileCenter(x, y));
    const r = this.canvas.getBoundingClientRect();
    const k = this.ratio();
    return { x: r.left + p.x / k, y: r.top + p.y / k };
  }

  private tileAt(p: Point): TilePos | null {
    const g = this.rig.groundAt(p.x, p.y);
    return g ? worldToTile(g) : null;
  }

  private onTap(p: Point, button: number): void {
    const tool = this.tool();
    if (button === 2) {
      if (tool.kind !== "none") this.events.cancelTool();
      return;
    }
    if (button !== 0) return;
    const t = this.tileAt(p);
    if (!t) return;
    switch (tool.kind) {
      case "build":
        this.events.place(t.x, t.y);
        return;
      case "move":
        this.events.move(t.x, t.y);
        return;
      case "road":
        this.events.road(t, t);
        return;
      case "demolish":
        this.events.demolish(t.x, t.y);
        return;
      case "none": {
        const is = this.sync.getSnapshot().server?.display.islands[0];
        const b = is ? buildingAt(is.buildings, this.defs, t.x, t.y) : undefined;
        this.events.select(b?.id ?? null);
      }
    }
  }

  private pans(button: number): boolean {
    return button === 1 || button === 2 || (button === 0 && this.tool().kind === "none");
  }

  private onDragStart(p: Point, button: number): void {
    if (button === 0 && this.tool().kind === "road") this.roadStart = this.tileAt(p);
  }

  private onDragMove(prev: Point, cur: Point, button: number): void {
    if (this.roadStart && button === 0) {
      const t = this.tileAt(cur);
      if (t) this.roads.setPreview(lPath(this.roadStart, t));
      return;
    }
    if (this.pans(button)) this.rig.pan(prev, cur);
  }

  private onDragEnd(p: Point, button: number): void {
    if (this.roadStart && button === 0) {
      const t = this.tileAt(p);
      const start = this.roadStart;
      this.roadStart = null;
      this.roads.setPreview([]);
      if (t && this.tool().kind === "road") this.events.road(start, t);
    }
  }

  /**
   * Placement/move ghost under the pointer. It turns yellow when the
   * building requires a road and none of the server's road tiles touches the
   * footprint (a "not connected" hint, never red; the server validates).
   */
  private updateGhost(): void {
    const tool = this.tool();
    const def = tool.kind === "build" || tool.kind === "move" ? this.defs.get(tool.buildingType) : undefined;
    const t = this.hover && def ? this.tileAt(this.hover) : null;
    if ((tool.kind !== "build" && tool.kind !== "move") || !def || !t) {
      this.ghost.setEnabled(false);
      return;
    }
    const [w, h] = rotatedFootprint(def.width, def.height, tool.rotation);
    this.ghost.scaling.set(w, 0.6, h);
    this.ghost.position.set(t.x + w / 2, 0.3, -(t.y + h / 2));
    const color = missingRoadHint(def, this.roadTiles, t.x, t.y, tool.rotation) ? GHOST_NO_ROAD : GHOST;
    if (this.ghostMaterial.diffuseColor !== color) this.ghostMaterial.diffuseColor = color;
    this.ghost.setEnabled(true);
  }
}
