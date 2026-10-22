# Verification and development targets mirroring AGENTS.md §4.
#
#   make check        server + content + client checks (no browser needed)
#   make dev          dev server (in-memory world) + Vite, Ctrl-C stops both
#   make client-e2e   Playwright smoke test (needs `npx playwright install chromium`)
#   make up           Compose stack (postgres, redis, migrate, server x2, caddy)
#                     on http://localhost:8000 (HTTP_PORT from deploy/.env, the
#                     environment or `make up HTTP_PORT=…`); make logs
#   make down         stop the stack; `make down VOLUMES=1` also deletes the
#                     database volume (0/false/no/unset keep it)
#   make makefile-test  dry-run checks of the up/down targets
#   make server-integration  Go integration tests (PostgreSQL + Redis)
#   make client-e2e-pg       Playwright persistence test (default-mode server)
#   make assets       rebuild the models (Blender 5.2 + the CC0 kits, see README "Asset build")
#   make assets-check rebuild into a temp dir and compare with client/public/models (skips without Blender)
#   make assets-test  asset build unit tests (stdlib Python ≥ 3.11; part of `make check`)
#
# TIME_SCALE sets world seconds per wall-clock second for `make dev`
# (server --time-scale and client VITE_TIME_SCALE).

SERVER_DIR := server
CLIENT_DIR := client
CONTENT := ../content/old_coast
TIME_SCALE ?= 1

COMPOSE := docker compose -f deploy/docker-compose.yaml
UP_TIMEOUT ?= 180

# HTTP_PORT is left to Compose (shell environment, then deploy/.env, then
# the file's default 8000); only a `make … HTTP_PORT=…` override is passed
# on explicitly. The readiness probe asks Compose for the port it published.
COMPOSE_ENV := $(if $(filter command line,$(origin HTTP_PORT)),HTTP_PORT=$(HTTP_PORT) )

# `make down VOLUMES=1` deletes the database volume. Unset, empty, 0, false
# and no keep it; any other value is an error (never a silent -v).
DOWN_FLAGS = $(if $(filter 1,$(VOLUMES)),-v,$(if $(filter-out 0 false no,$(VOLUMES)),$(error VOLUMES must be 1 (delete the database volume) or 0/false/no/unset (keep it), got '$(VOLUMES)')))

.PHONY: check server-check server-fmt server-vet server-lint server-test content-test \
	client-install client-check client-lint client-typecheck client-test client-build client-e2e dev \
	server-integration client-e2e-pg up down logs makefile-test assets assets-check assets-test

check: server-check content-test client-check makefile-test assets-test

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

assets:
	cd $(CLIENT_DIR) && npm run assets

assets-check:
	cd $(CLIENT_DIR) && npm run --silent assets -- --check

assets-test:
	python3 -m unittest discover -s assets/build/tests -t assets/build/tests

# Needs TEST_DATABASE_URL/TEST_REDIS_URL or a running Docker (testcontainers);
# skipped otherwise (failed when CI is set).
server-integration:
	cd $(SERVER_DIR) && go test -tags 'integration testevents' -count=1 ./...

# Needs E2E_DATABASE_URL and E2E_REDIS_URL.
client-e2e-pg:
	cd $(CLIENT_DIR) && npm run test:e2e:pg

up:
	$(COMPOSE_ENV)$(COMPOSE) up -d --build
	@echo "waiting for the stack (servers healthy behind Caddy)..."
	@i=0; while :; do \
		port=$$($(COMPOSE_ENV)$(COMPOSE) port caddy 8000 2>/dev/null | head -n 1 | sed 's/.*://'); \
		if [ -n "$$port" ] && curl -fsS -o /dev/null "http://localhost:$$port/api/v1/content"; then break; fi; \
		i=$$((i+1)); if [ $$i -ge $(UP_TIMEOUT) ]; then echo "stack not healthy after $(UP_TIMEOUT)s"; $(COMPOSE_ENV)$(COMPOSE) ps; exit 1; fi; \
		sleep 1; \
	done; \
	echo "New Shores is up: http://localhost:$$port"

down:
	$(COMPOSE_ENV)$(COMPOSE) down$(if $(DOWN_FLAGS), $(DOWN_FLAGS))

logs:
	$(COMPOSE_ENV)$(COMPOSE) logs -f

makefile-test:
	@deploy/makefile_test.sh

dev:
	@trap 'kill 0' INT TERM EXIT; \
	(cd $(SERVER_DIR) && go run ./cmd/server --dev --content $(CONTENT) --time-scale $(TIME_SCALE)) & \
	(cd $(CLIENT_DIR) && VITE_TIME_SCALE=$(TIME_SCALE) npm run dev) & \
	wait
