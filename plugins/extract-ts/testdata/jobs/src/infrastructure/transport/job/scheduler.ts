// Not a job: no name, no interval, no run. The directory holds it and the reader passes it by.
export interface Job {
  readonly name: string;
  readonly everyMs: number;
  run(): Promise<void>;
}

export function schedule(jobs: readonly Job[]): () => void {
  const timers = jobs.map((job) => setInterval(() => void job.run(), job.everyMs));
  return () => timers.forEach(clearInterval);
}
