import { useCallback, useEffect, useState } from "react";
import { NetworkError, type Player } from "../api/client";
import { currentPlayer } from "../api/auth";
import { App } from "./App";
import appStyles from "./App.module.css";
import styles from "./account.module.css";
import { StartScreen } from "./StartScreen";

type State = { kind: "loading"; unreachable: boolean } | { kind: "start"; notice?: string } | { kind: "game"; player: Player };

const RETRY_MS = 2000;

/**
 * Session gate: GET /auth/me decides between the game and the start
 * screen; a 401 during the game (session ended) returns to the start
 * screen. The dev server answers with a fixed logged-in player.
 */
export function Root() {
  const [state, setState] = useState<State>({ kind: "loading", unreachable: false });

  useEffect(() => {
    if (state.kind !== "loading") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      try {
        const p = await currentPlayer();
        if (!cancelled) setState(p ? { kind: "game", player: p } : { kind: "start" });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof NetworkError) setState({ kind: "loading", unreachable: true });
        timer = setTimeout(() => void check(), RETRY_MS);
      }
    };
    void check();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [state.kind]);

  const onSessionEnded = useCallback(() => setState({ kind: "start", notice: "Your session has ended. Please log in again." }), []);
  const onLoggedOut = useCallback(() => setState({ kind: "start" }), []);
  const onPlayer = useCallback((player: Player) => setState({ kind: "game", player }), []);

  switch (state.kind) {
    case "loading":
      return (
        <div className={styles.screen} data-testid="loading">
          {state.unreachable && (
            <div className={appStyles.banner} data-testid="unreachable-banner">
              Server unreachable — retrying…
            </div>
          )}
        </div>
      );
    case "start":
      return <StartScreen onPlayer={onPlayer} notice={state.notice} />;
    case "game":
      return <App key={state.player.id} player={state.player} onPlayerChange={onPlayer} onSessionEnded={onSessionEnded} onLoggedOut={onLoggedOut} />;
  }
}
