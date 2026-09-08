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
	resp, err := extract(plugin.Input{Root: root, Commit: "abc", GeneratedAt: "2026-01-01T00:00:00Z"}, Options{Context: "ops", Service: "mailer"})
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
	if len(resp.Warnings()) != 1 || !strings.Contains(resp.Warnings()[0].Message, "no registered Worker") {
		t.Fatalf("warnings = %+v", resp.Warnings())
	}
}
