import { useState } from "react";
import type { Player } from "../api/client";
import { authErrorText, playAsGuest } from "../api/auth";
import styles from "./account.module.css";
import { AuthForm } from "./AuthForm";
import { ForgotPasswordForm, ResetPasswordForm } from "./PasswordForms";

type Mode = "login" | "register" | "forgot" | "reset" | null;

const TITLES: Record<Exclude<Mode, null>, string> = {
  login: "Log in",
  register: "Create an account",
  forgot: "Reset your password",
  reset: "Choose a new password",
};

interface Props {
  onPlayer: (player: Player) => void;
  notice?: string;
  /** Token of a password reset link (opens the reset form). */
  resetToken?: string;
}

/** Shown without a session: play as guest, log in or register. */
export function StartScreen({ onPlayer, notice: initialNotice, resetToken }: Props) {
  const [mode, setMode] = useState<Mode>(resetToken ? "reset" : null);
  const [notice, setNotice] = useState(initialNotice);
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
  const done = (text: string) => {
    setNotice(text);
    setMode(null);
  };

  return (
    <div className={styles.screen} data-testid="start-screen">
      <div className={styles.card}>
        <h1 className={styles.heading}>New Shores</h1>
        <p className={styles.sub}>{mode ? TITLES[mode] : "Settle a new archipelago."}</p>
        {notice && !mode && (
          <p className={styles.notice} data-testid="start-notice">
            {notice}
          </p>
        )}
        {(mode === "login" || mode === "register") && (
          <AuthForm mode={mode} onDone={onPlayer} onCancel={() => setMode(null)} onForgot={() => setMode("forgot")} />
        )}
        {mode === "forgot" && <ForgotPasswordForm onDone={done} onCancel={() => setMode(null)} />}
        {mode === "reset" && resetToken && <ResetPasswordForm token={resetToken} onDone={done} onCancel={() => setMode(null)} />}
        {!mode && (
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
