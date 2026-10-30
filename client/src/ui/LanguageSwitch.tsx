import { LANGUAGES, setLanguage, t, useLanguage, type Language } from "../i18n";
import styles from "./language.module.css";

interface Props {
  /** Called after the language changed (the account menu saves it to the account). */
  onChange?: (language: Language) => void;
  /** `light` for the dark almanac footer, else ink on parchment. */
  tone?: "ink" | "light";
}

/**
 * The language switch (D-061): one button per language, each named in its own
 * language so it can be found without reading the current one. It stores the
 * choice in this browser; the account menu also passes `onChange` to save it
 * to the account.
 */
export function LanguageSwitch({ onChange, tone = "ink" }: Props) {
  const [language] = useLanguage();
  return (
    <div className={`${styles.group} ${tone === "light" ? styles.light : ""}`} role="group" aria-label={t("language.label")} data-testid="language-switch">
      {(Object.entries(LANGUAGES) as [Language, string][]).map(([code, name]) => (
        <button
          key={code}
          type="button"
          lang={code}
          className={`${styles.option} ${code === language ? styles.active : ""}`}
          aria-pressed={code === language}
          onClick={() => {
            if (code === language) return;
            setLanguage(code);
            onChange?.(code);
          }}
          data-testid={`language-${code}`}
        >
          {name}
        </button>
      ))}
    </div>
  );
}
