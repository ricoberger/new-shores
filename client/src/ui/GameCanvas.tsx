import { useEffect, useRef } from "react";
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
}

/**
 * Owns the Babylon engine. The effect creates exactly one renderer and its
 * cleanup disposes it, so React Strict Mode's double-invoked effects never
 * leave a second engine or canvas listeners behind.
 */
export function GameCanvas({ sync, tool, events, onRenderer, initialCamera }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const toolRef = useRef(tool);
  const eventsRef = useRef(events);
  const cameraRef = useRef(initialCamera);
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
        fieldRect: (island, a, b) => ev().fieldRect(island, a, b),
        pendFields: (island, a, b) => ev().pendFields(island, a, b),
        demolish: (at) => ev().demolish(at),
        cancelTool: () => ev().cancelTool(),
        ghostHint: (text) => ev().ghostHint(text),
        inspectBuilding: (id) => ev().inspectBuilding(id),
        inspectShip: (id) => ev().inspectShip(id),
        inspectIsland: (id) => ev().inspectIsland(id),
        dragShip: (id, from) => ev().dragShip(id, from),
        dropShip: (island) => ev().dropShip(island),
        camera: (info) => ev().camera(info),
      },
      cameraRef.current,
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
      aria-label="Game view: drag to pan, pinch or wheel to zoom, Q and E rotate, tap to select"
      data-testid="game-canvas"
    />
  );
}
