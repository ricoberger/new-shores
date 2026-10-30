import { ICON_AUTHORS, ICON_LICENSE } from "../theme/icons";
import { t, tRich } from "../i18n";
import styles from "./account.module.css";
import { DialogPanel } from "./DialogPanel";
import hud from "./hud.module.css";

/**
 * Credits / attribution (CC BY 3.0 asks for it where the work is used):
 * the game-icons.net icons with their authors and the OFL fonts. The same
 * text is in the README. A viewport-level modal (fixed, like the
 * registration dialog), not positioned inside the account menu.
 */
export function CreditsDialog({ onClose }: { onClose: () => void }) {
  return (
    <div
      className={styles.modal}
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <DialogPanel className={`${hud.panel} ${hud.dialog}`} labelledBy="credits-dialog-title" testId="credits-dialog" onClick={(e) => e.stopPropagation()}>
        <h2 className={hud.title} id="credits-dialog-title">
          {t("credits.title")}
        </h2>
        <div className={hud.section}>
          <div className={hud.sectionTitle}>{t("credits.icons")}</div>
          <p className={hud.small}>
            {tRich("credits.icon", {
              site: (
                <a href="https://game-icons.net" target="_blank" rel="noreferrer">
                  {"game-icons.net"}
                </a>
              ),
              authors: ICON_AUTHORS.join(", "),
              license: (
                <a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noreferrer">
                  {ICON_LICENSE}
                </a>
              ),
            })}
          </p>
        </div>
        <div className={hud.section}>
          <div className={hud.sectionTitle}>{t("credits.fonts")}</div>
          <p className={hud.small}>
            {t("credits.fonts.text")}
          </p>
        </div>
        <div className={hud.buttons}>
          <button type="button" className={`${hud.button} ${hud.primary}`} onClick={onClose} data-testid="credits-close">
            {t("common.close")}
          </button>
        </div>
      </DialogPanel>
    </div>
  );
}
