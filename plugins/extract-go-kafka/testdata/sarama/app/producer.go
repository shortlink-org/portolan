package app

import (
	"github.com/IBM/sarama"

	"example.com/billing/topics"
)

type Producer struct {
	sync  sarama.SyncProducer
	async sarama.AsyncProducer
}

func (p *Producer) Issue(payload []byte) error {
	msg := &sarama.ProducerMessage{Topic: topics.Invoices, Value: sarama.ByteEncoder(payload)}
	_, _, err := p.sync.SendMessage(msg)
	return err
}

func (p *Producer) Audit(payload []byte) {
	p.async.Input() <- &sarama.ProducerMessage{Topic: "billing.audit", Value: sarama.ByteEncoder(payload)}
}

func (p *Producer) Batch() error {
	return p.sync.SendMessages([]*sarama.ProducerMessage{
		{Topic: "billing.batch.first"},
		{Topic: "billing.batch.second"},
	})
}
