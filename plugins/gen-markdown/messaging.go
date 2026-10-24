package genmarkdown

import (
	"strings"

	"github.com/shortlink-org/portolan/catalog"
)

const messagingPage = "messaging.md"

type messagingPublisher struct {
	services map[string]struct{}
	eventID  string
}

func messagingKey(channel, name string) string { return channel + "\x00" + name }

func (s *site) messagingCounts() (channels, messages int) {
	for i := range s.cat.Contexts {
		for j := range s.cat.Contexts[i].Services {
			channels += len(s.cat.Contexts[i].Services[j].Channels)
			for _, channel := range s.cat.Contexts[i].Services[j].Channels {
				messages += len(channel.Messages)
			}
		}
	}
	return channels, messages
}

// renderMessaging is an estate-wide documentation index. Its rows are claims
// made by one service, not globally merged channels: an equal address is useful
// for comparison, but it is not proof that two declarations are one entity.
func (s *site) renderMessaging() {
	channelCount, _ := s.messagingCounts()
	if channelCount == 0 {
		return
	}

	publishers := map[string]*messagingPublisher{}
	addPublisher := func(key, service, eventID string) {
		publisher := publishers[key]
		if publisher == nil {
			publisher = &messagingPublisher{services: map[string]struct{}{}}
			publishers[key] = publisher
		}
		publisher.services[service] = struct{}{}
		if publisher.eventID == "" {
			publisher.eventID = eventID
		}
	}
	for i := range s.cat.Contexts {
		for j := range s.cat.Contexts[i].Services {
			svc := &s.cat.Contexts[i].Services[j]
			for k := range svc.Aggregates {
				for e := range svc.Aggregates[k].Events {
					event := &svc.Aggregates[k].Events[e]
					if event.Wire != nil && event.Wire.Channel != "" {
						addPublisher(messagingKey(event.Wire.Channel, event.Wire.Name), svc.ID, event.ID)
					}
				}
			}
			for _, channel := range svc.Channels {
				for _, message := range channel.Messages {
					if message.Direction == catalog.ChannelSend {
						addPublisher(messagingKey(channel.Address, message.Name), svc.ID, "")
					}
				}
			}
		}
	}

	var channelRows, messageRows [][]string
	for i := range s.cat.Contexts {
		for j := range s.cat.Contexts[i].Services {
			svc := &s.cat.Contexts[i].Services[j]
			for k := range svc.Channels {
				channel := &svc.Channels[k]
				send, receive := false, false
				issue := "clear"
				if len(channel.Messages) == 0 {
					issue = "no operation"
				}
				for _, message := range channel.Messages {
					if message.Direction == catalog.ChannelSend {
						send = true
					} else {
						receive = true
					}
					publisherCount := 0
					if publisher := publishers[messagingKey(channel.Address, message.Name)]; publisher != nil {
						publisherCount = len(publisher.services)
					}
					if publisherCount > 1 {
						issue = "multiple publishers"
					} else if issue != "multiple publishers" && message.Direction == catalog.ChannelReceive && publisherCount == 0 {
						issue = "no publisher"
					}
				}
				direction := "none"
				if send && receive {
					direction = "both"
				} else if send {
					direction = "send"
				} else if receive {
					direction = "receive"
				}
				protocol := channel.Protocol
				if protocol == "" {
					protocol = "unknown"
				}
				channelRows = append(channelRows, []string{
					code(channel.Address), protocol, s.ref(messagingPage, svc.ID, svc.ID), direction,
					plural(len(channel.Messages), "message"), issue, s.source(messagingPage, channel.Source, svc), channel.Doc,
				})

				for m := range channel.Messages {
					message := &channel.Messages[m]
					publisher := publishers[messagingKey(channel.Address, message.Name)]
					messageIssue := "clear"
					if publisher == nil || len(publisher.services) == 0 {
						if message.Direction == catalog.ChannelReceive {
							messageIssue = "no publisher"
						}
					} else if len(publisher.services) > 1 {
						messageIssue = "multiple publishers"
					}
					name := code(message.Name)
					event := ""
					if publisher != nil && publisher.eventID != "" {
						event = s.eventRef(messagingPage, publisher.eventID, message.Name)
					}
					format := message.Encoding
					if format == "" {
						format = message.ContentType
					}
					if format == "" && message.Schema != nil {
						format = message.Schema.Type
					}
					messageRows = append(messageRows, []string{
						name, string(message.Direction), code(channel.Address), protocol,
						s.ref(messagingPage, svc.ID, svc.ID), format, event, messageIssue,
						s.source(messagingPage, channel.Source, svc), message.Doc,
					})
				}
			}
		}
	}

	var b strings.Builder
	b.WriteString("# Messaging\n\n")
	b.WriteString(s.stamp() + "\n")
	b.WriteString("Every row is one service's declaration. Matching channel and message names are shown together for comparison, but are not silently merged into global entities.\n")
	section(&b, "Channels", table(
		[]string{"Channel", "Protocol", "Service", "Used to", "Messages", "Issue", "Source", "Doc"},
		channelRows,
	))
	section(&b, "Messages", table(
		[]string{"Message", "Direction", "Channel", "Protocol", "Service", "Format", "Domain event", "Issue", "Source", "Doc"},
		messageRows,
	))
	s.b.file(messagingPage, b.String())
}
