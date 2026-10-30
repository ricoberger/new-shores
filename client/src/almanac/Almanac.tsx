import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { getContent, type Content } from "../api/client";
import styles from "./almanac.module.css";
import { Buildings } from "./Buildings";
import { Goods } from "./Goods";
import { Islands } from "./Islands";
import { Needs } from "./Needs";
import { Overview } from "./Overview";
import { Quests } from "./Quests";
import { Ships } from "./Ships";
import { buildIndex, search, searchEntries, type Index, type SectionId } from "./model";
import { A } from "./parts";
import { LanguageSwitch } from "../ui/LanguageSwitch";
import { t, useLanguage } from "../i18n";
import { navigate, SECTIONS, sectionLabel, routePath, useRoute, type Route } from "./route";

/** Pages by section; a section without a page is not listed in the navigation. */
const PAGES: Partial<Record<SectionId, ComponentType<{ idx: Index; id?: string }>>> = {
  overview: Overview,
  buildings: Buildings,
  goods: Goods,
  needs: Needs,
  ships: Ships,
  quests: Quests,
  islands: Islands,
};

interface ViewProps {
  content: Content;
  /** Overrides the route of the address bar (tests). */
  route?: Route;
  /** Where "back to the game" leads. */
  exitHref?: string;
}

function setDocumentTitle(title: string): void {
  document.title = title;
}

/** The almanac for loaded content: header with search, section navigation, the page, the footer. */
export function AlmanacView({ content, route: forced, exitHref = "/" }: ViewProps) {
  const current = useRoute();
  const route = forced ?? current;
  const idx = useMemo(() => buildIndex(content), [content]);
  const entries = useMemo(() => searchEntries(idx), [idx]);
  const [query, setQuery] = useState("");
  const results = useMemo(() => search(entries, query).slice(0, 40), [entries, query]);
  const top = useRef<HTMLDivElement>(null);
  const sections = SECTIONS.filter((s) => PAGES[s.id]);
  const Page = PAGES[route.section] ?? Overview;
  const label = sectionLabel(sections.find((s) => s.id === route.section)?.id ?? "overview");

  useEffect(() => {
    setDocumentTitle(t("almanac.documentTitle", { section: label }));
  }, [label]);
  // A new page starts at the top; a deep link to an entry scrolls to it itself.
  useEffect(() => {
    if (!route.id) top.current?.scrollTo({ top: 0 });
  }, [route.section, route.id]);

  const region = content.region;
  const schema = schemaVersion(content);
  return (
    <div className={styles.root} ref={top} data-testid="almanac">
      <div className={styles.book}>
        <header className={styles.head}>
          <h1 className={styles.title}>{t("almanac.title")}</h1>
          <div className={styles.spacer} />
          <a className={styles.exit} href={exitHref}>
            {t("almanac.back")}
          </a>
          <div className={styles.searchBox}>
            <input
              className={styles.search}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setQuery("");
                if (e.key === "Enter" && results[0]) {
                  navigate(routePath(results[0].section, results[0].id));
                  setQuery("");
                }
              }}
              placeholder={t("almanac.search.placeholder")}
              aria-label={t("almanac.search.label")}
              data-testid="almanac-search"
            />
            {query.trim() !== "" && (
              <ul className={styles.results} aria-label={t("almanac.search.results")}>
                {results.length === 0 && <li className={styles.small}>{t("almanac.search.none")}</li>}
                {results.map((r) => (
                  <li key={`${r.section}/${r.id}`} onClick={() => setQuery("")}>
                    <A section={r.section} id={r.id}>
                      {r.name}
                    </A>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </header>
        <nav className={styles.nav} aria-label={t("almanac.sections")}>
          {sections.map((s) => (
            <a
              key={s.id}
              className={styles.navLink}
              href={routePath(s.id)}
              aria-current={s.id === route.section ? "page" : undefined}
              onClick={(e) => {
                if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
                e.preventDefault();
                navigate(routePath(s.id));
              }}
            >
              {sectionLabel(s.id)}
            </a>
          ))}
        </nav>
        <main className={styles.main} id="almanac-main">
          <Page idx={idx} id={route.id} key={route.section} />
        </main>
        <footer className={styles.foot}>
          {region?.name ?? t("almanac.footer.content")}
          {region?.version ? t("almanac.footer.version", { version: region.version }) : ""}
          {schema ? t("almanac.footer.schema", { version: schema }) : ""}
          <div className={styles.footLanguage}>
            <LanguageSwitch tone="light" />
          </div>
        </footer>
      </div>
    </div>
  );
}

/** The schema version, when the served content names one (it does not today; see the open questions). */
export function schemaVersion(content: Content): string {
  const c = content as unknown as Record<string, unknown>;
  const r = (content.region ?? {}) as unknown as Record<string, unknown>;
  const v = c.schema_version ?? r.schema_version;
  return typeof v === "string" || typeof v === "number" ? String(v) : "";
}

type Load = { kind: "loading" } | { kind: "error" } | { kind: "ready"; content: Content };

/** The public almanac: fetches the content (no login, no world) and renders it. */
export function Almanac({ exitHref }: { exitHref?: string }) {
  const [state, setState] = useState<Load>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [language] = useLanguage();
  useEffect(() => {
    let cancelled = false;
    getContent(language).then(
      (content) => !cancelled && setState({ kind: "ready", content }),
      () => !cancelled && setState({ kind: "error" }),
    );
    return () => {
      cancelled = true;
    };
  }, [attempt, language]);
  if (state.kind === "ready") return <AlmanacView content={state.content} exitHref={exitHref} />;
  return (
    <div className={styles.root} data-testid="almanac">
      <div className={styles.book}>
        <header className={styles.head}>
          <h1 className={styles.title}>{t("almanac.title")}</h1>
        </header>
        <main className={styles.main} style={{ gridColumn: "1 / -1" }}>
          {state.kind === "loading" ? (
            <p className={styles.status} role="status">
              {t("almanac.loading")}
            </p>
          ) : (
            <p className={styles.status} role="alert">
              {t("almanac.failed")}{" "}
              <button
                type="button"
                className={styles.retry}
                onClick={() => {
                  setState({ kind: "loading" });
                  setAttempt((n) => n + 1);
                }}
              >
                {t("common.tryAgain")}
              </button>
            </p>
          )}
        </main>
      </div>
    </div>
  );
}
