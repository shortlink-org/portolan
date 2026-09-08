import { useId, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { animate, useDragControls, useMotionValue } from "motion/react";
import type { PanInfo } from "motion/react";
import { m } from "../lib/motion";

const cats = [
  "/landing/cats/thread-tangle.webp",
  "/landing/cats/map-inspector.webp",
  "/landing/cats/laptop.webp",
  "/landing/cats/diagrammer.webp",
  "/landing/cats/compass-nap.webp",
  "/landing/cats/docs-reader.webp",
  "/landing/cats/bug-hunter.webp",
  "/landing/cats/system-builder.webp",
  "/landing/cats/server-break.webp",
  "/landing/cats/star-mapper.webp",
] as const;

const X_LIMIT = 300;
const Y_LIMIT = 190;
const KEYBOARD_STEP = 24;

type RevealEdge = "top" | "right" | "bottom" | "left";

const catPlacement: Record<RevealEdge, string> = {
  top: "items-start justify-center",
  right: "items-center justify-end",
  bottom: "items-end justify-center",
  left: "items-center justify-start",
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function DraggableReveal({
  children,
  handleClassName = "inset-x-0",
  label = "Movable product preview",
}: {
  children: ReactNode;
  handleClassName?: string;
  label?: string;
}) {
  const controls = useDragControls();
  const descriptionId = useId();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const dragEdgeLocked = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [revealEdge, setRevealEdge] = useState<RevealEdge>("right");
  const [cat] = useState(
    () => cats[Math.floor(Math.random() * cats.length)] ?? cats[0],
  );

  const returnToOrigin = () => {
    const transition = {
      duration: 0.78,
      ease: [0.22, 1, 0.36, 1] as const,
    };
    animate(x, 0, transition);
    animate(y, 0, transition);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Partial<Record<string, [number, number]>> = {
      ArrowLeft: [-KEYBOARD_STEP, 0],
      ArrowRight: [KEYBOARD_STEP, 0],
      ArrowUp: [0, -KEYBOARD_STEP],
      ArrowDown: [0, KEYBOARD_STEP],
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      if (Math.abs(move[0]) > Math.abs(move[1])) {
        setRevealEdge(move[0] < 0 ? "right" : "left");
      } else {
        setRevealEdge(move[1] < 0 ? "bottom" : "top");
      }
      x.set(clamp(x.get() + move[0], -X_LIMIT, X_LIMIT));
      y.set(clamp(y.get() + move[1], -Y_LIMIT, Y_LIMIT));
    } else if (event.key === "Escape") {
      x.set(0);
      y.set(0);
    }
  };

  const onDrag = (
    _event: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo,
  ) => {
    if (dragEdgeLocked.current || Math.hypot(info.offset.x, info.offset.y) < 16)
      return;
    if (Math.abs(info.offset.x) >= Math.abs(info.offset.y)) {
      setRevealEdge(info.offset.x < 0 ? "right" : "left");
    } else {
      setRevealEdge(info.offset.y < 0 ? "bottom" : "top");
    }
    dragEdgeLocked.current = true;
  };

  return (
    <div className="relative isolate">
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-0 z-0 flex ${catPlacement[revealEdge]}`}
      >
        <m.img
          layout="position"
          src={cat}
          alt=""
          width={800}
          height={800}
          decoding="async"
          animate={{
            opacity: dragging ? 1 : 0.84,
            scale: dragging ? 1 : 0.96,
            y: dragging ? -3 : 0,
          }}
          transition={{
            layout: { type: "spring", stiffness: 260, damping: 28 },
            opacity: { duration: 0.22 },
            scale: { duration: 0.28 },
            y: { duration: 0.28 },
          }}
          className="max-h-[72%] w-[36%] object-contain drop-shadow-[0_18px_26px_rgba(0,0,0,0.14)]"
        />
      </div>
      <span id={descriptionId} className="sr-only">
        Move this preview with the arrow keys. Press Escape to return it to its
        starting position.
      </span>
      <m.div
        drag
        dragControls={controls}
        dragListener={false}
        dragConstraints={{
          left: -X_LIMIT,
          right: X_LIMIT,
          top: -Y_LIMIT,
          bottom: Y_LIMIT,
        }}
        dragElastic={0.08}
        dragMomentum={false}
        style={{ x, y }}
        whileDrag={{ scale: 0.985 }}
        tabIndex={0}
        aria-label={label}
        aria-describedby={descriptionId}
        onKeyDown={onKeyDown}
        onDragStart={() => {
          dragEdgeLocked.current = false;
          setDragging(true);
        }}
        onDrag={onDrag}
        onDragEnd={() => {
          setDragging(false);
          window.requestAnimationFrame(returnToOrigin);
        }}
        className="relative z-10 rounded-[18px] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
      >
        {children}
        <div
          aria-hidden
          className={`absolute top-0 z-20 h-11 cursor-grab touch-none rounded-t-[18px] active:cursor-grabbing ${handleClassName}`}
          onPointerDown={(event) => controls.start(event)}
        />
      </m.div>
    </div>
  );
}
