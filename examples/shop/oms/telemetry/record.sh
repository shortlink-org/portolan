#!/usr/bin/env sh
# Records the traces the catalog is verified against. Expects auth on 8080 and
# the cart on 8081 with NATS_URL set (see ../cart/telemetry/record.sh); without
# them there is no checkout to react to, and only the two rpcs are recorded.
set -eu
cd "$(dirname "$0")/.."

rm -f telemetry/out/traces.jsonl
docker compose up -d postgres otel-collector
if nc -z localhost 4222 2>/dev/null; then echo "nats: already listening on 4222"; else docker compose up -d nats; fi
docker compose restart otel-collector >/dev/null
until docker compose ps --format '{{.Status}}' postgres | grep -q healthy; do sleep 1; done
until nc -z localhost 4222 2>/dev/null; do sleep 1; done

export STORE_POSTGRES_URI='postgres://oms:oms@localhost:5434/oms'
export TRACER_URI=http://localhost:4337 SERVICE_NAME=oms GRPC_ADDR=127.0.0.1:50051
export NATS_URL=nats://localhost:4222

cargo build --quiet
./target/debug/oms >telemetry/out/oms.log 2>&1 &
pid=$!
trap 'kill $pid 2>/dev/null || true' EXIT
until nc -z localhost 50051 2>/dev/null; do sleep 1; done

json='Content-Type: application/json'
email="rec-$(date +%s)@example.com"
curl -sf -X POST localhost:8080/v1/users -H "$json" -d "{\"email\":\"$email\",\"password\":\"Passw0rdish!\"}" -o /dev/null
bearer=$(curl -sf -X POST localhost:8080/v1/sessions -H "$json" -d "{\"email\":\"$email\",\"password\":\"Passw0rdish!\"}" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')

created=$(curl -sf -X POST localhost:8081/v1/baskets -H "Authorization: Bearer $bearer")
basket=$(echo "$created" | sed -n 's/.*"basketId":"\([^"]*\)".*/\1/p')
token=$(echo "$created" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
curl -sf -X POST "localhost:8081/v1/baskets/$basket/items" -H "$json" -H "X-Basket-Token: $token" -d '{"sku":"tea","quantity":2,"unitPrice":{"amountMinor":450,"currency":"EUR"}}' -o /dev/null
curl -sf -X POST "localhost:8081/v1/baskets/$basket/checkout" -H "Authorization: Bearer $bearer" -o /dev/null

# The order takes the basket's id; give the relay and the subscriber a moment.
sleep 3
./target/debug/oms-call get "$basket"
./target/debug/oms-call cancel "$basket"
./target/debug/oms-call get nope >/dev/null 2>&1 || true

sleep 8 # the batcher flushes every five seconds
kill $pid; wait $pid 2>/dev/null || true
trap - EXIT
sleep 2

node telemetry/scrub.mjs telemetry/out/traces.jsonl telemetry/traces.jsonl
