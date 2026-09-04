#!/usr/bin/env sh
# Records the traces the catalog is verified against. Expects auth to be
# listening on 8080 (see ../../auth/README.md); without it the checkout is
# answered by the stand-in and no call to auth is recorded.
set -eu
cd "$(dirname "$0")/.."

rm -f telemetry/out/traces.jsonl
docker compose up -d postgres otel-collector
docker compose restart otel-collector >/dev/null
until docker compose ps --format '{{.Status}}' postgres | grep -q healthy; do sleep 1; done

export STORE_POSTGRES_URI='postgres://cart:cart@localhost:5433/cart'
export TRACER_URI=http://localhost:4327 SERVICE_NAME=cart PORT=8081
export AUTH_URL="${AUTH_URL:-http://localhost:8080}"

npm run build >/dev/null
node dist/main.js >telemetry/out/cart.log 2>&1 &
pid=$!
trap 'kill $pid 2>/dev/null || true' EXIT
until curl -s -o /dev/null localhost:8081/v1/baskets/00000000-0000-4000-8000-000000000000; do sleep 1; done

json='Content-Type: application/json'
email="rec-$(date +%s)@example.com"
curl -sf -X POST localhost:8080/v1/users -H "$json" -d "{\"email\":\"$email\",\"password\":\"Passw0rdish!\"}" -o /dev/null
bearer=$(curl -sf -X POST localhost:8080/v1/sessions -H "$json" -d "{\"email\":\"$email\",\"password\":\"Passw0rdish!\"}" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')

created=$(curl -sf -X POST localhost:8081/v1/baskets)
basket=$(echo "$created" | sed -n 's/.*"basketId":"\([^"]*\)".*/\1/p')
token=$(echo "$created" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
curl -sf -X POST "localhost:8081/v1/baskets/$basket/items" -H "$json" -H "X-Basket-Token: $token" -d '{"sku":"tea","quantity":2,"unitPrice":{"amountMinor":450,"currency":"EUR"}}' -o /dev/null
curl -sf -X POST "localhost:8081/v1/baskets/$basket/items" -H "$json" -H "X-Basket-Token: $token" -d '{"sku":"cup","quantity":1,"unitPrice":{"amountMinor":1200,"currency":"EUR"}}' -o /dev/null
curl -sf -X DELETE "localhost:8081/v1/baskets/$basket/items/cup" -H "X-Basket-Token: $token" -o /dev/null
curl -sf "localhost:8081/v1/baskets/$basket" -H "X-Basket-Token: $token" -o /dev/null

visitor=$(curl -sf -X POST localhost:8081/v1/baskets)
vid=$(echo "$visitor" | sed -n 's/.*"basketId":"\([^"]*\)".*/\1/p')
vtoken=$(echo "$visitor" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
curl -sf -X POST "localhost:8081/v1/baskets/$vid/items" -H "$json" -H "X-Basket-Token: $vtoken" -d '{"sku":"spoon","quantity":3,"unitPrice":{"amountMinor":150,"currency":"EUR"}}' -o /dev/null
mine=$(curl -sf -X POST "localhost:8081/v1/baskets/$vid/merge" -H "$json" -H "Authorization: Bearer $bearer" -d "{\"fromBasketId\":\"$vid\",\"fromToken\":\"$vtoken\"}")
mid=$(echo "$mine" | sed -n 's/.*"basketId":"\([^"]*\)".*/\1/p')
curl -sf -X POST "localhost:8081/v1/baskets/$mid/checkout" -H "Authorization: Bearer $bearer" -o /dev/null

sleep 8 # the batcher flushes every five seconds
kill $pid; wait $pid 2>/dev/null || true
trap - EXIT
sleep 2

node telemetry/scrub.mjs telemetry/out/traces.jsonl telemetry/traces.jsonl
