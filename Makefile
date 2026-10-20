# Verification and development targets mirroring AGENTS.md §4.
#
#   make check        server + content + client checks (no browser needed)
#   make dev          dev server (in-memory world) + Vite, Ctrl-C stops both
#   make client-e2e   Playwright smoke test (needs `npx playwright install chromium`)
#   make up           Compose stack (postgres, redis, migrate, server x2, caddy)
#                     on http://localhost:8000; make down [VOLUMES=1]; make logs
#   make server-integration  Go integration tests (PostgreSQL + Redis)
#   make client-e2e-pg       Playwright persistence test (default-mode server)
#
# TIME_SCALE sets world seconds per wall-clock second for `make dev`
# (server --time-scale and client VITE_TIME_SCALE).

SERVER_DIR := server
CLIENT_DIR := client
CONTENT := ../content/old_coast
TIME_SCALE ?= 1

COMPOSE := docker compose -f deploy/docker-compose.yaml
HTTP_PORT ?= 8000
UP_TIMEOUT ?= 180

.PHONY: check server-check server-fmt server-vet server-lint server-test content-test \
	client-install client-check client-lint client-typecheck client-test client-build client-e2e dev \
	server-integration client-e2e-pg up down logs

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

# Needs TEST_DATABASE_URL/TEST_REDIS_URL or a running Docker (testcontainers);
# skipped otherwise (failed when CI is set).
server-integration:
	cd $(SERVER_DIR) && go test -tags 'integration testevents' -count=1 ./...

# Needs E2E_DATABASE_URL and E2E_REDIS_URL.
client-e2e-pg:
	cd $(CLIENT_DIR) && npm run test:e2e:pg

up:
	HTTP_PORT=$(HTTP_PORT) $(COMPOSE) up -d --build
	@echo "waiting for http://localhost:$(HTTP_PORT) (servers healthy behind Caddy)..."
	@i=0; until curl -fsS -o /dev/null http://localhost:$(HTTP_PORT)/api/v1/content; do \
		i=$$((i+1)); if [ $$i -ge $(UP_TIMEOUT) ]; then echo "stack not healthy after $(UP_TIMEOUT)s"; $(COMPOSE) ps; exit 1; fi; sleep 1; \
	done
	@echo "New Shores is up: http://localhost:$(HTTP_PORT)"

down:
	$(COMPOSE) down $(if $(VOLUMES),-v)

logs:
	$(COMPOSE) logs -f

dev:
	@trap 'kill 0' INT TERM EXIT; \
	(cd $(SERVER_DIR) && go run ./cmd/server --dev --content $(CONTENT) --time-scale $(TIME_SCALE)) & \
	(cd $(CLIENT_DIR) && VITE_TIME_SCALE=$(TIME_SCALE) npm run dev) & \
	wait
