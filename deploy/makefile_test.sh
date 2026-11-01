#!/usr/bin/env bash
# Dry-run checks (make -n; nothing is executed) of the Compose targets:
# `make down` deletes the database volume only with VOLUMES=1, and
# `make up` leaves HTTP_PORT to Compose (deploy/.env) unless it is given
# on the make command line. `make dev` / `preview` pass FIXTURE / SNAPSHOT
# [RESUME=now] to the server (D-066) and nothing when they are empty;
# `make snapshot` / `snapshot-load` call the dev routes.
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

for target in dev preview; do
	out=$(make -s -n "$target" 2>&1)
	check "make $target passes no start flag by default" 0 grep -qE -- '--(fixture|snapshot|resume-now)' <<<"$out"
	out=$(make -s -n "$target" FIXTURE= SNAPSHOT= RESUME= 2>&1)
	check "make $target with empty variables passes no start flag" 0 grep -qE -- '--(fixture|snapshot|resume-now)' <<<"$out"
	out=$(make -s -n "$target" FIXTURE=played 2>&1)
	check "make $target FIXTURE=played passes --fixture" 1 grep -q -- "cmd/server --dev .*--fixture 'played'" <<<"$out"
	out=$(make -s -n "$target" SNAPSHOT=snap.json 2>&1)
	check "make $target SNAPSHOT passes an absolute --snapshot" 1 grep -q -- "--snapshot '$PWD/snap.json'" <<<"$out"
	check "make $target SNAPSHOT without RESUME keeps the times" 0 grep -q -- '--resume-now' <<<"$out"
	out=$(make -s -n "$target" SNAPSHOT=snap.json RESUME=now 2>&1)
	check "make $target SNAPSHOT RESUME=now passes --resume-now" 1 grep -q -- "--snapshot '$PWD/snap.json' --resume-now" <<<"$out"
done
if out=$(make -s -n dev RESUME=later 2>&1); then
	echo "FAIL: make dev RESUME=later must be rejected, got: $out"
	fail=1
else
	check "make dev RESUME=later explains the allowed value" 1 grep -q "RESUME must be 'now'" <<<"$out"
fi

out=$(make -s -n snapshot 2>&1)
check "make snapshot GETs the dev snapshot route" 1 grep -q "api/v1/dev/snapshot" <<<"$out"
check "make snapshot defaults to .snapshots/" 1 grep -q '\.snapshots/' <<<"$out"
out=$(make -s -n snapshot OUT=/tmp/x.json DEV_API=http://localhost:9999 2>&1)
check "make snapshot honours OUT and DEV_API" 1 grep -q "out='/tmp/x.json'" <<<"$out"
check "make snapshot honours DEV_API" 1 grep -q "http://localhost:9999/api/v1/dev/snapshot" <<<"$out"
out=$(make -s -n snapshot-load FILE=f.json 2>&1)
check "make snapshot-load POSTs without resume" 1 grep -q -- "-X POST .*@'f.json' 'http://localhost:8080/api/v1/dev/snapshot'" <<<"$out"
out=$(make -s -n snapshot-load FILE=f.json RESUME=now 2>&1)
check "make snapshot-load RESUME=now adds ?resume=now" 1 grep -q 'dev/snapshot?resume=now' <<<"$out"
if out=$(make -s snapshot-load 2>&1); then
	echo "FAIL: make snapshot-load without FILE must fail"
	fail=1
else
	check "make snapshot-load without FILE explains" 1 grep -q 'FILE=<path> is required' <<<"$out"
fi

if [ "$fail" != 0 ]; then
	exit 1
fi
echo "makefile-test: ok"
