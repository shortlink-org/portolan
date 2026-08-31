// What a diagram container holds while elk is still deciding where things go.
//
// Not a spinner. A spinner in the middle of a 340px box says "wait" and nothing
// else, and the moment it is replaced the whole box changes at once. This says
// "a picture is coming, roughly this shape": three blurred neutral masses on
// the surface colour, at the size the nodes will be, inside a container that
// already has its final height. Nothing moves when the real thing lands.

export function DiagramSkeleton({ label = "laying out the diagram" }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ background: "var(--bg)" }}
    >
      <div
        className="absolute inset-0"
        style={{
          filter: "blur(18px)",
          opacity: 0.7,
        }}
      >
        {/* Left, middle, right: the shape almost every graph in this app has,
            because almost every graph here is a left-to-right layering. */}
        <span
          className="absolute rounded-card"
          style={{
            left: "10%",
            top: "38%",
            width: "16%",
            height: "20%",
            background: "var(--surface-2)",
          }}
        />
        <span
          className="absolute rounded-card"
          style={{
            left: "42%",
            top: "30%",
            width: "16%",
            height: "20%",
            background: "var(--surface-2)",
          }}
        />
        <span
          className="absolute rounded-card"
          style={{
            left: "42%",
            top: "56%",
            width: "16%",
            height: "20%",
            background: "var(--surface-2)",
          }}
        />
        <span
          className="absolute rounded-card"
          style={{
            left: "74%",
            top: "40%",
            width: "16%",
            height: "20%",
            background: "var(--surface-2)",
          }}
        />
      </div>
      <span className="sr-only" role="status">
        {label}
      </span>
    </div>
  );
}
