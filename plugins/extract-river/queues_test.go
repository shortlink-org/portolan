package extractriver

import (
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
)

// kept is a service that keeps its queue name beside the client instead of
// writing it at each insert: a runner built by a constructor with the name
// the assembly reads off config, where config lowercases a branch whose tag
// default is known and falls back to River's default queue when it is empty.
// The args types choose only their attempts through InsertOpts(), and the
// workers reach river.AddWorker as fields of a struct a facade hands back.
func keptQueueTree(t *testing.T, branchTag string) string {
	t.Helper()
	root := t.TempDir()
	write(t, root, "go.mod", "module example.com/travel\n")
	write(t, root, "config/config.go", `package config
import (
  "strings"
  "github.com/riverqueue/river"
)
type Version struct {
  Branch string `+branchTag+`
}
type Config struct { Version Version }
func (c *Config) JobQueue() string {
  queue := strings.ToLower(c.Version.Branch)
  if queue == "" {
    queue = river.QueueDefault
  }
  return queue
}
`)
	write(t, root, "jobs/args.go", `package jobs
import "github.com/riverqueue/river"
type HoldArgs struct { TripID int64 `+"`json:\"trip_id\"`"+` }
func (HoldArgs) Kind() string { return "hold_seat" }
func (HoldArgs) InsertOpts() river.InsertOpts { return river.InsertOpts{MaxAttempts: 1} }
type ReleaseArgs struct { TripID int64 `+"`json:\"trip_id\"`"+` }
func (ReleaseArgs) Kind() string { return "release_seat" }
`)
	write(t, root, "jobs/runner.go", `package jobs
import (
  "context"
  "time"
  "github.com/riverqueue/river"
)
type Runner struct {
  client *river.Client[any]
  queue  string
}
func NewRunner(client *river.Client[any], queue string) *Runner { return &Runner{client, queue} }
func (r *Runner) Hold(ctx context.Context, id int64) error {
  args := HoldArgs{TripID: id}
  _, err := r.client.Insert(ctx, args, &river.InsertOpts{Queue: r.queue})
  return err
}
func (r *Runner) Release(ctx context.Context, id int64, delay time.Duration) error {
  _, err := r.client.Insert(ctx, ReleaseArgs{TripID: id}, &river.InsertOpts{Queue: r.queue, ScheduledAt: time.Now().Add(delay)})
  return err
}
`)
	write(t, root, "jobs/workers/hold.go", `package workers
import (
  "context"
  "github.com/riverqueue/river"
  "example.com/travel/jobs"
)
type HoldWorker struct { river.WorkerDefaults[jobs.HoldArgs] }
func (*HoldWorker) Work(context.Context, *river.Job[jobs.HoldArgs]) error { return nil }
type ReleaseWorker struct { river.WorkerDefaults[jobs.ReleaseArgs] }
func (*ReleaseWorker) Work(context.Context, *river.Job[jobs.ReleaseArgs]) error { return nil }
`)
	write(t, root, "facade/facade.go", `package facade
import (
  "github.com/riverqueue/river"
  "example.com/travel/config"
  "example.com/travel/jobs"
  "example.com/travel/jobs/workers"
)
type Workers struct {
  Hold    *workers.HoldWorker
  Release *workers.ReleaseWorker
}
type Facade struct { runner *jobs.Runner; workers Workers }
func New(client *river.Client[any], cfg *config.Config) *Facade {
  runner := jobs.NewRunner(client, cfg.JobQueue())
  return &Facade{runner: runner, workers: Workers{Hold: &workers.HoldWorker{}, Release: &workers.ReleaseWorker{}}}
}
func (f *Facade) Workers() (Workers, error) { return f.workers, nil }
`)
	write(t, root, "app/river.go", `package app
import (
  "github.com/riverqueue/river"
  "example.com/travel/config"
  "example.com/travel/facade"
)
func Serve(f *facade.Facade, cfg *config.Config) {
  workers := river.NewWorkers()
  built, _ := f.Workers()
  river.AddWorker(workers, built.Hold)
  river.AddWorker(workers, built.Release)
  queue := cfg.JobQueue()
  _, _ = river.NewClient[any](nil, &river.Config{
    Queues:  map[string]river.QueueConfig{queue: {MaxWorkers: 4}},
    Workers: workers,
  })
}
`)
	return root
}

func TestResolvesAQueueKeptBesideTheClient(t *testing.T) {
	root := keptQueueTree(t, "`envconfig:\"GIT_BRANCH\" default:\"Main\"`")

	out, resp := extracted(t, root)
	for _, warning := range resp.Warnings() {
		t.Errorf("warning: %s", warning.Message)
	}
	service := out.Contexts[0].Services[0]
	// The branch default is lowercased, and the fallback under `if queue ==
	// ""` does not count: the value before it is known not to be empty.
	if len(service.Channels) != 1 || service.Channels[0].Address != "main" {
		t.Fatalf("channels = %+v", service.Channels)
	}
	if got := len(service.Channels[0].Messages); got != 4 {
		t.Fatalf("messages = %+v", service.Channels[0].Messages)
	}
	flows := map[string]catalog.Flow{}
	for _, flow := range out.Flows {
		flows[flow.Slug] = flow
	}
	for _, slug := range []string{"mailer-river-hold-seat-main", "mailer-river-release-seat-main"} {
		flow, ok := flows[slug]
		if !ok || len(flow.Steps) != 2 {
			t.Fatalf("flow %s = %+v (all: %v)", slug, flow, keys(flows))
		}
	}
}

func TestAQueueOnlyKnownAtRunTimeKeepsItsWorker(t *testing.T) {
	root := keptQueueTree(t, "`envconfig:\"GIT_BRANCH\"`")

	out, resp := extracted(t, root)
	service := out.Contexts[0].Services[0]
	if len(service.Channels) != 0 {
		t.Fatalf("a queue was guessed: %+v", service.Channels)
	}
	warnings := []string{}
	for _, warning := range resp.Warnings() {
		warnings = append(warnings, warning.Message)
	}
	joined := strings.Join(warnings, "\n")
	// The branch has no default, so the queue is whatever the environment
	// says. The insert names the expression it could not follow, and the
	// workers stay as flows with the queue unproven rather than vanishing.
	if !strings.Contains(joined, "Insert of `hold_seat` names the queue `r.queue`, which this reader cannot resolve") {
		t.Fatalf("insert warning missing: %s", joined)
	}
	if !strings.Contains(joined, "HoldWorker handles `hold_seat`; every Insert of `hold_seat` names a queue this reader cannot resolve") {
		t.Fatalf("worker warning missing: %s", joined)
	}
	if strings.Contains(joined, "no River jobs joined") {
		t.Fatalf("the workers were dropped: %s", joined)
	}
	if len(out.Flows) != 2 {
		t.Fatalf("flows = %+v", out.Flows)
	}
	for _, flow := range out.Flows {
		if step := flow.Steps[0].(*catalog.Step); step.Status != catalog.StatusUnresolved || step.From != "river" {
			t.Fatalf("step = %+v", step)
		}
	}
}

func TestQueueFieldsLocalsAndHelpers(t *testing.T) {
	root := t.TempDir()
	write(t, root, "go.mod", "module example.com/ops\n")
	write(t, root, "queues/names.go", `package queues
const Reports = "reports"
`)
	write(t, root, "jobs/jobs.go", `package jobs
import (
  "context"
  "github.com/riverqueue/river"
  "example.com/ops/queues"
)
type ReportArgs struct{}
func (ReportArgs) Kind() string { return "report" }
type PurgeArgs struct{}
func (PurgeArgs) Kind() string { return "purge" }
type AuditArgs struct{}
func (AuditArgs) Kind() string { return "audit" }

type Scheduler struct { client *river.Client[any]; queue string; purge string }
func NewScheduler(client *river.Client[any]) *Scheduler {
  s := &Scheduler{client: client, queue: queues.Reports}
  s.purge = purgeQueue(false)
  return s
}
func purgeQueue(urgent bool) string {
  queue := ""
  if urgent {
    queue = "urgent"
  }
  if queue == "" {
    queue = "maintenance"
  }
  return queue
}
func (s *Scheduler) Report(ctx context.Context) {
  _, _ = s.client.Insert(ctx, ReportArgs{}, &river.InsertOpts{Queue: s.queue})
}
func (s *Scheduler) Purge(ctx context.Context) {
  _, _ = s.client.Insert(ctx, PurgeArgs{}, &river.InsertOpts{Queue: s.purge})
}
func (s *Scheduler) Audit(ctx context.Context, tenant string) {
  _, _ = s.client.Insert(ctx, AuditArgs{}, &river.InsertOpts{Queue: "audit-" + tenant})
}
`)

	out, resp := extracted(t, root)
	addresses := []string{}
	for _, channel := range out.Contexts[0].Services[0].Channels {
		addresses = append(addresses, channel.Address)
	}
	// A keyed literal with a constant of another package; an assignment to
	// the field from a helper whose local may stay empty, so both the value
	// and its fallback are possible; a tenant only a caller knows, with no
	// caller in the tree, is not resolved.
	if got := strings.Join(addresses, ","); got != "maintenance,reports,urgent" {
		t.Fatalf("queues = %s", got)
	}
	joined := ""
	for _, warning := range resp.Warnings() {
		joined += warning.Message + "\n"
	}
	if !strings.Contains(joined, "Insert of `audit` names the queue `\"audit-\" + tenant`, which this reader cannot resolve") {
		t.Fatalf("audit warning missing: %s", joined)
	}
}
