package app

import (
	"encoding/json"

	"example.com/mailer/api"
	"example.com/mailer/config"
	"github.com/ThreeDotsLabs/watermill"
	"github.com/ThreeDotsLabs/watermill/message"
)

const ConsumerGroup = "mail-workers"

func NewSubscriber(config.Bus, string) (message.Subscriber, error) { return nil, nil }

func publishFailure(pub message.Publisher, topic string) error {
	value := api.Failure{Reason: "bad"}
	payload, _ := json.Marshal(value)
	msg := message.NewMessage(watermill.NewUUID(), payload)
	return pub.Publish(topic, msg)
}

func Register(r *message.Router, cfg config.Bus, pub message.Publisher) {
	sub, _ := NewSubscriber(cfg, ConsumerGroup)
	handlerName := "mail_router"
	r.AddHandler(handlerName, cfg.Input, sub, "", nil, func(msg *message.Message) ([]*message.Message, error) {
		var input api.Input
		_ = json.Unmarshal(msg.Payload, &input)
		if !input.Valid {
			_ = publishFailure(pub, cfg.Errors)
			return nil, nil
		}
		value := api.Output{Accepted: true}
		payload, _ := json.Marshal(value)
		out := message.NewMessage(watermill.NewUUID(), payload)
		_ = pub.Publish(cfg.Output, out)
		return nil, nil
	})
}
