# Verification and development targets mirroring AGENTS.md §4.
#
#   make check        server (-short) + content + client checks (no browser needed)
#   make dev          dev server (in-memory world) + Vite, Ctrl-C stops both;
#                     `make dev HOST=<lan-ip>` serves both on the LAN (phone testing)
#   make preview      e2e-mode build (?stats=1) served by `vite preview` on
#                     :4173 against the dev server; HOST=<lan-ip> for the LAN
#                     (both: FIXTURE=<name> starts the world from a dev fixture,
#                     SNAPSHOT=<file> [RESUME=now] from a snapshot, D-066)
#   make snapshot     save the running dev server's world: [OUT=path], default
#                     .snapshots/<seed>-<YYYYMMDD-HHMMSS>.json (git-ignored); prints the path
#   make snapshot-load FILE=<path> [RESUME=now]  replace the running dev server's world with a
#                     snapshot (RESUME=now: continue from the present, no away summary)
#   make up           Compose stack (postgres, redis, migrate, server x2, caddy)
#                     on http://localhost:8000 (HTTP_PORT from deploy/.env, the
#                     environment or `make up HTTP_PORT=…`); make logs
#   make down         stop the stack; `make down VOLUMES=1` also deletes the
#                     database volume (0/false/no/unset keep it)
#   make server-test-short  go test -short ./... (what `make check` runs: the minutes-long
#                     reference games and 200-seed sweeps are skipped)
#   make server-test-full   go test ./... without -short, 30 m timeout (the CI suite; also
#                     `make server-test`)
#   make makefile-test  dry-run checks of the up/down targets
#   make server-integration  Go integration tests (PostgreSQL + Redis)
#   make assets       rebuild client/public/models (voxel GLBs, manifest.json, thumbs/) from
#                     assets/voxel/recipes (Python 3 standard library, see README "Asset build")
#   make assets-check rebuild into a temp dir and compare with client/public/models (byte for byte)
#   make assets-test  asset build tests (Python 3 standard library; part of `make check`)
#   make shots        PNGs of the game in .experiment/shots/<set>/ (the dev server's
#                     fixtures, default settled, played × near/mid/far ×
#                     desktop/phone, fixed camera and clock; about 4 min). Needs the Playwright browsers, free ports 18080/4174.
#                     Parameters FIXTURE, VIEW, DEVICE (lists or all), ROTATION, ISLAND, ZOOM,
#                     X Y, OUT, SET, HUD=0, PRESET (info-panel, producer-inputs, house-card, service-card, warehouse-card, trading-post-card, shipyard-idle, shipyard-building, served-houses, serving-buildings, sheet, ghost, sloop, build-menu, warnings, away, ship-panel, ship-rename, route-editor, route-rename, route-paused, island-card, top-bar-popups, farm-selected, hemp-farm-selected, field-selected, field-ghost, field-paint, field-paint-result, field-paint-pasture, archipelago-far, far-labels, reroll, rename, merchant-house-card, merchant-build-menu, patrician-house-card, patrician-build-menu, harbour, all),
#                     SEED (the dev server's archipelago, default the dev seed), CONTENT (the dev
#                     server's content directory, default content/old_coast), STATS=1 (draws,
#                     triangles and meshes of each shot's frame, first-frame and focused-island
#                     full-tiles times since navigation; STATS=2: the active meshes by layer),
#                     QUERY (extra URL parameters, e.g.
#                     QUERY=farmask=0), HOLD_TILES=n (only the first n island tile requests are
#                     answered: the lazy-loading look), VIEW=start (the opening camera, not a
#                     default view), VIEW=pan (measurement on the GPU and the real clock: load
#                     milestones cold and warm, then a 10 s far → mid pan through every island
#                     with its longest frame and build queue; with STATS=1):
#                     make shots FIXTURE=merchants VIEW=near DEVICE=desktop ROTATION=2
#                     make shots FIXTURE=seafaring VIEW=far SEED=42
#   make model-sheet  contact sheet of single models (recipe or placeholder) in
#                     .experiment/sheets/<ids>.png, committed models untouched; without RECIPE
#                     it lists the model IDs: make model-sheet RECIPE=fisher,house_settlers
#   make island-atlas SEED=<seed>[,<seed>]  PNG atlas of a seed's generated islands (tiles,
#                     levels, rivers, plain, Trading Post/shipyard sites, deposits) and an
#                     overview in .experiment/islands/atlas/<seed>/ (OUT= another directory);
#                     STATS=<n> prints the generator statistics over seeds 1..n instead
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

# Dev start state (D-066): FIXTURE=<name> or SNAPSHOT=<file> [RESUME=now] for
# `make dev` / `make preview` become server --fixture / --snapshot [--resume-now];
# empty variables pass nothing. SNAPSHOT is made absolute (the server runs in
# $(SERVER_DIR)). DEV_API is the dev server `make snapshot` talks to.
DEV_API ?= http://localhost:8080
$(if $(filter-out now,$(RESUME)),$(if $(RESUME),$(error RESUME must be 'now' or unset, got '$(RESUME)')))
DEV_START_FLAGS := $(if $(FIXTURE),--fixture '$(FIXTURE)') $(if $(SNAPSHOT),--snapshot '$(abspath $(SNAPSHOT))' $(if $(RESUME),--resume-now))

.PHONY: check server-check server-fmt server-vet server-lint server-test server-test-short server-test-full content-test \
	client-install client-check client-lint client-typecheck client-test client-build dev preview snapshot snapshot-load \
	server-integration up down logs makefile-test assets assets-check assets-test shots model-sheet \
	island-atlas

check: server-check content-test client-check makefile-test assets-test

server-check: server-fmt server-vet server-lint server-test-short

server-fmt:
	@cd $(SERVER_DIR) && out="$$(gofmt -l .)" && if [ -n "$$out" ]; then echo "gofmt needed:"; echo "$$out"; exit 1; fi

server-vet:
	cd $(SERVER_DIR) && go vet ./...

server-lint:
	cd $(SERVER_DIR) && golangci-lint run

server-test: server-test-full

server-test-short:
	cd $(SERVER_DIR) && go test -short -timeout 30m ./...

server-test-full:
	cd $(SERVER_DIR) && go test -timeout 30m ./...

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

# The voxel asset build (D-057; assets/voxel/build.py, Python 3 standard library).
ASSETS_BUILD := python3 assets/voxel/build.py

assets:
	$(ASSETS_BUILD)

assets-check:
	$(ASSETS_BUILD) --check

assets-test:
	python3 -m unittest discover -s assets/voxel/tests -t assets/voxel/tests

# Screenshots of the game for polish work, see the header. The parameters
# (FIXTURE, VIEW, DEVICE, ROTATION, ISLAND, ZOOM, X, Y, OUT, HUD, PRESET, SEED, CONTENT, QUERY, HOLD_TILES, SET)
# reach the script as environment variables; unknown values fail with the allowed list.
shots:
	cd $(CLIENT_DIR) && npm run --silent shots

# Island atlas (D-058): a build-tagged Go test writes the PNGs (standard
# library only); OUT is resolved against the repository root.
ATLAS_OUT := $(abspath $(or $(OUT),.experiment/islands/atlas))

island-atlas:
ifneq ($(strip $(STATS)),)
	cd $(SERVER_DIR) && ATLAS_STATS=$(STATS) go test -count=1 -timeout 0 -tags atlas -run 'TestIslandAtlas$$' -v ./internal/sim/archipelago/
else ifeq ($(strip $(SEED)),)
	@echo "usage: make island-atlas SEED=<seed>[,<seed>] [OUT=<dir>]   or   make island-atlas STATS=<n>"; exit 2
else
	cd $(SERVER_DIR) && ATLAS_SEEDS=$(SEED) ATLAS_OUT=$(ATLAS_OUT) go test -count=1 -tags atlas -run 'TestIslandAtlas$$' -v ./internal/sim/archipelago/
endif

# Contact sheet of single models without touching the committed ones (the
# build's --only writes no model files).
SHEETS_OUT := .experiment/sheets

model-sheet:
ifeq ($(strip $(RECIPE)),)
	@echo "usage: make model-sheet RECIPE=<id>[,<id>]   (sheet in $(SHEETS_OUT)/<ids>.png)"; echo "model IDs:"; $(ASSETS_BUILD) --list
else
	@mkdir -p $(SHEETS_OUT)
	$(ASSETS_BUILD) --only $(RECIPE) --sheet $(SHEETS_OUT)/$(subst $(comma),-,$(RECIPE)).png
endif

# Needs TEST_DATABASE_URL/TEST_REDIS_URL or a running Docker (testcontainers);
# skipped otherwise (failed when CI is set).
server-integration:
	cd $(SERVER_DIR) && go test -timeout 30m -tags 'integration testevents' -count=1 ./...

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
	(cd $(SERVER_DIR) && go run ./cmd/server --dev --content $(CONTENT) --time-scale $(TIME_SCALE) --cors-origin $(DEV_CORS) $(DEV_START_FLAGS)) & \
	(cd $(CLIENT_DIR) && $(VITE_API_ENV)VITE_TIME_SCALE=$(TIME_SCALE) npm run dev -- $(VITE_HOST_FLAG)) & \
	wait

# Bundled build with the dev/e2e hooks on (VITE_E2E=1: ?stats=1),
# the realistic basis for fps numbers on a phone (Vite's unbundled dev
# serving is slower). The build is baked against http://$(HOST):8080.
preview:
	cd $(CLIENT_DIR) && $(VITE_API_ENV)VITE_E2E=1 VITE_TIME_SCALE=$(TIME_SCALE) npx vite build
	@trap 'kill 0' INT TERM EXIT; \
	(cd $(SERVER_DIR) && go run ./cmd/server --dev --content $(CONTENT) --time-scale $(TIME_SCALE) --cors-origin $(DEV_CORS) $(DEV_START_FLAGS)) & \
	(cd $(CLIENT_DIR) && npx vite preview --port $(PREVIEW_PORT) --strictPort $(VITE_HOST_FLAG)) & \
	wait

# Save the dev server's world (GET /api/v1/dev/snapshot). The default name
# takes the seed from the response's Content-Disposition
# (snapshot-<seed>-<unix>.json) and the local time.
snapshot:
	@set -e; hdr=$$(mktemp); tmp=$$(mktemp); trap 'rm -f "$$hdr" "$$tmp"' EXIT; \
	curl -fsS -D "$$hdr" -o "$$tmp" '$(DEV_API)/api/v1/dev/snapshot' || { echo "snapshot: is the dev server running at $(DEV_API) (make dev)?" >&2; exit 1; }; \
	out='$(OUT)'; \
	if [ -z "$$out" ]; then \
		seed=$$(sed -n 's/^[Cc]ontent-[Dd]isposition:.*filename="snapshot-\([0-9]*\)-.*/\1/p' "$$hdr" | head -n 1); \
		out=".snapshots/$${seed:-world}-$$(date +%Y%m%d-%H%M%S).json"; \
	fi; \
	mkdir -p "$$(dirname "$$out")"; mv "$$tmp" "$$out"; echo "$$out"

# Replace the dev server's world with FILE (POST /api/v1/dev/snapshot);
# the server's error body is printed on a non-2xx answer.
snapshot-load:
	@test -n '$(FILE)' || { echo "snapshot-load: FILE=<path> is required" >&2; exit 1; }
	@test -f '$(FILE)' || { echo "snapshot-load: no such file: $(FILE)" >&2; exit 1; }
	@set -e; body=$$(mktemp); trap 'rm -f "$$body"' EXIT; \
	code=$$(curl -sS -o "$$body" -w '%{http_code}' -X POST -H 'Content-Type: application/json' --data-binary @'$(FILE)' '$(DEV_API)/api/v1/dev/snapshot$(if $(RESUME),?resume=$(RESUME))') || { echo "snapshot-load: is the dev server running at $(DEV_API) (make dev)?" >&2; exit 1; }; \
	cat "$$body"; echo; \
	case "$$code" in 2??) ;; *) echo "snapshot-load: the server answered $$code" >&2; exit 1;; esac
