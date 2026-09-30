package jobs

import (
	"github.com/streadway/amqp"
)

type Config struct {
	Queue string `envconfig:"JOBS_QUEUE" default:"jobs.resize"`
}

func Run(url string, cfg Config) error {
	conn, err := amqp.Dial(url)
	if err != nil {
		return err
	}
	ch, err := conn.Channel()
	if err != nil {
		return err
	}
	if err := ch.Publish("", cfg.Queue, false, false, amqp.Publishing{}); err != nil {
		return err
	}
	if _, _, err := ch.Get("jobs.retry", false); err != nil {
		return err
	}
	_, err = ch.Consume(cfg.Queue, "", false, false, false, false, nil)
	return err
}
