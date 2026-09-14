export interface TaskTracker {
  id: string;
  name?: string;
  provider: "youtrack";
  baseUrl: string;
  projects: string[];
  keyFormat?: string;
  urlTemplate?: string;
}
export interface TaskTrackerEntry {
  step: number;
  input: string;
  output: string;
  file: string;
  trackers: TaskTracker[];
  maxCommits: number;
}
export const DEFAULT_KEY_FORMAT: string;
export const DEFAULT_ISSUE_URL: string;
export function keyPattern(projects: string[], format?: string): RegExp;
export function detectTaskKeys(message: string, tracker: TaskTracker): string[];
export function taskUrl(tracker: TaskTracker, key: string): string;
export function normalizeTrackers(value: unknown): TaskTracker[];
export function publicTaskTrackers(manifest: unknown): TaskTrackerEntry[];
