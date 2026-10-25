# Verification and development targets mirroring AGENTS.md §4.
#
#   make check        server + content + client checks (no browser needed)
#   make dev          dev server (in-memory world) + Vite, Ctrl-C stops both;
#                     `make dev HOST=<lan-ip>` serves both on the LAN (phone testing)
#   make preview      e2e-mode build (fixtures, ?stats=1) served by `vite preview` on
#                     :4173 against the dev server; HOST=<lan-ip> for the LAN
#   make up           Compose stack (postgres, redis, migrate, server x2, caddy)
#                     on http://localhost:8000 (HTTP_PORT from deploy/.env, the
#                     environment or `make up HTTP_PORT=…`); make logs
#   make down         stop the stack; `make down VOLUMES=1` also deletes the
#                     database volume (0/false/no/unset keep it)
#   make makefile-test  dry-run checks of the up/down targets
#   make server-integration  Go integration tests (PostgreSQL + Redis)
#   make assets       rebuild the models (Blender 5.2 + the CC0 kits, see README "Asset build")
#   make assets-check rebuild into a temp dir and compare with client/public/models (skips without Blender)
#   make assets-test  asset build unit tests (stdlib Python ≥ 3.11; part of `make check`)
#   make shots        PNGs of the game in .experiment/shots/<set>/ (fixtures showcase,
#                     settled, dense-2x400 × near/mid/far × desktop/phone, fixed camera and
#                     clock; 25–40 s). Needs the Playwright browsers, free ports 18080/4174.
#                     Parameters FIXTURE, VIEW, DEVICE (lists or all), ROTATION, ISLAND, ZOOM,
#                     X Y, OUT, SET, HUD=0, PRESET (info-panel, sheet, ghost, sloop, build-menu, warnings, ship-panel, route-editor, route-paused, island-card, top-bar-popups, farm-selected, hemp-farm-selected, field-ghost, all):
#                     make shots FIXTURE=showcase VIEW=near DEVICE=desktop ROTATION=2
#   make model-sheet  contact sheets of single recipes in .experiment/sheets (committed models
#                     untouched; Blender 5.2 + NEW_SHORES_KITS_DIR); without RECIPE it lists
#                     the recipe IDs: make model-sheet RECIPE=sawmill,sloop
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
	client-install client-check client-lint client-typecheck client-test client-build dev preview \
	server-integration up down logs makefile-test assets assets-check assets-test shots model-sheet

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

assets:
	cd $(CLIENT_DIR) && npm run assets

assets-check:
	cd $(CLIENT_DIR) && npm run --silent assets -- --check

# Screenshots of the game for polish work, see the header. The parameters
# (FIXTURE, VIEW, DEVICE, ROTATION, ISLAND, ZOOM, X, Y, OUT, HUD, PRESET, SET)
# reach the script as environment variables; unknown values fail with the allowed list.
shots:
	cd $(CLIENT_DIR) && npm run --silent shots

# Contact sheet of single models without touching the committed ones: --only
# rewrites the output directory (it would drop the other GLBs and shrink
# manifest.json), so the GLBs go to .experiment/sheets/models and only the
# sheets (<id>.png per recipe, all.png) are of interest (paths are relative to
# the repository root, where the build runs). Unlike `make assets`
# the sheets are not written to assets/build/out (the default of the build).
RECIPE_IDS := $(sort $(basename $(notdir $(filter-out %/schema.json,$(wildcard assets/recipes/*.json)))))
SHEETS_OUT := .experiment/sheets

model-sheet:
ifeq ($(strip $(RECIPE)),)
	@echo "usage: make model-sheet RECIPE=<id>[,<id>]   (sheets in $(SHEETS_OUT))"; echo "recipe IDs:"; printf '  %s\n' $(RECIPE_IDS)
else
	@for id in $(subst $(comma), ,$(RECIPE)); do \
		case " $(RECIPE_IDS) " in *" $$id "*) ;; *) echo "model-sheet: unknown recipe '$$id'; run \`make model-sheet\` for the list"; exit 2;; esac; \
	done
	cd $(CLIENT_DIR) && npm run --silent assets -- --only $(RECIPE) --no-thumbs --out $(SHEETS_OUT)/models --sheets $(SHEETS_OUT)
endif

assets-test:
	python3 -m unittest discover -s assets/build/tests -t assets/build/tests

# Needs TEST_DATABASE_URL/TEST_REDIS_URL or a running Docker (testcontainers);
# skipped otherwise (failed when CI is set).
server-integration:
	cd $(SERVER_DIR) && go test -tags 'integration testevents' -count=1 ./...

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

# HOST=<lan-ip> makes the stack reachable from other devices (a phone): Vite
# listens on all interfaces, the client calls the dev server at
# http://$(HOST):8080 and the dev server allows the client origins on that
# host (the localhost origins stay allowed). Without HOST nothing changes.
CORS_LOCAL := http://localhost:5173,http://127.0.0.1:5173
PREVIEW_PORT ?= 4173
comma := ,
DEV_CORS := $(CORS_LOCAL),http://localhost:$(PREVIEW_PORT),http://127.0.0.1:$(PREVIEW_PORT)$(if $(HOST),$(comma)http://$(HOST):5173$(comma)http://$(HOST):$(PREVIEW_PORT))
VITE_HOST_FLAG := $(if $(HOST),--host)
VITE_API_ENV := $(if $(HOST),VITE_API_BASE=http://$(HOST):8080 )

dev:
	@trap 'kill 0' INT TERM EXIT; \
	(cd $(SERVER_DIR) && go run ./cmd/server --dev --content $(CONTENT) --time-scale $(TIME_SCALE) --cors-origin $(DEV_CORS)) & \
	(cd $(CLIENT_DIR) && $(VITE_API_ENV)VITE_TIME_SCALE=$(TIME_SCALE) npm run dev -- $(VITE_HOST_FLAG)) & \
	wait

# Bundled build with the dev/e2e hooks on (VITE_E2E=1: ?fixture=, ?stats=1),
# the realistic basis for fps numbers on a phone (Vite's unbundled dev
# serving is slower). The build is baked against http://$(HOST):8080.
preview:
	cd $(CLIENT_DIR) && $(VITE_API_ENV)VITE_E2E=1 VITE_TIME_SCALE=$(TIME_SCALE) npx vite build
	@trap 'kill 0' INT TERM EXIT; \
	(cd $(SERVER_DIR) && go run ./cmd/server --dev --content $(CONTENT) --time-scale $(TIME_SCALE) --cors-origin $(DEV_CORS)) & \
	(cd $(CLIENT_DIR) && npx vite preview --port $(PREVIEW_PORT) --strictPort $(VITE_HOST_FLAG)) & \
	wait
