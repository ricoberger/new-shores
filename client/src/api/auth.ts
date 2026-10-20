// Account flows of the start screen and the account menu. The session is
// an HttpOnly cookie set by the server (never readable here); the guest's
// device token is kept in localStorage so that "Play as guest" returns to
// the same guest.
import { ApiError, type ErrorCode, getMe, type Player, postGuest, postLogin, postLogout, postRegister } from "./client";

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

const MESSAGES: Partial<Record<ErrorCode, string>> = {
  invalid_credentials: "Wrong email or password.",
  email_taken: "This email address is already registered.",
  already_registered: "This account is already registered.",
  weak_password: "The password must be 8 to 128 characters long.",
  rate_limited: "Too many attempts. Please wait a moment and try again.",
  csrf_rejected: "The request was blocked (unexpected origin). Reload the page.",
  unauthorized: "Your session has ended. Please log in again.",
  service_unavailable: "The server is unavailable. Please try again shortly.",
  bad_request: "Please check your input.",
  not_found: "Accounts are not available on this server.",
};

/** User-facing text of an account error. */
export function authErrorText(err: unknown): string {
  if (err instanceof ApiError) {
    const text = MESSAGES[err.code];
    if (err.code === "bad_request" && /email/i.test(err.message)) return "Please enter a valid email address.";
    if (err.code === "bad_request" && /display name/i.test(err.message)) return "The display name must be 1 to 32 characters.";
    return text ?? err.message;
  }
  return "The server could not be reached.";
}
