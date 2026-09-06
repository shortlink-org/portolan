export interface paths {
  "/v1/sessions/current": { get: { responses: { 200: { content: { "application/json": { userId: string } } } } } };
}
