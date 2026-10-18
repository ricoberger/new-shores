# Verification targets mirroring AGENTS.md §4.
#
# Client targets (npm run lint / typecheck / test) are omitted until the
# client exists; see AGENTS.md §4 for the commands to add then.

SERVER_DIR := server

# golangci-lint v2.13.2 (built with go1.27.0) cannot type-check packages
# compiled by go1.27.2 ("export data version 5 is greater than maximum
# supported version 4"), so the linter runs under go1.27.1 until a fixed
# golangci-lint release is available. Override with
# GOLANGCI_LINT_GOTOOLCHAIN=local to use the installed toolchain.
GOLANGCI_LINT_GOTOOLCHAIN ?= go1.27.1

.PHONY: check server-check server-fmt server-vet server-lint server-test content-test

check: server-check content-test

server-check: server-fmt server-vet server-lint server-test

server-fmt:
	@cd $(SERVER_DIR) && out="$$(gofmt -l .)" && if [ -n "$$out" ]; then echo "gofmt needed:"; echo "$$out"; exit 1; fi

server-vet:
	cd $(SERVER_DIR) && go vet ./...

server-lint:
	cd $(SERVER_DIR) && GOTOOLCHAIN=$(GOLANGCI_LINT_GOTOOLCHAIN) golangci-lint run

server-test:
	cd $(SERVER_DIR) && go test ./...

content-test:
	cd $(SERVER_DIR) && go test ./internal/content/...
