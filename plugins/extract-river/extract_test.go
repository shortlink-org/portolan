package extractriver

import (
	"encoding/json"
	"os"
	"path/filepath"
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
	resp, err := extract(plugin.Input{Root: root}, Options{Context: "ops", Service: "mailer"})
	if err != nil {
		t.Fatal(err)
	}
	var out catalog.Catalog
	if err := json.Unmarshal([]byte(resp.Files[0].Contents), &out); err != nil {
		t.Fatal(err)
	}
	return out, resp
}

func TestExtractsQueuePayloadAndLifecycle(t *testing.T) {
	root := t.TempDir()
	write(t, root, "go.mod", "module example.com/mailer\n")
	write(t, root, "queue/names.go", `package queue
const Critical = "critical_mail"
`)
	write(t, root, "jobs/send.go", `package jobs
type SendArgs struct {
  MessageID string `+"`json:\"message_id\"`"+`
  Attempts int `+"`json:\"attempts,omitempty\"`"+`
}
func (SendArgs) Kind() string { return "send_mail" }
`)
	write(t, root, "jobs/worker.go", `package jobs
import (
  "context"
  "github.com/riverqueue/river"
)
type SendWorker struct { river.WorkerDefaults[SendArgs] }
func (*SendWorker) Work(context.Context, *river.Job[SendArgs]) error { return nil }
`)
	write(t, root, "app/run.go", `package app
import (
  "context"
  "github.com/riverqueue/river"
  "example.com/mailer/jobs"
  "example.com/mailer/queue"
)
func setup(workers *river.Workers, client interface { Insert(context.Context, river.JobArgs, *river.InsertOpts) (any, error) }, ctx context.Context) {
  river.AddWorker(workers, &jobs.SendWorker{})
  args := jobs.SendArgs{MessageID: "1"}
  _, _ = client.Insert(ctx, args, &river.InsertOpts{Queue: queue.Critical})
}
`)

	out, _ := extracted(t, root)
	service := out.Contexts[0].Services[0]
	if len(service.Channels) != 1 {
		t.Fatalf("channels = %+v", service.Channels)
	}
	channel := service.Channels[0]
	if channel.Address != "critical_mail" || channel.Kind != catalog.ChannelKindJob {
		t.Fatalf("channel = %+v", channel)
	}
	if len(channel.Messages) != 2 || channel.Messages[0].Direction != catalog.ChannelSend || channel.Messages[1].Direction != catalog.ChannelReceive {
		t.Fatalf("messages = %+v", channel.Messages)
	}
	if !strings.Contains(channel.Messages[0].Doc, "message_id string") {
		t.Errorf("payload doc = %q", channel.Messages[0].Doc)
	}
	if len(out.Flows) != 1 || len(out.Flows[0].Steps) != 2 {
		t.Fatalf("flows = %+v", out.Flows)
	}
	if out.Flows[0].Steps[0].(*catalog.Step).Label != "enqueue send_mail" || out.Flows[0].Steps[1].(*catalog.Step).Label != "SendWorker.Work" {
		t.Fatalf("steps = %+v", out.Flows[0].Steps)
	}
	if got := out.Flows[0].Steps[1].(*catalog.Step).ContinuesAt; got != "jobs:SendWorker.Work" {
		t.Fatalf("worker continuation = %q", got)
	}
	if got := out.Flows[0].EntryPoint; got != "app:setup" {
		t.Fatalf("producer entrypoint = %q", got)
	}
	enqueue := out.Flows[0].Steps[0].(*catalog.Step).Handoff
	work := out.Flows[0].Steps[1].(*catalog.Step).Handoff
	if enqueue == nil || work == nil || enqueue.Direction != "send" || work.Direction != "receive" || enqueue.Transport != "river" || enqueue.Channel != "critical_mail" || enqueue.Message != "send_mail" {
		t.Fatalf("job handoffs = enqueue %+v, work %+v", enqueue, work)
	}
}

func TestProducerWithoutRegisteredWorkerStaysVisible(t *testing.T) {
	root := t.TempDir()
	write(t, root, "go.mod", "module example.com/jobs\n")
	write(t, root, "job.go", `package jobs
import (
  "context"
  "github.com/riverqueue/river"
)
type CleanupArgs struct{}
func (CleanupArgs) Kind() string { return "cleanup" }
func enqueue(client interface { Insert(context.Context, river.JobArgs, *river.InsertOpts) (any, error) }, ctx context.Context) {
  _, _ = client.Insert(ctx, CleanupArgs{}, nil)
}
`)

	out, resp := extracted(t, root)
	if got := out.Contexts[0].Services[0].Channels[0].Address; got != "default" {
		t.Fatalf("queue = %q", got)
	}
	if len(out.Flows) != 0 {
		t.Fatalf("unexpected flows: %+v", out.Flows)
	}
	if !strings.Contains(resp.Files[0].Contents, `"flows": []`) {
		t.Fatalf("empty flows were not encoded as an array: %s", resp.Files[0].Contents)
	}
	if len(resp.Warnings()) != 1 || !strings.Contains(resp.Warnings()[0].Message, "no registered Worker") {
		t.Fatalf("warnings = %+v", resp.Warnings())
	}
}

func TestFollowsJobsThroughConstructorsWrappersAndConfig(t *testing.T) {
	root := t.TempDir()
	write(t, root, "go.mod", "module example.com/billing\n")
	write(t, root, "config/config.go", `package config
type Queues struct {
  Invoices string `+"`envconfig:\"INVOICE_QUEUE\" default:\"invoices\"`"+`
}
`)
	write(t, root, "jobs/kinds.go", `package jobs
type Kind string
const KindIssue Kind = "issue_invoice"
`)
	write(t, root, "jobs/issue.go", `package jobs
import (
  "context"
  "github.com/riverqueue/river"
)
type IssueArgs struct { InvoiceID string `+"`json:\"invoice_id\"`"+` }
func (IssueArgs) Kind() string { return string(KindIssue) }
type IssueWorker struct { river.WorkerDefaults[IssueArgs] }
func NewIssueWorker(deps any) *IssueWorker { return &IssueWorker{} }
func (*IssueWorker) Work(context.Context, *river.Job[IssueArgs]) error { return nil }
`)
	write(t, root, "jobs/remind.go", `package jobs
import (
  "context"
  "github.com/riverqueue/river"
)
type RemindArgs struct{}
func (RemindArgs) Kind() string { return "remind" }
func (RemindArgs) InsertOpts() river.InsertOpts { return river.InsertOpts{Queue: "reminders"} }
type RemindWorker struct { river.WorkerDefaults[RemindArgs] }
func (*RemindWorker) Work(context.Context, *river.Job[RemindArgs]) error { return nil }
`)
	write(t, root, "jobs/archive.go", `package jobs
import (
  "context"
  "github.com/riverqueue/river"
)
type ArchiveArgs struct{}
func (ArchiveArgs) Kind() string { return "archive" }
type ArchiveWorker struct { river.WorkerDefaults[ArchiveArgs] }
func (*ArchiveWorker) Work(context.Context, *river.Job[ArchiveArgs]) error { return nil }
`)
	write(t, root, "queue/enqueue.go", `package queue
import (
  "context"
  "github.com/riverqueue/river"
  "example.com/billing/config"
)
type Enqueuer struct { client *river.Client[any]; cfg config.Queues }
func (e *Enqueuer) Enqueue(ctx context.Context, args river.JobArgs, opts *river.InsertOpts) error {
  _, err := e.client.Insert(ctx, args, opts)
  return err
}
func (e *Enqueuer) Many(ctx context.Context) {
  batch := []river.InsertManyParams{{Args: jobsRemind()}}
  _, _ = e.client.InsertMany(ctx, batch)
}
func (e *Enqueuer) Dynamic(ctx context.Context, args river.JobArgs) {
  _, _ = e.client.Insert(ctx, args, nil)
}
`)
	write(t, root, "queue/remind.go", `package queue
import "example.com/billing/jobs"
func jobsRemind() jobs.RemindArgs { return jobs.RemindArgs{} }
`)
	write(t, root, "app/app.go", `package app
import (
  "context"
  "github.com/riverqueue/river"
  "example.com/billing/config"
  "example.com/billing/jobs"
  "example.com/billing/queue"
)
func Issue(ctx context.Context, e *queue.Enqueuer, cfg config.Queues) {
  _ = issue(ctx, e, jobs.IssueArgs{InvoiceID: "1"}, cfg)
}
func issue(ctx context.Context, e *queue.Enqueuer, args jobs.IssueArgs, cfg config.Queues) error {
  return e.Enqueue(ctx, args, &river.InsertOpts{Queue: cfg.Invoices})
}
func Workers(deps any) *river.Workers {
  workers := river.NewWorkers()
  river.AddWorker(workers, jobs.NewIssueWorker(deps))
  river.AddWorker(workers, &jobs.RemindWorker{})
  river.AddWorker(workers, &jobs.ArchiveWorker{})
  return workers
}
func Client(workers *river.Workers) {
  _, _ = river.NewClient[any](nil, &river.Config{
    Queues: map[string]river.QueueConfig{"invoices": {MaxWorkers: 4}, river.QueueDefault: {MaxWorkers: 1}, "reminders": {MaxWorkers: 1}},
    Workers: workers,
  })
}
`)
	write(t, root, "app/wire.go", `package app
import (
  "context"
  "github.com/riverqueue/river"
  "example.com/billing/config"
  "example.com/billing/jobs"
  "example.com/billing/queue"
)
type Config struct { Queues config.Queues }
func send(ctx context.Context, e *queue.Enqueuer, cfg Config) {
  _ = e.Enqueue(ctx, jobs.IssueArgs{InvoiceID: "2"}, &river.InsertOpts{Queue: invoiceQueue(cfg)})
}
func invoiceQueue(cfg Config) string { return cfg.Queues.Invoices }
`)

	out, resp := extracted(t, root)
	service := out.Contexts[0].Services[0]
	byAddress := map[string]catalog.Channel{}
	for _, channel := range service.Channels {
		byAddress[channel.Address] = channel
	}
	if len(service.Channels) != 2 {
		t.Fatalf("channels = %+v", service.Channels)
	}
	// IssueArgs reaches Insert through a wrapper taking river.JobArgs: two
	// callers pass the concrete type, one with the queue read off a config
	// default through a parameter, one through a single-return helper over a
	// nested field. The worker is registered through its constructor.
	invoices := byAddress["invoices"]
	if len(invoices.Messages) != 2 || invoices.Messages[0].Name != "issue_invoice" || invoices.Messages[0].Direction != catalog.ChannelSend || invoices.Messages[1].Title != "IssueWorker" {
		t.Fatalf("invoices = %+v", invoices)
	}
	// RemindArgs chooses `reminders` through its own InsertOpts(); the batch
	// insert reaches it through a constructor-typed element.
	reminders := byAddress["reminders"]
	if len(reminders.Messages) != 2 || reminders.Messages[0].Name != "remind" || reminders.Messages[1].Direction != catalog.ChannelReceive {
		t.Fatalf("reminders = %+v", reminders)
	}
	// ArchiveArgs has no Insert in this tree; the client works three queues,
	// so its queue stays unresolved and the worker is kept as an unresolved flow.
	flows := map[string]catalog.Flow{}
	for _, flow := range out.Flows {
		flows[flow.Slug] = flow
	}
	archive, ok := flows["mailer-river-archive"]
	if !ok || len(archive.Steps) != 1 {
		t.Fatalf("archive flow = %+v (all: %v)", archive, keys(flows))
	}
	if step := archive.Steps[0].(*catalog.Step); step.Status != catalog.StatusUnresolved || step.Handoff.Channel != "" || step.From != "river" {
		t.Fatalf("archive step = %+v", step)
	}
	warnings := []string{}
	for _, warning := range resp.Warnings() {
		warnings = append(warnings, warning.Message)
	}
	joined := strings.Join(warnings, "\n")
	if !strings.Contains(joined, "ArchiveWorker handles `archive`; no Insert of `archive` is in this tree") || !strings.Contains(joined, "nothing says which one carries it") {
		t.Fatalf("archive warning missing: %s", joined)
	}
	// Dynamic inserts a parameter no caller fills: the analyzer could not
	// resolve it, and says so at the call rather than staying silent.
	if !strings.Contains(joined, "Insert inserts `args`, whose job type this reader cannot resolve") {
		t.Fatalf("unresolved insert warning missing: %s", joined)
	}
	if strings.Contains(joined, "IssueWorker handles") {
		t.Fatalf("the wrapper-fed worker was reported as unfed: %s", joined)
	}
	for _, slug := range []string{"mailer-river-issue-invoice-invoices", "mailer-river-remind-reminders"} {
		if _, ok := flows[slug]; !ok {
			t.Fatalf("flow %s missing: %v", slug, keys(flows))
		}
	}
	// The client is configured to work `default` too, but nothing is
	// inserted on it here: a configured queue is not a claim about messages.
	if _, claimed := byAddress["default"]; claimed {
		t.Fatalf("default channel = %+v", byAddress["default"])
	}
}

func keys(flows map[string]catalog.Flow) []string {
	out := []string{}
	for key := range flows {
		out = append(out, key)
	}
	return out
}
