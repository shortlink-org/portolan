// The fixture the validator and the readers are tested against: the estate
// as its sources wrote it, every fragment merged, nothing derived or checked.
// One fragment alone is not a catalog - a flow in data/ hears an event a
// service under examples/ publishes - so the fixture is all of them, frozen
// under testing/estate so that a service added to the live estate moves no
// test. Tests about what the app actually ships import `./data`.
export { rawCatalog } from "./testing/estate";
