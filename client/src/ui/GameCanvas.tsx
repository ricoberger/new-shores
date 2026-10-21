import { useEffect, useRef } from "react";
import { GameRenderer, type RendererEvents, type RenderSource, type RenderView } from "../render/engine";
import type { Tool } from "./tools";
import styles from "./App.module.css";

interface Props {
  sync: RenderSource;
  tool: () => Tool;
  events: RendererEvents;
  onRenderer: (r: GameRenderer | null) => void;
  /** View of a newly created renderer (later changes go through setView). */
  initialView?: RenderView;
}

/**
 * Owns the Babylon engine. The effect creates exactly one renderer and its
 * cleanup disposes it, so React Strict Mode's double-invoked effects never
 * leave a second engine or canvas listeners behind.
 */
export function GameCanvas({ sync, tool, events, onRenderer, initialView }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const toolRef = useRef(tool);
  const eventsRef = useRef(events);
  const viewRef = useRef(initialView);
  useEffect(() => {
    toolRef.current = tool;
    eventsRef.current = events;
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ev = () => eventsRef.current;
    const renderer = new GameRenderer(
      canvas,
      sync,
      () => toolRef.current(),
      {
        select: (id) => ev().select(id),
        place: (x, y) => ev().place(x, y),
        pend: (x, y) => ev().pend(x, y),
        rotateGhost: (steps) => ev().rotateGhost(steps),
        move: (x, y) => ev().move(x, y),
        found: (x, y) => ev().found(x, y),
        road: (a, b) => ev().road(a, b),
        demolish: (x, y) => ev().demolish(x, y),
        cancelTool: () => ev().cancelTool(),
        ghostHint: (text) => ev().ghostHint(text),
        zoomOutAtMax: (amount) => ev().zoomOutAtMax(amount),
        zoomReset: () => ev().zoomReset(),
        tapIsland: (id) => ev().tapIsland(id),
        tapShip: (id) => ev().tapShip(id),
        tapSea: () => ev().tapSea(),
        inspectShip: (id) => ev().inspectShip(id),
        inspectIsland: (id) => ev().inspectIsland(id),
        dragShip: (id, from) => ev().dragShip(id, from),
        dropShip: (island) => ev().dropShip(island),
      },
      viewRef.current,
    );
    onRenderer(renderer);
    return () => {
      onRenderer(null);
      renderer.dispose();
    };
  }, [sync, onRenderer]);

  return (
    <canvas
      ref={canvasRef}
      className={styles.canvas}
      tabIndex={0}
      role="application"
      aria-label="Game view: drag to pan, pinch or wheel to zoom, tap to select"
      data-testid="game-canvas"
    />
  );
}
