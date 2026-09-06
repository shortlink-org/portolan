// The wire form of the basket's events. One topic per aggregate, dotted the
// way a NATS subject is, because the topic in the row is the subject on the
// wire; the event's name travels on the message.
export const TOPIC = "shop.cart.basket";
