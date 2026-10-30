// Account flows of the start screen and the account menu. The session is
// an HttpOnly cookie set by the server (never readable here); the guest's
// device token is kept in localStorage so that "Play as guest" returns to
// the same guest.
import {
  ApiError,
  getMe,
  type Player,
  postGuest,
  postLogin,
  postLogout,
  postPasswordResetConfirm,
  postPasswordResetRequest,
  postRegister,
  postVerifyEmail,
} from "./client";
import { errorText } from "./errors";
import { t } from "../i18n";

export const DEVICE_TOKEN_KEY = "newShores.deviceToken";

/** The localStorage subset used here (injectable in tests). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStore(): KeyValueStore {
  return globalThis.localStorage;
}

/** The player of the current session, or null without one (401). */
export async function currentPlayer(): Promise<Player | null> {
  try {
    return (await getMe()).player;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

/**
 * Starts a guest session: with the stored device token when there is one;
 * a token the server no longer accepts is dropped and a new guest created.
 */
export async function playAsGuest(store: KeyValueStore = defaultStore()): Promise<Player> {
  const token = store.getItem(DEVICE_TOKEN_KEY);
  if (token) {
    try {
      return (await postGuest({ device_token: token })).player;
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) throw err;
      store.removeItem(DEVICE_TOKEN_KEY);
    }
  }
  const res = await postGuest({});
  if (res.device_token) store.setItem(DEVICE_TOKEN_KEY, res.device_token);
  return res.player;
}

/**
 * Registers: a guest session keeps its world; without a session a new
 * account with a world is created. The server revokes the device token.
 */
export async function register(
  email: string,
  password: string,
  displayName: string,
  store: KeyValueStore = defaultStore(),
): Promise<Player> {
  const name = displayName.trim();
  const res = await postRegister(name ? { email, password, display_name: name } : { email, password });
  store.removeItem(DEVICE_TOKEN_KEY);
  return res.player;
}

export async function login(email: string, password: string): Promise<Player> {
  return (await postLogin({ email, password })).player;
}

export async function logout(): Promise<void> {
  try {
    await postLogout();
  } catch (err) {
    // Already logged out is fine.
    if (!(err instanceof ApiError && err.status === 401)) throw err;
  }
}

export const verifyEmail = postVerifyEmail;
export const requestPasswordReset = postPasswordResetRequest;
export const confirmPasswordReset = postPasswordResetConfirm;

/** An account link of a mail: ?verify_email=1&token=… or ?password_reset=1&token=… */
export type MailLink = { kind: "verify_email" | "password_reset"; token: string } | null;

export function parseMailLink(search: string): MailLink {
  const q = new URLSearchParams(search);
  const token = q.get("token");
  if (!token) return null;
  if (q.get("verify_email") === "1") return { kind: "verify_email", token };
  if (q.get("password_reset") === "1") return { kind: "password_reset", token };
  return null;
}

/** User-facing text of an account error (`error.<code>` in the catalogue). */
export function authErrorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "bad_request" && /email/i.test(err.message)) return t("error.bad_request.email");
    if (err.code === "bad_request" && /display name/i.test(err.message)) return t("error.bad_request.displayName");
    return errorText(err.code, err.message);
  }
  return t("error.unreachable");
}
