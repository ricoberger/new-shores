#!/usr/bin/env bash
# Dry-run checks (make -n; nothing is executed) of the Compose targets:
# `make down` deletes the database volume only with VOLUMES=1, and
# `make up` leaves HTTP_PORT to Compose (deploy/.env) unless it is given
# on the make command line.
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0
check() { # description, expected (0/1), command...
	local desc=$1 want=$2
	shift 2
	if "$@"; then got=1; else got=0; fi
	if [ "$got" != "$want" ]; then
		echo "FAIL: $desc"
		fail=1
	fi
}

down() { make -s -n down "$@" 2>&1; }

for v in "" "VOLUMES=" "VOLUMES=0" "VOLUMES=false" "VOLUMES=no"; do
	out=$(down $v) || { echo "FAIL: make down $v errored: $out"; fail=1; continue; }
	check "make down $v keeps volumes" 0 grep -q -- ' -v' <<<"$out"
	check "make down $v runs compose down" 1 grep -q 'compose -f deploy/docker-compose.yaml down' <<<"$out"
done

out=$(down VOLUMES=1) || { echo "FAIL: make down VOLUMES=1 errored: $out"; fail=1; }
check "make down VOLUMES=1 deletes volumes" 1 grep -q 'docker-compose.yaml down -v$' <<<"$out"

for v in VOLUMES=true VOLUMES=yes VOLUMES=2; do
	if out=$(down $v); then
		echo "FAIL: make down $v must be rejected, got: $out"
		fail=1
	else
		check "make down $v explains the allowed values" 1 grep -q 'VOLUMES must be 1' <<<"$out"
	fi
done

out=$(env -u HTTP_PORT make -s -n up 2>&1)
check "make up leaves HTTP_PORT to Compose/deploy/.env" 0 grep -q 'HTTP_PORT=' <<<"$out"
check "make up probes the port Compose published" 1 grep -q 'port caddy 8000' <<<"$out"
out=$(make -s -n up HTTP_PORT=8123 2>&1)
check "make up HTTP_PORT=8123 passes the override to Compose" 1 grep -q '^HTTP_PORT=8123 docker compose' <<<"$out"

if [ "$fail" != 0 ]; then
	exit 1
fi
echo "makefile-test: ok"
