import { useEffect, useRef } from "react";
import type { GameSync } from "../api/sync";
import { GameRenderer, type RendererEvents } from "../render/engine";
import type { Tool } from "./tools";
import styles from "./App.module.css";

interface Props {
  sync: GameSync;
  tool: () => Tool;
  events: RendererEvents;
  onRenderer: (r: GameRenderer | null) => void;
}

/**
 * Owns the Babylon engine. The effect creates exactly one renderer and its
 * cleanup disposes it, so React Strict Mode's double-invoked effects never
 * leave a second engine or canvas listeners behind.
 */
export function GameCanvas({ sync, tool, events, onRenderer }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const toolRef = useRef(tool);
  const eventsRef = useRef(events);
  useEffect(() => {
    toolRef.current = tool;
    eventsRef.current = events;
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new GameRenderer(canvas, sync, () => toolRef.current(), {
      select: (id) => eventsRef.current.select(id),
      place: (x, y) => eventsRef.current.place(x, y),
      road: (a, b) => eventsRef.current.road(a, b),
      demolish: (x, y) => eventsRef.current.demolish(x, y),
      cancelTool: () => eventsRef.current.cancelTool(),
    });
    onRenderer(renderer);
    return () => {
      onRenderer(null);
      renderer.dispose();
    };
  }, [sync, onRenderer]);

  return <canvas ref={canvasRef} className={styles.canvas} data-testid="game-canvas" />;
}
