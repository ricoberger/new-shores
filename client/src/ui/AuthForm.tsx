import { type FormEvent, useState } from "react";
import type { Player } from "../api/client";
import { authErrorText, login, register } from "../api/auth";
import styles from "./account.module.css";

export type AuthMode = "login" | "register";

interface Props {
  mode: AuthMode;
  onDone: (player: Player) => void;
  onCancel: () => void;
}

/** Email/password form of "Log in" and "Register" (errors from API codes). */
export function AuthForm({ mode, onDone, onCancel }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onDone(mode === "login" ? await login(email, password) : await register(email, password, displayName));
    } catch (err) {
      setError(authErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={styles.stack} onSubmit={(e) => void submit(e)} data-testid={`${mode}-form`}>
      <label className={styles.field}>
        Email
        <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} data-testid="auth-email" />
      </label>
      <label className={styles.field}>
        Password {mode === "register" && "(8–128 characters)"}
        <input
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          data-testid="auth-password"
        />
      </label>
      {mode === "register" && (
        <label className={styles.field}>
          Display name (optional)
          <input maxLength={32} value={displayName} onChange={(e) => setDisplayName(e.target.value)} data-testid="auth-display-name" />
        </label>
      )}
      {error && (
        <p className={styles.error} role="alert" data-testid="auth-error">
          {error}
        </p>
      )}
      <button type="submit" className={styles.primary} disabled={busy} data-testid="auth-submit">
        {mode === "login" ? "Log in" : "Register"}
      </button>
      <button type="button" className={styles.secondary} onClick={onCancel} disabled={busy}>
        Back
      </button>
    </form>
  );
}
