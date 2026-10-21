import { type KeyboardEvent, type MouseEvent, type ReactNode, useEffect, useRef } from "react";

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Visible focusable elements inside a container, in tab order. */
export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
}

/**
 * Keeps Tab and Shift+Tab inside a container, moving focus explicitly
 * (Safari's default Tab skips buttons; the container itself counts as
 * before the first element).
 */
export function trapTab(root: HTMLElement | null, e: KeyboardEvent<HTMLElement>): void {
  if (e.key !== "Tab" || !root) return;
  e.preventDefault();
  const items = focusables(root);
  if (items.length === 0) return;
  const i = items.indexOf(document.activeElement as HTMLElement);
  const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : i < 0 || i === items.length - 1 ? 0 : i + 1;
  items[next]?.focus();
}

/** A modal dialog (aria-modal) is open: sheets suspend their own focus handling. */
export function modalOpen(): boolean {
  return document.querySelector('[role="dialog"][aria-modal="true"]') !== null;
}

interface Props {
  className: string;
  labelledBy: string;
  testId?: string;
  children: ReactNode;
  onClick?: (e: MouseEvent<HTMLDivElement>) => void;
}

/**
 * The panel of a modal dialog (role="dialog", aria-modal): takes focus
 * when it opens, keeps Tab inside and returns focus to the element that
 * had it (e.g. a button in a sheet) when it closes.
 */
export function DialogPanel({ className, labelledBy, testId, children, onClick }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.focus({ preventScroll: true });
    return () => {
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  return (
    <div
      ref={ref}
      className={className}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      tabIndex={-1}
      data-testid={testId}
      onClick={onClick}
      onKeyDown={(e) => trapTab(ref.current, e)}
    >
      {children}
    </div>
  );
}
