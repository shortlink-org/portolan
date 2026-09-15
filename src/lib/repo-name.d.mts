export function bare(repo: string): string;
export function pinFor<Pin extends { repo: string }>(repo: string, pins: readonly Pin[]): Pin | undefined;
