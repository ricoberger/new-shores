import { type FormEvent, useState } from "react";
import { authErrorText, confirmPasswordReset, requestPasswordReset } from "../api/auth";
import { t } from "../i18n";
import styles from "./account.module.css";

interface Props {
  onDone: (notice: string) => void;
  onCancel: () => void;
}

/** "Forgot password?": requests a reset mail (always the same answer). */
export function ForgotPasswordForm({ onDone, onCancel }: Props) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await requestPasswordReset(email);
      onDone(t("auth.resetSent"));
    } catch (err) {
      setError(authErrorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className={styles.stack} onSubmit={(e) => void submit(e)}>
      <label className={styles.field}>
        {t("auth.email")}
        <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      {error && <p className={styles.error}>{error}</p>}
      <button type="submit" className={styles.primary} disabled={busy}>
        {t("auth.sendReset")}
      </button>
      <button type="button" className={styles.secondary} onClick={onCancel} disabled={busy}>
        {t("common.back")}
      </button>
    </form>
  );
}

/** The reset link of the mail: choose a new password. */
export function ResetPasswordForm({ token, onDone, onCancel }: Props & { token: string }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await confirmPasswordReset(token, password);
      onDone(t("auth.resetDone"));
    } catch (err) {
      setError(authErrorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className={styles.stack} onSubmit={(e) => void submit(e)}>
      <label className={styles.field}>
        {t("auth.newPassword")}
        <input type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {error && <p className={styles.error}>{error}</p>}
      <button type="submit" className={styles.primary} disabled={busy}>
        {t("auth.setPassword")}
      </button>
      <button type="button" className={styles.secondary} onClick={onCancel} disabled={busy}>
        {t("common.back")}
      </button>
    </form>
  );
}
