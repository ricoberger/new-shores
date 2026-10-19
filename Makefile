# Verification and development targets mirroring AGENTS.md §4.
#
#   make check        server + content + client checks (no browser needed)
#   make dev          dev server (in-memory world) + Vite, Ctrl-C stops both
#   make client-e2e   Playwright smoke test (needs `npx playwright install chromium`)
#
# TIME_SCALE sets world seconds per wall-clock second for `make dev`
# (server --time-scale and client VITE_TIME_SCALE).

SERVER_DIR := server
CLIENT_DIR := client
CONTENT := ../content/old_coast
TIME_SCALE ?= 1

.PHONY: check server-check server-fmt server-vet server-lint server-test content-test \
	client-install client-check client-lint client-typecheck client-test client-build client-e2e dev

check: server-check content-test client-check

server-check: server-fmt server-vet server-lint server-test

server-fmt:
	@cd $(SERVER_DIR) && out="$$(gofmt -l .)" && if [ -n "$$out" ]; then echo "gofmt needed:"; echo "$$out"; exit 1; fi

server-vet:
	cd $(SERVER_DIR) && go vet ./...

server-lint:
	cd $(SERVER_DIR) && golangci-lint run

server-test:
	cd $(SERVER_DIR) && go test ./...

content-test:
	cd $(SERVER_DIR) && go test ./internal/content/...

client-install:
	cd $(CLIENT_DIR) && npm ci

client-check: client-lint client-typecheck client-test

client-lint:
	cd $(CLIENT_DIR) && npm run lint

client-typecheck:
	cd $(CLIENT_DIR) && npm run typecheck

client-test:
	cd $(CLIENT_DIR) && npm test

client-build:
	cd $(CLIENT_DIR) && npm run build

client-e2e:
	cd $(CLIENT_DIR) && npm run test:e2e

dev:
	@trap 'kill 0' INT TERM EXIT; \
	(cd $(SERVER_DIR) && go run ./cmd/server --dev --content $(CONTENT) --time-scale $(TIME_SCALE)) & \
	(cd $(CLIENT_DIR) && VITE_TIME_SCALE=$(TIME_SCALE) npm run dev) & \
	wait
