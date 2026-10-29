// Small shared pieces of the almanac pages: links, thumbnails, icons, costs.
import { useState, type MouseEvent, type ReactNode } from "react";
import { goodIcon } from "../theme/iconSet";
import { Icon } from "../ui/Icon";
import styles from "./almanac.module.css";
import { milli, num, type CostPart, type Index, type SectionId } from "./model";
import { navigate, routePath } from "./route";

interface LinkProps {
  section: SectionId;
  id?: string;
  children: ReactNode;
  className?: string;
}

/** An in-almanac link: a real anchor (new tab, copy link) that navigates without a reload on a plain click. */
export function A({ section, id, children, className }: LinkProps) {
  const href = routePath(section, id);
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(href);
  };
  return (
    <a href={href} onClick={onClick} className={className ? `${styles.link} ${className}` : styles.link}>
      {children}
    </a>
  );
}

export function GoodLink({ idx, id }: { idx: Index; id: string }) {
  return (
    <A section="goods" id={id} className={styles.goodLink}>
      <Icon path={goodIcon(id)} />
      {idx.goodName(id)}
    </A>
  );
}

export function BuildingLink({ idx, id }: { idx: Index; id: string }) {
  return (
    <A section="buildings" id={id}>
      {idx.buildingName(id)}
    </A>
  );
}

/** Alternatives of one slot: "Charcoal or Coal". */
export function GoodAlternatives({ idx, goods }: { idx: Index; goods: string[] }) {
  return (
    <>
      {goods.map((g, i) => (
        <span key={g}>
          {i > 0 && <span className={styles.or}> or </span>}
          <GoodLink idx={idx} id={g} />
        </span>
      ))}
    </>
  );
}

/** Gold and materials of a cost; empty cost renders a dash. */
export function Cost({ idx, parts }: { idx: Index; parts: CostPart[] }) {
  if (parts.length === 0) return <span>—</span>;
  return (
    <span className={styles.cost}>
      {parts.map((p, i) => (
        <span key={p.good ?? "gold"} className={styles.costPart}>
          {i > 0 && ", "}
          {p.good ? (
            <>
              {num(p.amount)} × <GoodLink idx={idx} id={p.good} />
            </>
          ) : (
            <>{num(p.amount)} gold</>
          )}
        </span>
      ))}
    </span>
  );
}

export const thumbUrl = (id: string) => `/models/thumbs/${id}.png`;

/** Thumbnail from the asset build; a plain box with the initial when there is none. */
export function Thumb({ id, name, size = 64 }: { id: string; name: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size };
  if (broken) {
    return (
      <span className={styles.thumbFallback} style={style} aria-hidden="true">
        {name.charAt(0)}
      </span>
    );
  }
  return <img className={styles.thumb} style={style} src={thumbUrl(id)} alt="" width={size} height={size} loading="lazy" onError={() => setBroken(true)} />;
}

/** "3 residents" style plural-free number with a unit. */
export const perMinText = (n: number) => `${num(n)}/min`;
export const amountText = (milliUnits: number) => milli(milliUnits);

/** A labelled definition row. */
export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.row}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
