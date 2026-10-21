import { useState } from "react";
import type { Player } from "../api/client";
import { authErrorText, logout } from "../api/auth";
import styles from "./account.module.css";
import hud from "./hud.module.css";
import { AuthForm } from "./AuthForm";

interface Props {
  player: Player;
  /** The guest registered (same world, updated player). */
  onRegistered: (player: Player) => void;
  onLoggedOut: () => void;
  /** Phone top bar: an icon button (the name is in its label and the menu). */
  compact?: boolean;
}

/** HUD account menu: display name, "Register" (guests), "Log out". */
export function AccountMenu({ player, onRegistered, onLoggedOut, compact = false }: Props) {
  const [open, setOpen] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const name = `${player.display_name}${player.guest ? " (guest)" : ""}`;

  const doLogout = async () => {
    setError(null);
    try {
      await logout();
      onLoggedOut();
    } catch (err) {
      setError(authErrorText(err));
    }
  };

  return (
    <div className={styles.menu}>
      <button
        type="button"
        className={styles.menuButton}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={compact ? `Account: ${name}` : undefined}
        data-testid="account-menu"
      >
        {compact ? "☰" : `${name} ▾`}
      </button>
      {open && (
        <div className={styles.dropdown} data-testid="account-dropdown">
          {compact && <span className={styles.status}>{name}</span>}
          {player.email && <span className={styles.status}>{player.email}</span>}
          {player.guest && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setRegistering(true);
              }}
              data-testid="account-register"
            >
              Register (keeps your island)
            </button>
          )}
          <button type="button" onClick={() => void doLogout()} data-testid="account-logout">
            Log out
          </button>
          {error && <span className={styles.error}>{error}</span>}
        </div>
      )}
      {registering && (
        <div className={styles.modal} onClick={() => setRegistering(false)}>
          <div className={`${hud.panel} ${hud.dialog}`} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h2 className={hud.title}>Register</h2>
            <AuthForm
              mode="register"
              onDone={(p) => {
                setRegistering(false);
                onRegistered(p);
              }}
              onCancel={() => setRegistering(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
