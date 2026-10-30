import { t } from "../i18n";
import { useEffect, useRef } from "react";
import type { Quality } from "../display/quality";
import { GameRenderer, type InitialCamera, type RendererEvents, type RenderSource } from "../render/engine";
import type { Tool } from "./tools";
import styles from "./App.module.css";

interface Props {
  sync: RenderSource;
  tool: () => Tool;
  events: RendererEvents;
  onRenderer: (r: GameRenderer | null) => void;
  /** Where the camera of a newly created renderer starts (default: the first island). */
  initialCamera?: InitialCamera;
  /** Render quality (from the layout mode or the ?quality override). */
  quality: Quality;
  /** ?fxaa=1: FXAA at "high" also on software WebGL (read when the renderer is created). */
  forceFxaa?: boolean;
  /** The life layer (false with ?life=0; read when the renderer is created). */
  life?: boolean;
}

/**
 * Owns the Babylon engine. The effect creates exactly one renderer and its
 * cleanup disposes it, so React Strict Mode's double-invoked effects never
 * leave a second engine or canvas listeners behind.
 */
export function GameCanvas({ sync, tool, events, onRenderer, initialCamera, quality, forceFxaa = false, life = true }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const toolRef = useRef(tool);
  const eventsRef = useRef(events);
  const cameraRef = useRef(initialCamera);
  const qualityRef = useRef(quality);
  const fxaaRef = useRef(forceFxaa);
  const lifeRef = useRef(life);
  const rendererRef = useRef<GameRenderer | null>(null);
  useEffect(() => {
    toolRef.current = tool;
    eventsRef.current = events;
  });
  // A new layout (resize, rotation) may change the quality of the running renderer.
  useEffect(() => {
    qualityRef.current = quality;
    rendererRef.current?.setQuality(quality);
  }, [quality]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ev = () => eventsRef.current;
    const renderer = new GameRenderer(
      canvas,
      sync,
      () => toolRef.current(),
      {
        tapIsland: (id, building) => ev().tapIsland(id, building),
        tapShip: (id) => ev().tapShip(id),
        tapSea: () => ev().tapSea(),
        place: (at) => ev().place(at),
        pend: (at) => ev().pend(at),
        unpend: () => ev().unpend(),
        rotateGhost: (steps) => ev().rotateGhost(steps),
        move: (at) => ev().move(at),
        found: (at) => ev().found(at),
        road: (island, a, b) => ev().road(island, a, b),
        placeField: (at) => ev().placeField(at),
        paintFields: (paint) => ev().paintFields(paint),
        removeFields: (island, farm, tiles, clipped) => ev().removeFields(island, farm, tiles, clipped),
        paintStatus: (text) => ev().paintStatus(text),
        demolish: (at) => ev().demolish(at),
        cancelTool: () => ev().cancelTool(),
        ghostHint: (text) => ev().ghostHint(text),
        inspectBuilding: (id) => ev().inspectBuilding(id),
        inspectShip: (id) => ev().inspectShip(id),
        inspectIsland: (id) => ev().inspectIsland(id),
        camera: (info) => ev().camera(info),
      },
      cameraRef.current,
      qualityRef.current,
      fxaaRef.current,
      lifeRef.current,
    );
    rendererRef.current = renderer;
    onRenderer(renderer);
    return () => {
      rendererRef.current = null;
      onRenderer(null);
      renderer.dispose();
    };
  }, [sync, onRenderer]);

  return (
    <>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        tabIndex={0}
        role="application"
        aria-label={t("game.canvasLabel")}
        data-testid="game-canvas"
      />
      {/* Slight warm grading ("high") and the soft vignette (every quality, ART_DIRECTION §8): composited over the canvas, never shaded per pixel. */}
      {quality === "high" && <div className={styles.grading} aria-hidden="true" data-testid="grading" />}
      <div className={styles.vignette} aria-hidden="true" data-testid="vignette" />
    </>
  );
}
