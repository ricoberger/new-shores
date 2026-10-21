import { ICON_AUTHORS, ICON_LICENSE } from "../theme/icons";
import { DialogPanel } from "./DialogPanel";
import hud from "./hud.module.css";

/**
 * Credits / attribution (CC BY 3.0 asks for it where the work is used):
 * the game-icons.net icons with their authors and the OFL fonts. The same
 * text is in the README.
 */
export function CreditsDialog({ onClose }: { onClose: () => void }) {
  return (
    <div
      className={hud.backdrop}
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
          Credits
        </h2>
        <div className={hud.section}>
          <div className={hud.sectionTitle}>Icons</div>
          <p className={hud.small}>
            Icons from{" "}
            <a href="https://game-icons.net" target="_blank" rel="noreferrer">
              game-icons.net
            </a>{" "}
            by {ICON_AUTHORS.join(", ")}, licensed under{" "}
            <a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noreferrer">
              {ICON_LICENSE}
            </a>
            ; recoloured, coordinates rounded.
          </p>
        </div>
        <div className={hud.section}>
          <div className={hud.sectionTitle}>Fonts</div>
          <p className={hud.small}>
            Cinzel by Natanael Gama and Source Sans 3 by Paul D. Hunt (Adobe), both under the SIL Open Font License 1.1.
          </p>
        </div>
        <div className={hud.buttons}>
          <button type="button" className={`${hud.button} ${hud.primary}`} onClick={onClose} data-testid="credits-close">
            Close
          </button>
        </div>
      </DialogPanel>
    </div>
  );
}
