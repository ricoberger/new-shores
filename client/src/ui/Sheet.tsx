import { type KeyboardEvent, type PointerEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { nextSnap, SHEET_SNAPS, type SheetSnap, snapFor } from "../display/layout";
import styles from "./sheet.module.css";

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Bottom sheet of the phone layout: everything of the desktop side panel
 * slot, one at a time. A drag handle with three snap points (peek: header
 * only; half; full), opening at half; dragging below peek or the close
 * button closes it. Content scrolls inside at any snap. Pointer events on
 * the sheet never reach the canvas (it is a sibling). While open it traps
 * focus (role="dialog") and returns focus to the opener on close.
 */
export function Sheet({ title, onClose, children }: Props) {
  const titleId = useId();
  const [snap, setSnap] = useState<SheetSnap>("half");
  const [dragFraction, setDragFraction] = useState<number | null>(null);
  const ref = useRef<HTMLElement>(null);
  const drag = useRef<{ id: number; startY: number; startFraction: number; fraction: number; moved: boolean } | null>(null);
  /** A drag ends with a click on the handle too; only a plain tap cycles the snap. */
  const suppressClickUntil = useRef(0);

  // Focus moves into the sheet and back to the opener when it closes.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.focus({ preventScroll: true });
    return () => {
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  const hostHeight = () => ref.current?.parentElement?.clientHeight || window.innerHeight;

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // synthetic pointers cannot be captured
    }
    drag.current = { id: e.pointerId, startY: e.clientY, startFraction: SHEET_SNAPS[snap], fraction: SHEET_SNAPS[snap], moved: false };
  };
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    e.stopPropagation();
    const dy = d.startY - e.clientY;
    if (Math.abs(dy) > 4) d.moved = true;
    if (d.moved) {
      d.fraction = Math.min(1, Math.max(0, d.startFraction + dy / hostHeight()));
      setDragFraction(d.fraction);
    }
  };
  const onPointerEnd = (e: PointerEvent<HTMLButtonElement>, cancelled: boolean) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    e.stopPropagation();
    drag.current = null;
    if (d.moved) suppressClickUntil.current = performance.now() + 500;
    setDragFraction(null);
    if (!d.moved || cancelled) return;
    const s = snapFor(d.fraction);
    if (s === "closed") onClose();
    else setSnap(s);
  };
  const onHandleClick = () => {
    if (performance.now() < suppressClickUntil.current) return;
    setSnap(nextSnap);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Tab" || !ref.current) return;
    const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) {
      e.preventDefault();
      return;
    }
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === ref.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const fraction = dragFraction ?? SHEET_SNAPS[snap];
  return (
    <section
      ref={ref}
      className={`${styles.sheet} ${dragFraction !== null ? styles.dragging : ""}`}
      style={{ height: `${(fraction * 100).toFixed(2)}%` }}
      role="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
      data-testid="sheet"
      data-snap={snap}
      onKeyDown={onKeyDown}
    >
      <button
        type="button"
        className={styles.handle}
        aria-label={`Resize panel (now ${snap})`}
        data-testid="sheet-handle"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => onPointerEnd(e, false)}
        onPointerCancel={(e) => onPointerEnd(e, true)}
        onClick={onHandleClick}
      >
        <span className={styles.grip} />
      </button>
      <div className={styles.header}>
        <span id={titleId} className={styles.title}>
          {title}
        </span>
        <button type="button" className={styles.close} onClick={onClose} aria-label={`Close ${title}`} data-testid="sheet-close">
          ✕
        </button>
      </div>
      <div className={styles.body}>{children}</div>
    </section>
  );
}
