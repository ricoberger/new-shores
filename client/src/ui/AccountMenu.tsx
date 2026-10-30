import { useEffect, useRef, useState } from "react";
import type { Player } from "../api/client";
import { authErrorText, logout, saveAccountLanguage } from "../api/auth";
import { t } from "../i18n";
import styles from "./account.module.css";
import hud from "./hud.module.css";
import { AuthForm } from "./AuthForm";
import { CreditsDialog } from "./Credits";
import { DialogPanel } from "./DialogPanel";
import { Icon } from "./Icon";
import { LanguageSwitch } from "./LanguageSwitch";
import language from "./language.module.css";
import { toolIcon } from "../theme/iconSet";
import { installPrompt } from "../pwa";
import { useInstallAvailable } from "./PwaUi";

interface Props {
  player: Player;
  /** The guest registered (same world, updated player). */
  onRegistered: (player: Player) => void;
  onLoggedOut: () => void;
}

/** HUD account menu (the top bar's right end): icon and name, then "Register" (guests), "Install app", "Credits", "Log out". */
export function AccountMenu({ player, onRegistered, onLoggedOut }: Props) {
  const [open, setOpen] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [credits, setCredits] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canInstall = useInstallAvailable();
  const root = useRef<HTMLDivElement>(null);
  // A press anywhere else (another top-bar menu, the island button, the world) or Escape closes the menu.
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  const name = player.guest ? t("account.guestName", { name: player.display_name }) : player.display_name;

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
    <div ref={root} className={styles.menu}>
      <button
        type="button"
        className={styles.menuButton}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        data-testid="account-menu"
      >
        <Icon path={toolIcon("account")} />
        <span className={styles.menuName}>{player.display_name}</span>
      </button>
      {open && (
        <div className={styles.dropdown} data-testid="account-dropdown">
          <strong className={styles.dropdownTitle}>{name}</strong>
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
              <Icon path={toolIcon("register")} /> {t("account.register")}
            </button>
          )}
          {canInstall && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                void installPrompt.prompt();
              }}
              data-testid="install-app"
            >
              <Icon path={toolIcon("install")} /> {t("account.install")}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setCredits(true);
            }}
            data-testid="account-credits"
          >
            <Icon path={toolIcon("credits")} /> {t("account.credits")}
          </button>
          <div className={language.row}>
            <span className={language.rowLabel}>{t("language.label")}</span>
            <LanguageSwitch onChange={(l) => void saveAccountLanguage(l)} />
          </div>
          <button type="button" onClick={() => void doLogout()} data-testid="account-logout">
            <Icon path={toolIcon("logout")} /> {t("account.logout")}
          </button>
          {error && <span className={styles.error}>{error}</span>}
        </div>
      )}
      {credits && <CreditsDialog onClose={() => setCredits(false)} />}
      {registering && (
        <div className={styles.modal} onClick={() => setRegistering(false)}>
          <DialogPanel className={`${hud.panel} ${hud.dialog}`} labelledBy="register-dialog-title" onClick={(e) => e.stopPropagation()}>
            <h2 className={hud.title} id="register-dialog-title">
              {t("account.registerTitle")}
            </h2>
            <AuthForm
              mode="register"
              onDone={(p) => {
                setRegistering(false);
                onRegistered(p);
              }}
              onCancel={() => setRegistering(false)}
            />
          </DialogPanel>
        </div>
      )}
    </div>
  );
}
