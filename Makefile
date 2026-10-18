# Verification targets mirroring AGENTS.md §4.
#
# Client targets (npm run lint / typecheck / test) are omitted until the
# client exists; see AGENTS.md §4 for the commands to add then.

SERVER_DIR := server

.PHONY: check server-check server-fmt server-vet server-lint server-test content-test

check: server-check content-test

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
