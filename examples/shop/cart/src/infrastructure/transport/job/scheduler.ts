// The clock the jobs beside this file run on. In process and nothing more: a
// job fires every `everyMs` for as long as the service is up, a run that
// fails is reported and the next one still fires, and stopping clears every
// timer so shutdown is not held open by one.
export interface Job {
  /** What the job is called in logs and in the catalog. */
  readonly name: string;
  readonly everyMs: number;
  run(): Promise<void>;
}

/** Starts every job on its own interval; the function handed back stops them all. */
export function schedule(jobs: readonly Job[], failed: (job: Job, err: unknown) => void): () => void {
  const timers = jobs.map((job) =>
    setInterval(() => {
      job.run().catch((err) => failed(job, err));
    }, job.everyMs),
  );
  return () => {
    for (const timer of timers) clearInterval(timer);
  };
}
