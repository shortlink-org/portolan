// Package dto is the row shape of a quote, and the topic its events go out on.
package dto

// Topic is where this domain's events go: one subject per aggregate, dotted the
// way a NATS subject is. The catalog reads it as the channel of every event the
// quote raises.
const Topic = "shop.pricing.quote"
