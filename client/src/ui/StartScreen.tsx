import { useState } from "react";
import type { Player } from "../api/client";
import { authErrorText, playAsGuest } from "../api/auth";
import { t } from "../i18n";
import styles from "./account.module.css";
import { AuthForm } from "./AuthForm";
import { ForgotPasswordForm, ResetPasswordForm } from "./PasswordForms";

type Mode = "login" | "register" | "forgot" | "reset" | null;

const TITLES: Record<Exclude<Mode, null>, () => string> = {
  login: () => t("start.title.login"),
  register: () => t("start.title.register"),
  forgot: () => t("start.title.forgot"),
  reset: () => t("start.title.reset"),
};

interface Props {
  onPlayer: (player: Player) => void;
  notice?: string;
  /** Token of a password reset link (opens the reset form). */
  resetToken?: string;
}

/** Shown without a session: play as guest, log in or register. */
export function StartScreen({ onPlayer, notice: incomingNotice, resetToken }: Props) {
  const [mode, setMode] = useState<Mode>(resetToken ? "reset" : null);
  // A notice of this screen's own flows (reset mail sent, password
  // changed) wins; otherwise the incoming one is rendered as it changes
  // (e.g. the result of a verification link that arrives after /auth/me).
  const [localNotice, setLocalNotice] = useState<string | undefined>(undefined);
  const notice = localNotice ?? incomingNotice;
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
    setLocalNotice(text);
    setMode(null);
  };

  return (
    <div className={styles.screen} data-testid="start-screen">
      <div className={styles.card}>
        {/* i18n-ignore: the game's name is not translated */}
        <h1 className={styles.heading}>New Shores</h1>
        <p className={styles.sub}>{mode ? TITLES[mode]() : t("start.tagline")}</p>
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
              {t("start.guest")}
            </button>
            <button type="button" className={styles.secondary} onClick={() => setMode("login")} data-testid="show-login">
              {t("auth.login")}
            </button>
            <button type="button" className={styles.secondary} onClick={() => setMode("register")} data-testid="show-register">
              {t("auth.register")}
            </button>
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            <a href="/almanac" style={{ textAlign: "center", padding: "6px 0" }} data-testid="show-almanac">
              {t("start.almanac")}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
