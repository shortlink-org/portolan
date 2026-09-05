/** What a resolver needs from whoever knows who somebody is. */
export interface Sessions {
  current(bearer: string): Promise<{ userId: string } | null>;
}
