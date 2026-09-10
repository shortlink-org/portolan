export interface DjangoAggregateCandidates {
  app: string;
  models: Array<{ name: string; path: string; line: number }>;
}

/** Evidence emitted by extract-django, carried through the warning protocol. */
export function djangoAggregateCandidates(message: string): DjangoAggregateCandidates | null;

export function djangoAggregateMessage(message: string): string;
