import { useCallback, useEffect, useState } from "react";
import { NetworkError, type Player, postDevReset } from "../api/client";
import { authErrorText, currentPlayer, parseMailLink, verifyEmail } from "../api/auth";
import { type FixtureId, FixtureSync, fixtureCamera, fixtureFromSearch, serverFixtureFromSearch } from "../dev/fixture";
import { Almanac } from "../almanac/Almanac";
import { isAlmanacPath } from "../almanac/route";
import { App } from "./App";
import appStyles from "./App.module.css";
import styles from "./account.module.css";
import { UpdateToast } from "./PwaUi";
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

/** Dev/E2E builds only: the constant folds to false in production builds, which drops the fixture module. */
const DEV_HOOKS = import.meta.env.DEV || import.meta.env.VITE_E2E === "1";

const FIXTURE_PLAYER: Player = { id: "fixture", display_name: "Fixture", guest: true, email_verified: false };

/**
 * Entry: a synthetic fixture world when the URL names it (dev and
 * E2E builds only, no server), a server fixture (any other ?fixture=
 * name: the dev server resets its world to it first), else the session
 * gate.
 */
export function Root() {
  const [fixture] = useState(() => (DEV_HOOKS ? fixtureFromSearch(globalThis.location?.search ?? "") : null));
  const [serverFixture] = useState(() => (DEV_HOOKS ? serverFixtureFromSearch(globalThis.location?.search ?? "") : null));
  // The public almanac (/almanac/…) needs no session and no world; a pathname check is the whole router.
  if (isAlmanacPath(globalThis.location?.pathname ?? "")) return <Almanac />;
  return (
    <>
      {DEV_HOOKS && fixture ? <FixtureApp id={fixture} /> : DEV_HOOKS && serverFixture ? <ServerFixtureGate name={serverFixture} /> : <SessionRoot />}
      <UpdateToast />
    </>
  );
}

/**
 * Dev only: resets the dev server's world to a server fixture, drops
 * ?fixture= from the URL (a reload keeps the world) and opens the game.
 */
function ServerFixtureGate({ name }: { name: string }) {
  const [state, setState] = useState<{ kind: "resetting" } | { kind: "ready" } | { kind: "failed"; message: string }>({ kind: "resetting" });
  useEffect(() => {
    let cancelled = false;
    postDevReset(name).then(
      () => {
        if (cancelled) return;
        globalThis.history?.replaceState(null, "", globalThis.location.pathname);
        setState({ kind: "ready" });
      },
      (err: unknown) => {
        if (!cancelled) setState({ kind: "failed", message: err instanceof Error ? err.message : String(err) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [name]);
  if (state.kind === "ready") return <SessionRoot />;
  return (
    <div className={styles.screen} data-testid="fixture-reset">
      {state.kind === "failed" && (
        <div className={appStyles.banner} data-testid="fixture-reset-error">
          Dev fixture &apos;{name}&apos; failed: {state.message}
        </div>
      )}
    </div>
  );
}

function FixtureApp({ id }: { id: FixtureId }) {
  const [sync] = useState(() => new FixtureSync(id));
  const [camera] = useState(() => fixtureCamera(id));
  const noop = useCallback(() => undefined, []);
  return <App player={FIXTURE_PLAYER} onPlayerChange={noop} onSessionEnded={noop} onLoggedOut={noop} sync={sync} initialCamera={camera} />;
}

/**
 * Session gate: GET /auth/me decides between the game and the start
 * screen; a 401 during the game (session ended) returns to the start
 * screen. The dev server answers with a fixed logged-in player.
 */
function SessionRoot() {
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
