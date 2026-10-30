// The message catalogue (D-061): English is the source and the key set
// (en.ts), German is typed to be complete (de.ts). `t(key, params)` looks
// a key up in the current language, falls back to English and fills
// `{name}` placeholders and `{count, one{…} other{…}}` plurals (the two
// forms English and German share; the form is chosen with Intl.PluralRules).
//
// Nouns: German capitalises nouns, English lowercases a name mid-sentence.
// A message that puts a content name inside a sentence therefore takes both
// `{name}` (lowercased in English via `inSentence`, as-is in German) and,
// where German needs it capitalised, `{Name}`; callers pass both. Never
// lowercase a name in a component: use `inSentence(name)`.
import { createElement, Fragment, type ReactNode, useSyncExternalStore } from "react";
import { de } from "./de";
import { en } from "./en";

export type MessageKey = keyof typeof en;
export type Language = "en" | "de";
export type Params = Record<string, string | number>;

/** The client's languages: the display name of each in its own language (the switch shows these). */
export const LANGUAGES: Record<Language, string> = { en: "English", de: "Deutsch" };

/** BCP 47 tags used for number and date formatting. */
const LOCALES: Record<Language, string> = { en: "en-GB", de: "de-DE" };

const CATALOGUES: Record<Language, Record<MessageKey, string>> = { en, de };

export const LANGUAGE_KEY = "newShores.language";

export function isLanguage(s: string | null | undefined): s is Language {
  return s != null && Object.hasOwn(LANGUAGES, s);
}

/** The primary language subtag ("de-AT" → "de") when it is a client language. */
function fromTag(tag: string): Language | undefined {
  const primary = tag.toLowerCase().split("-")[0];
  return isLanguage(primary) ? primary : undefined;
}

export interface LanguageSources {
  /** location.search, for ?lang= (dev/testing). */
  search?: string;
  /** The stored choice (localStorage). */
  stored?: string | null;
  /** navigator.languages. */
  browser?: readonly string[];
}

/** ?lang= → stored choice → browser languages → "en". */
export function resolveLanguage(src: LanguageSources): Language {
  const q = new URLSearchParams(src.search ?? "").get("lang");
  if (isLanguage(q)) return q;
  if (isLanguage(src.stored)) return src.stored;
  for (const tag of src.browser ?? []) {
    const l = fromTag(tag);
    if (l) return l;
  }
  return "en";
}

function readStored(): string | null {
  try {
    return globalThis.localStorage?.getItem(LANGUAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function initialLanguage(): Language {
  return resolveLanguage({ search: globalThis.location?.search, stored: readStored(), browser: globalThis.navigator?.languages });
}

let current: Language = initialLanguage();
const listeners = new Set<() => void>();

export function currentLanguage(): Language {
  return current;
}

/** The BCP 47 locale of the current language, for Intl formatting. */
export function currentLocale(): string {
  return LOCALES[current];
}

export function localeOf(language: Language): string {
  return LOCALES[language];
}

/** Switches the language; `persist` stores the choice (the switch; not ?lang= or tests). */
export function setLanguage(language: Language, persist = true): void {
  if (persist) {
    try {
      globalThis.localStorage?.setItem(LANGUAGE_KEY, language);
    } catch {
      // Storage may be blocked; the choice then lasts for the session.
    }
  }
  if (language === current) return;
  current = language;
  const lang = globalThis.document?.documentElement;
  if (lang) lang.lang = language;
  for (const l of [...listeners]) l();
}

/** Calls `l` whenever the language changes; returns the unsubscribe function. */
export function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** The current language and its setter; the component re-renders when the language changes. */
export function useLanguage(): [Language, (l: Language) => void] {
  const language = useSyncExternalStore(subscribe, currentLanguage, () => "en" as Language);
  return [language, setLanguage];
}

export function hasKey(key: string): key is MessageKey {
  return Object.hasOwn(en, key);
}

/** The text of a key in the current language (English where a key is missing), parameters filled in. */
export function t(key: MessageKey, params?: Params): string {
  return format(CATALOGUES[current][key] ?? en[key], params, current);
}

/**
 * A name inside a sentence: lower case in English ("needs food"), as is in
 * German, where every noun keeps its capital.
 */
export function inSentence(name: string): string {
  return current === "en" ? name.toLowerCase() : name;
}

/** `t` with elements for the placeholders ({site} as a link): the text in pieces, the elements in place. */
export function tRich(key: MessageKey, nodes: Record<string, ReactNode>): ReactNode[] {
  const text = CATALOGUES[current][key] ?? en[key];
  return text.split(/(\{\w+\})/).map((piece, i) => {
    const name = /^\{(\w+)\}$/.exec(piece)?.[1];
    return createElement(Fragment, { key: i }, name !== undefined && name in nodes ? nodes[name] : piece);
  });
}

/** `t` for a key built at run time (server codes): the fallback text when the key does not exist. */
export function tOr(key: string, fallback: string, params?: Params): string {
  return hasKey(key) ? t(key, params) : fallback;
}

/** Index of the brace that closes the one opened at `open`. */
function closing(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}" && --depth === 0) return i;
  }
  return s.length;
}

/** Fills `{name}` and `{count, one{…} other{…}}` (the count is `#`-free: write `{count}` inside a form). */
export function format(template: string, params: Params | undefined, language: Language = current): string {
  let out = "";
  let i = 0;
  while (i < template.length) {
    const ch = template[i]!;
    if (ch !== "{") {
      out += ch;
      i++;
      continue;
    }
    const end = closing(template, i);
    const inner = template.slice(i + 1, end);
    i = end + 1;
    const comma = inner.indexOf(",");
    if (comma < 0) {
      const v = params?.[inner.trim()];
      out += v === undefined ? `{${inner}}` : String(v);
      continue;
    }
    const name = inner.slice(0, comma).trim();
    const forms = new Map<string, string>();
    for (let j = comma + 1; j < inner.length; ) {
      const open = inner.indexOf("{", j);
      if (open < 0) break;
      const close = closing(inner, open);
      forms.set(inner.slice(j, open).trim(), inner.slice(open + 1, close));
      j = close + 1;
    }
    const count = Number(params?.[name] ?? 0);
    const category = new Intl.PluralRules(LOCALES[language]).select(count);
    out += format(forms.get(category) ?? forms.get("other") ?? "", params, language);
  }
  return out;
}
