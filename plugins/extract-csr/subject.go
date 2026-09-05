package main

// Reading a subject name.
//
// A registry stores subjects. A subject is whatever the producer's serializer
// decided to call the registration, and the rule it used - the
// SubjectNameStrategy - is not recorded anywhere in the answer. The same
// string "shop.oms.order-value" is a topic plus a suffix under one strategy
// and a record's full name under another, and nothing but the manifest can
// say which.
//
// So the strategy is told, and everything here is the consequence of being
// told it.

import "strings"

// Strategies, by the names Confluent's own serializers go by, shortened.
const (
	StrategyTopic       = "topic"        // TopicNameStrategy
	StrategyRecord      = "record"       // RecordNameStrategy
	StrategyTopicRecord = "topic-record" // TopicRecordNameStrategy
)

// registration is what a subject name resolves to.
type registration struct {
	// Topic is the channel address the schema is registered against, empty
	// under RecordNameStrategy - which deliberately says nothing about topics,
	// so a record can be reused across many.
	Topic string

	// Record is the schema's full name, and it is the name a message on the
	// bus goes by - the same string an event's Wire.Name carries.
	Record string

	// Key is set for the "-key" half of a topic. A key is not a message on the
	// channel; it is part of every message on it. So its shape is kept and its
	// name is not put on the channel.
	Key bool
}

// read resolves a subject.
//
// declared is the record's full name as the schema itself gives it, which is
// the only reliable way to split a TopicRecordNameStrategy subject: the
// separator is a hyphen and both halves may contain one, so the suffix is
// matched rather than searched for. Under the other two strategies it is a
// fallback for a schema that names itself nothing.
func read(subject, declared, strategy string) registration {
	switch strategy {
	case StrategyRecord:
		return registration{Record: firstNonEmpty(declared, subject)}

	case StrategyTopicRecord:
		if declared != "" && strings.HasSuffix(subject, "-"+declared) {
			return registration{
				Topic:  strings.TrimSuffix(subject, "-"+declared),
				Record: declared,
			}
		}
		// The schema did not name itself, or named itself something the
		// subject does not end with. Splitting at the first hyphen is the only
		// thing left, and it is right for the ordinary "orders-com.acme.Order".
		topic, record, found := strings.Cut(subject, "-")
		if !found {
			return registration{Record: firstNonEmpty(declared, subject)}
		}

		return registration{Topic: topic, Record: firstNonEmpty(declared, record)}

	default: // StrategyTopic
		if topic, found := strings.CutSuffix(subject, "-value"); found {
			return registration{Topic: topic, Record: firstNonEmpty(declared, subject)}
		}
		if topic, found := strings.CutSuffix(subject, "-key"); found {
			return registration{Topic: topic, Record: firstNonEmpty(declared, subject), Key: true}
		}

		// A subject under this strategy always ends in one of the two, so one
		// that does not is a subject registered some other way. It still names
		// a shape; it just cannot name a topic.
		return registration{Record: firstNonEmpty(declared, subject)}
	}
}

func strategyOf(declared string) string {
	switch declared {
	case StrategyRecord, StrategyTopicRecord, StrategyTopic:
		return declared
	}

	return StrategyTopic
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}

	return ""
}
