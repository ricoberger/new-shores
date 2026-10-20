import { useState } from "react";
import type { Player } from "../api/client";
import { authErrorText, playAsGuest } from "../api/auth";
import styles from "./account.module.css";
import { type AuthMode, AuthForm } from "./AuthForm";

interface Props {
  onPlayer: (player: Player) => void;
  notice?: string;
}

/** Shown without a session: play as guest, log in or register. */
export function StartScreen({ onPlayer, notice }: Props) {
  const [mode, setMode] = useState<AuthMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const guest = async () => {
    setBusy(true);
    setError(null);
    try {
      onPlayer(await playAsGuest());
    } catch (err) {
      setError(authErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.screen} data-testid="start-screen">
      <div className={styles.card}>
        <h1 className={styles.heading}>New Shores</h1>
        <p className={styles.sub}>{mode === "login" ? "Log in" : mode === "register" ? "Create an account" : "Settle a new archipelago."}</p>
        {notice && !mode && <p className={styles.notice}>{notice}</p>}
        {mode ? (
          <AuthForm mode={mode} onDone={onPlayer} onCancel={() => setMode(null)} />
        ) : (
          <div className={styles.stack}>
            <button type="button" className={styles.primary} onClick={() => void guest()} disabled={busy} data-testid="play-guest">
              Play as guest
            </button>
            <button type="button" className={styles.secondary} onClick={() => setMode("login")} data-testid="show-login">
              Log in
            </button>
            <button type="button" className={styles.secondary} onClick={() => setMode("register")} data-testid="show-register">
              Register
            </button>
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
