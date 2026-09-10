package extractgosqs

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
	"github.com/shortlink-org/portolan/plugin"
)

func write(t *testing.T, root, name, contents string) {
	t.Helper()
	path := filepath.Join(root, name)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(contents), 0o644); err != nil {
		t.Fatal(err)
	}
}

func extracted(t *testing.T, root string) (catalog.Catalog, plugin.Response) {
	t.Helper()
	resp, err := extract(plugin.Input{Root: root}, Options{Context: "shop", Service: "fulfillment"})
	if err != nil {
		t.Fatal(err)
	}
	var out catalog.Catalog
	if err := json.Unmarshal([]byte(resp.Files[0].Contents), &out); err != nil {
		t.Fatal(err)
	}
	return out, resp
}

func channels(out catalog.Catalog) map[string]catalog.Channel {
	byAddress := map[string]catalog.Channel{}
	for _, channel := range out.Contexts[0].Services[0].Channels {
		byAddress[channel.Address] = channel
	}
	return byAddress
}

func warnings(resp plugin.Response) []string {
	var out []string
	for _, warning := range resp.Warnings() {
		out = append(out, warning.Ref+": "+warning.Message)
	}
	return out
}

func TestReadsDirectCallsWithLiteralsConstantsAndURLs(t *testing.T) {
	root := t.TempDir()
	write(t, root, "go.mod", "module example.com/svc\n")
	write(t, root, "queues/queues.go", "package queues\n\nconst Orders = \"https://sqs.eu-west-1.amazonaws.com/123456789012/orders\"\n")
	write(t, root, "app/app.go", `package app

import (
	"context"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/sqs"

	"example.com/svc/queues"
)

type App struct {
	client *sqs.Client
}

func (a *App) Run(ctx context.Context) error {
	if _, err := a.client.SendMessage(ctx, &sqs.SendMessageInput{QueueUrl: aws.String(queues.Orders), MessageBody: aws.String("{}")}); err != nil {
		return err
	}
	in := &sqs.ReceiveMessageInput{QueueUrl: aws.String("shipments"), MaxNumberOfMessages: 10}
	_, err := a.client.ReceiveMessage(ctx, in)
	return err
}

func Direct(ctx context.Context, cfg aws.Config) error {
	client := sqs.NewFromConfig(cfg)
	url := aws.String("https://sqs.eu-west-1.amazonaws.com/123456789012/audit/")
	_, err := client.SendMessageBatch(ctx, &sqs.SendMessageBatchInput{QueueUrl: url})
	return err
}
`)

	out, resp := extracted(t, root)
	if len(resp.Warnings()) != 0 {
		t.Errorf("warnings: %v", warnings(resp))
	}
	got := channels(out)
	if len(got) != 3 {
		t.Fatalf("channels: got %d, want 3: %v", len(got), got)
	}

	orders := got["orders"]
	if orders.Title != "SQS queue" || orders.Kind != catalog.ChannelKindMessage {
		t.Errorf("orders: %+v", orders)
	}
	if orders.Source != "app/app.go:17" {
		t.Errorf("orders source: %q", orders.Source)
	}
	if !strings.Contains(orders.Doc, "Sent by `App.Run`.") {
		t.Errorf("orders doc: %q", orders.Doc)
	}
	if len(orders.Messages) != 0 {
		t.Errorf("a direct call names no message, got %v", orders.Messages)
	}
	if shipments := got["shipments"]; !strings.Contains(shipments.Doc, "Received by `App.Run`.") || shipments.Source != "app/app.go:20" {
		t.Errorf("shipments: %+v", shipments)
	}
	if audit := got["audit"]; !strings.Contains(audit.Doc, "Sent in batches by `Direct`.") || audit.Source != "app/app.go:27" {
		t.Errorf("audit: %+v", audit)
	}
}

// The URL is looked up by name at start and the name is what the page
// shows; the lookup itself is not a channel.
func TestReadsTheNameAskedOfGetQueueUrl(t *testing.T) {
	root := t.TempDir()
	write(t, root, "go.mod", "module example.com/svc\n")
	write(t, root, "app/app.go", `package app

import (
	"context"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
)

func Run(ctx context.Context, client *sqs.Client) error {
	out, err := client.GetQueueUrl(ctx, &sqs.GetQueueUrlInput{QueueName: aws.String("invoices")})
	if err != nil {
		return err
	}
	queueURL := aws.ToString(out.QueueUrl)
	_, err = client.SendMessage(ctx, &sqs.SendMessageInput{QueueUrl: &queueURL})
	return err
}
`)

	out, resp := extracted(t, root)
	if len(resp.Warnings()) != 0 {
		t.Errorf("warnings: %v", warnings(resp))
	}
	got := channels(out)
	if len(got) != 1 {
		t.Fatalf("channels: got %v", got)
	}
	if invoices := got["invoices"]; !strings.Contains(invoices.Doc, "Sent by `Run`.") || invoices.Source != "app/app.go:11" {
		t.Errorf("invoices: %+v", invoices)
	}
}

// The port: the adapter takes the queue and the name as parameters, the
// assembly hands it constants through the interface, and the channel is
// read at the assembly with the message the assembly named.
func TestFollowsTheQueueThroughThePort(t *testing.T) {
	root := t.TempDir()
	write(t, root, "go.mod", "module example.com/svc\n")
	write(t, root, "queue/queue.go", `package queue

import "context"

type Handler func(ctx context.Context, data []byte) error

type Queue interface {
	Send(ctx context.Context, queue, name string, payload []byte) error
	Receive(ctx context.Context, queue, name string, handler Handler) error
}
`)
	write(t, root, "queue/sqs.go", `package queue

import (
	"context"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
)

type SQS struct {
	client *sqs.Client
}

func (q *SQS) Send(ctx context.Context, queue, name string, payload []byte) error {
	_, err := q.client.SendMessage(ctx, &sqs.SendMessageInput{QueueUrl: aws.String(queue), MessageBody: aws.String(string(payload))})
	return err
}

func (q *SQS) Receive(ctx context.Context, queue, name string, handler Handler) error {
	for {
		out, err := q.client.ReceiveMessage(ctx, &sqs.ReceiveMessageInput{QueueUrl: aws.String(queue)})
		if err != nil {
			return err
		}
		_ = out
	}
}
`)
	write(t, root, "queue/log.go", `package queue

import "context"

type Log struct{}

func (Log) Send(ctx context.Context, queue, name string, payload []byte) error { return nil }

func (Log) Receive(ctx context.Context, queue, name string, handler Handler) error { return nil }
`)
	write(t, root, "orders/events.go", `package orders

const Queue = "orders-placed"

type OrderPlaced struct{}

func (OrderPlaced) Name() string { return "orders.OrderPlaced" }
`)
	write(t, root, "di/app.go", `package di

import (
	"context"

	"example.com/svc/orders"
	"example.com/svc/queue"
)

type App struct {
	queue queue.Queue
}

func (a *App) Start(ctx context.Context) error {
	if err := a.queue.Receive(ctx, orders.Queue, orders.OrderPlaced{}.Name(), a.handle); err != nil {
		return err
	}
	return a.queue.Send(ctx, "shipments-requested", "fulfillment.ShipmentRequested", nil)
}

func (a *App) handle(ctx context.Context, data []byte) error { return nil }
`)

	out, resp := extracted(t, root)
	if len(resp.Warnings()) != 0 {
		t.Errorf("warnings: %v", warnings(resp))
	}
	got := channels(out)
	if len(got) != 2 {
		t.Fatalf("channels: got %v", got)
	}

	placed := got["orders-placed"]
	if placed.Title != "SQS queue" || placed.Source != "di/app.go:15" {
		t.Errorf("placed: %+v", placed)
	}
	if !strings.Contains(placed.Doc, "Received by `SQS.Receive`.") {
		t.Errorf("placed doc: %q", placed.Doc)
	}
	if len(placed.Messages) != 1 || placed.Messages[0].Name != "orders.OrderPlaced" || placed.Messages[0].Direction != catalog.ChannelReceive {
		t.Errorf("placed messages: %+v", placed.Messages)
	}

	requested := got["shipments-requested"]
	if requested.Source != "di/app.go:18" || !strings.Contains(requested.Doc, "Sent by `SQS.Send`.") {
		t.Errorf("requested: %+v", requested)
	}
	if len(requested.Messages) != 1 || requested.Messages[0].Name != "fulfillment.ShipmentRequested" || requested.Messages[0].Direction != catalog.ChannelSend {
		t.Errorf("requested messages: %+v", requested.Messages)
	}
}

// The worker: the queue comes in at the constructor, sits in a field, and
// is read at Run. The constructor's argument is the assembly's config, whose
// default names the queue.
func TestReadsAFieldAtTheConstructorThatFilledIt(t *testing.T) {
	root := t.TempDir()
	write(t, root, "go.mod", "module example.com/svc\n")
	write(t, root, "worker/worker.go", `package worker

import (
	"context"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
)

type Worker struct {
	client   *sqs.Client
	queueURL string
	deadURL  string
}

func New(client *sqs.Client, queueURL, deadURL string) *Worker {
	w := &Worker{client: client, queueURL: queueURL}
	w.deadURL = deadURL
	return w
}

func (w *Worker) Run(ctx context.Context) error {
	_, err := w.client.ReceiveMessage(ctx, &sqs.ReceiveMessageInput{QueueUrl: aws.String(w.queueURL)})
	if err != nil {
		return err
	}
	_, err = w.client.SendMessage(ctx, &sqs.SendMessageInput{QueueUrl: &w.deadURL})
	return err
}
`)
	write(t, root, "di/app.go", `package di

import (
	"github.com/aws/aws-sdk-go-v2/service/sqs"

	"example.com/svc/worker"
)

type Config struct {
	Queue string `+"`envconfig:\"QUEUE_URL\" default:\"https://sqs.us-east-1.amazonaws.com/123456789012/jobs\"`"+`
	Dead  string `+"`envconfig:\"DEAD_URL\" default:\"jobs-dead\"`"+`
}

func Build(client *sqs.Client, cfg Config) *worker.Worker {
	return worker.New(client, cfg.Queue, cfg.Dead)
}
`)

	out, resp := extracted(t, root)
	if len(resp.Warnings()) != 0 {
		t.Errorf("warnings: %v", warnings(resp))
	}
	got := channels(out)
	if len(got) != 2 {
		t.Fatalf("channels: got %v", got)
	}
	if jobs := got["jobs"]; !strings.Contains(jobs.Doc, "Received by `Worker.Run`.") || jobs.Source != "di/app.go:15" {
		t.Errorf("jobs: %+v", jobs)
	}
	if dead := got["jobs-dead"]; !strings.Contains(dead.Doc, "Sent by `Worker.Run`.") || dead.Source != "di/app.go:15" {
		t.Errorf("jobs-dead: %+v", dead)
	}
}

func TestWarnsAboutAQueueItCannotFollow(t *testing.T) {
	root := t.TempDir()
	write(t, root, "go.mod", "module example.com/svc\n")
	write(t, root, "relay/relay.go", `package relay

import (
	"context"
	"os"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
)

func Deliver(ctx context.Context, client *sqs.Client, in *sqs.SendMessageInput) error {
	if _, err := client.SendMessage(ctx, in); err != nil {
		return err
	}
	_, err := client.SendMessage(ctx, &sqs.SendMessageInput{QueueUrl: aws.String(os.Getenv("QUEUE_URL"))})
	return err
}
`)

	out, resp := extracted(t, root)
	if got := channels(out); len(got) != 0 {
		t.Errorf("channels: %v", got)
	}
	notes := warnings(resp)
	if len(notes) != 2 {
		t.Fatalf("warnings: %v", notes)
	}
	if !strings.HasPrefix(notes[0], "relay/relay.go:12: SendMessage names no queue this reader can see") {
		t.Errorf("warnings: %v", notes)
	}
	if !strings.HasPrefix(notes[1], "relay/relay.go:15: queue of SendMessage could not be resolved") {
		t.Errorf("warnings: %v", notes)
	}
}

func TestIgnoresASendThatIsNotSQS(t *testing.T) {
	root := t.TempDir()
	write(t, root, "go.mod", "module example.com/svc\n")
	write(t, root, "app/app.go", `package app

import "context"

type Other struct{}

type Input struct{ QueueUrl *string }

func (Other) SendMessage(ctx context.Context, in *Input) {}

func Use(ctx context.Context, o Other) {
	url := "not-sqs"
	o.SendMessage(ctx, &Input{QueueUrl: &url})
}
`)

	out, resp := extracted(t, root)
	if got := channels(out); len(got) != 0 {
		t.Errorf("channels: %v", got)
	}
	notes := warnings(resp)
	if len(notes) != 1 || !strings.Contains(notes[0], "no aws-sdk-go-v2 SQS call was found") {
		t.Errorf("warnings: %v", notes)
	}
}

func TestOutputDoesNotDependOnDeclarationOrder(t *testing.T) {
	first := t.TempDir()
	second := t.TempDir()
	for i, root := range []string{first, second} {
		write(t, root, "go.mod", "module example.com/svc\n")
		a := "func A(ctx context.Context, c *sqs.Client) { c.SendMessage(ctx, &sqs.SendMessageInput{QueueUrl: aws.String(\"a-first\")}) }\n"
		b := "func B(ctx context.Context, c *sqs.Client) { c.ReceiveMessage(ctx, &sqs.ReceiveMessageInput{QueueUrl: aws.String(\"b-second\")}) }\n"
		body := a + b
		if i == 1 {
			body = b + a
		}
		write(t, root, "app/app.go", "package app\n\nimport (\n\t\"context\"\n\n\t\"github.com/aws/aws-sdk-go-v2/aws\"\n\t\"github.com/aws/aws-sdk-go-v2/service/sqs\"\n)\n\n"+body)
	}
	// The lines move with the declarations; everything else must not.
	one, _ := extracted(t, first)
	two, _ := extracted(t, second)
	forget := func(out catalog.Catalog) []catalog.Channel {
		channels := out.Contexts[0].Services[0].Channels
		for i := range channels {
			channels[i].Source = ""
		}
		return channels
	}
	if got, want := forget(one), forget(two); !reflect.DeepEqual(got, want) {
		t.Errorf("declaration order changed the output:\n%+v\n%+v", got, want)
	}
	if addresses := forget(one); addresses[0].Address != "a-first" || addresses[1].Address != "b-second" {
		t.Errorf("channels are not sorted by address: %+v", addresses)
	}
}
