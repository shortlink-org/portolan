# Recording

`record.sh` runs the service against its collector and drives one checkout
through the cart and two calls into this service, then copies the collector's
recording into `traces.jsonl`, scrubbed of what a committed trace must not
carry. The catalog reads that file to mark hops as observed.

It expects auth on 8080 and the cart on 8081, with the cart pointed at the
same NATS: that is what makes `cart → bus → oms` a hop somebody saw run.
