#!/usr/bin/env sh
# Records the traces the catalog is verified against.
#
# Starts the database and the collector, runs the service with tracing on,
# drives every endpoint once - including the password change that makes the
# policy run - and writes the scrubbed recording to telemetry/traces.jsonl.
# Re-run it when the service changes what it does; `npm run gen` then reads
# the new recording and `gen:check` holds the catalog to it.
set -eu
cd "$(dirname "$0")/.."

rm -f telemetry/out/traces.jsonl
docker compose up -d postgres otel-collector
docker compose restart otel-collector >/dev/null
until docker compose ps --format '{{.Status}}' postgres | grep -q healthy; do sleep 1; done

export STORE_TYPE=postgres
export STORE_POSTGRES_URI='postgres://auth:auth@localhost:5432/auth?sslmode=disable'
export TRACER_URI=localhost:4317 SERVICE_NAME=auth AUTH_ADDR=:8080

go build -o telemetry/out/auth ./cmd/auth
telemetry/out/auth >telemetry/out/auth.log 2>&1 &
pid=$!
trap 'kill $pid 2>/dev/null || true' EXIT
until curl -sf -o /dev/null localhost:8080/v1/users/nobody -w '' || [ "$(curl -s -o /dev/null -w '%{http_code}' localhost:8080/v1/users/nobody)" = 404 ]; do sleep 1; done

email="rec-$(date +%s)@example.com"
json='Content-Type: application/json'
curl -sf -X POST localhost:8080/v1/users -H "$json" -d "{\"email\":\"$email\",\"password\":\"Passw0rdish!\"}" -o /dev/null
token=$(curl -sf -X POST localhost:8080/v1/sessions -H "$json" -d "{\"email\":\"$email\",\"password\":\"Passw0rdish!\"}" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
keep=$(curl -sf -X POST localhost:8080/v1/sessions -H "$json" -d "{\"email\":\"$email\",\"password\":\"Passw0rdish!\"}" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
curl -sf localhost:8080/v1/sessions/current -H "Authorization: Bearer $keep" -o /dev/null
curl -sf -X POST localhost:8080/v1/users/me/password -H "$json" -H "Authorization: Bearer $keep" -d '{"currentPassword":"Passw0rdish!","newPassword":"N3wPassw0rdish!"}' -o /dev/null
sleep 6 # the relay delivers PasswordChanged and the policy ends the other session
curl -s localhost:8080/v1/sessions/current -H "Authorization: Bearer $token" -o /dev/null
curl -sf -X DELETE localhost:8080/v1/sessions/current -H "Authorization: Bearer $keep" -o /dev/null
user=$(curl -sf -X POST localhost:8080/v1/users -H "$json" -d "{\"email\":\"other-$email\",\"password\":\"Passw0rdish!\"}" | sed -n 's/.*"userId":"\([^"]*\)".*/\1/p')
curl -sf "localhost:8080/v1/users/$user" -o /dev/null

sleep 8 # the batcher flushes every five seconds
kill $pid; wait $pid 2>/dev/null || true
trap - EXIT
sleep 2

node telemetry/scrub.mjs telemetry/out/traces.jsonl telemetry/traces.jsonl
