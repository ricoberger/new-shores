// Ports and server commands of `make shots` (e2e/tools/shots.ts).
export const API_PORT = 18080;
export const WEB_PORT = 4174;
/** World seconds per wall-clock second for the E2E run (server and client). */
export const E2E_TIME_SCALE = 10;
/** Command of the e2e dev server (run in ../server): in-memory world, the committed content. */
export const API_SERVER_COMMAND = `go run ./cmd/server --dev --content ../content/old_coast --addr :${API_PORT} --cors-origin http://localhost:${WEB_PORT} --time-scale ${E2E_TIME_SCALE}`;
/** Command of the e2e client (run in the client directory): a production build with the test hook, served by `vite preview`. */
export const WEB_SERVER_COMMAND = `npx vite build && npx vite preview --port ${WEB_PORT} --strictPort`;
