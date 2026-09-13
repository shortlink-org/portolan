# Checkout golden path
owner: shop
source: test/integration/checkout_test.go
slug: checkout-golden
trigger: http high "POST /checkout"

An executable authoring fixture that exercises every flow frame and the
integration metadata a reader needs to follow the journey into other catalog
entities.

## Participants
- customer: actor
- cart-db: store in shop ref shop.cart.pg "cart database"
- carrier: external ref delivery.carrier "carrier API"

## Steps
customer -> shop.cart: rpc shop.v1.Cart/Checkout as "Checkout" [verified] #request
shop.cart -> cart-db: reserve cart via-store shop.cart.pg write carts:* #store-write

alt cart has stock #stock-choice
  shop.cart -> bus: event shop.cart.CartReserved #reserved
else cart is empty
  shop.cart -> customer: call reject checkout #rejected
  stop
end

par notify and quote #fan-out
  shop.cart -> bus: event shop.cart.CartReserved #notify
and
  shop.cart -> delivery.core: rpc delivery.v1.Delivery/GetQuote #quote
end

loop until the outbox is empty #relay
  shop.cart -> cart-db: read pending outbox via-store shop.cart.pg read outbox:* #store-read
end

shop.cart -> carrier: rpc carrier.v1.Shipping/Book [unresolved] #external-unresolved
