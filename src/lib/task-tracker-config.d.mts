export interface TaskTracker {
  id: string;
  name?: string;
  provider: "youtrack" | "jira" | "linear" | "gitlab" | "github";
  baseUrl: string;
  projects: string[];
  keyFormat?: string;
  urlTemplate?: string;
  matchBareNumbers?: boolean;
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
export const TRACKER_PROVIDERS: Record<TaskTracker["provider"], { label: string; numbered: boolean; keyFormat: string; urlTemplate: string; addressLabel: string; placeholder: string }>;
export function keyPattern(projects: string[], format?: string): RegExp;
export function detectTaskKeys(message: string, tracker: TaskTracker): string[];
export function taskUrl(tracker: TaskTracker, key: string): string;
export function normalizeTrackers(value: unknown): TaskTracker[];
export const WORK_ITEMS_PLUGIN: "work-items";
export function workItemsPluginNames(manifest: unknown): Set<string>;
export function publicTaskTrackers(manifest: unknown): TaskTrackerEntry[];
