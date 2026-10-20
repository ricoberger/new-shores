import { useCallback, useEffect, useState } from "react";
import { NetworkError, type Player } from "../api/client";
import { authErrorText, currentPlayer, parseMailLink, verifyEmail } from "../api/auth";
import { App } from "./App";
import appStyles from "./App.module.css";
import styles from "./account.module.css";
import { StartScreen } from "./StartScreen";

type State =
  | { kind: "loading"; unreachable: boolean }
  | { kind: "start"; notice?: string; resetToken?: string }
  | { kind: "game"; player: Player };

/** Reads and removes an account link (?verify_email / ?password_reset) from the URL. */
function takeMailLink() {
  const link = parseMailLink(globalThis.location?.search ?? "");
  if (link) globalThis.history?.replaceState(null, "", globalThis.location.pathname);
  return link;
}

const RETRY_MS = 2000;

/**
 * Session gate: GET /auth/me decides between the game and the start
 * screen; a 401 during the game (session ended) returns to the start
 * screen. The dev server answers with a fixed logged-in player.
 */
export function Root() {
  const [state, setState] = useState<State>({ kind: "loading", unreachable: false });
  const [mailLink] = useState(takeMailLink);
  const [notice, setNotice] = useState<string | undefined>(undefined);

  // Email verification link: confirm once, then continue as usual.
  useEffect(() => {
    if (mailLink?.kind !== "verify_email") return;
    verifyEmail(mailLink.token).then(
      () => setNotice("Your email address is confirmed."),
      (err: unknown) => setNotice(authErrorText(err)),
    );
  }, [mailLink]);

  useEffect(() => {
    if (state.kind !== "loading") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      try {
        const p = await currentPlayer();
        if (cancelled) return;
        if (mailLink?.kind === "password_reset") setState({ kind: "start", resetToken: mailLink.token });
        else setState(p ? { kind: "game", player: p } : { kind: "start" });
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
  }, [state.kind, mailLink]);

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
      return <StartScreen key={state.resetToken ?? "start"} onPlayer={onPlayer} notice={state.notice ?? notice} resetToken={state.resetToken} />;
    case "game":
      return <App key={state.player.id} player={state.player} onPlayerChange={onPlayer} onSessionEnded={onSessionEnded} onLoggedOut={onLoggedOut} />;
  }
}
