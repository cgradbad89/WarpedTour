"use client";

import { useRef, useState } from "react";
import type { Band, BandStatus } from "@/types";
import { BandRow } from "./BandRow";

// One status section on the My Picks page: a reorderable list of picked bands.
//
// Reordering works two ways, both persisting to the same order key:
//   • Drag the grip handle. Implemented with Pointer Events, so a finger drag
//     on mobile works exactly like a mouse drag (one code path). touch-action
//     is disabled ONLY on the handle, so the rest of the row stays tappable and
//     the page still scrolls when you touch elsewhere.
//   • Up/down arrows — the touch-reliable guarantee (drag is the enhancement).
//
// All drag geometry is read in pointer handlers (client-only), so there's
// nothing for SSR to trip over.

/** Final index of row `j` while the dragged row moves from `from` → `to`
 *  (matches array-move semantics: splice out `from`, splice in at `to`). */
function projectedIndex(j: number, from: number, to: number): number {
  if (j === from) return to;
  let p = j < from ? j : j - 1;
  if (p >= to) p += 1;
  return p;
}

interface DragState {
  from: number;
  to: number;
  offset: number; // px the dragged row is translated, following the pointer
}

export function PicksSection({
  label,
  status,
  bands,
  hasManualOrder,
  onReorder,
  onReset,
  onOpen,
}: {
  label: string;
  status: BandStatus;
  bands: Band[];
  hasManualOrder: boolean;
  onReorder: (names: string[]) => void;
  onReset: () => void;
  onOpen: (band: Band) => void;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const geom = useRef<{ rowH: number; listTop: number; grabY: number } | null>(null);
  const dragRef = useRef<{ from: number; to: number } | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= bands.length || from === to) return;
    const names = bands.map((b) => b.name);
    const [x] = names.splice(from, 1);
    names.splice(to, 0, x);
    onReorder(names);
  };

  const onHandleDown = (e: React.PointerEvent, index: number) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const ul = listRef.current;
    if (!ul) return;
    const items = Array.from(ul.children) as HTMLElement[];
    if (items.length === 0) return;
    const first = items[0].getBoundingClientRect();
    geom.current = { rowH: first.height, listTop: first.top, grabY: e.clientY };
    dragRef.current = { from: index, to: index };
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* pointer not capturable (rare) — drag still works without capture */
    }
    e.preventDefault();
    setDrag({ from: index, to: index, offset: 0 });
  };

  const onHandleMove = (e: React.PointerEvent) => {
    const g = geom.current;
    const d = dragRef.current;
    if (!g || !d) return;
    let to = Math.round((e.clientY - g.listTop - g.rowH / 2) / g.rowH);
    to = Math.max(0, Math.min(bands.length - 1, to));
    dragRef.current = { ...d, to };
    setDrag({ from: d.from, to, offset: e.clientY - g.grabY });
  };

  const onHandleUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (d && d.to !== d.from) move(d.from, d.to);
    dragRef.current = null;
    geom.current = null;
    setDrag(null);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
  };

  return (
    <section>
      <div className="flex items-center justify-between gap-2 bg-muted px-4 py-1.5">
        <h2 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
          {label} <span className="font-normal normal-case">({bands.length})</span>
        </h2>
        {hasManualOrder && bands.length > 1 && (
          <button
            type="button"
            onClick={onReset}
            className="shrink-0 px-1 py-1 text-xs font-semibold text-accent hover:underline"
          >
            Reset to score order
          </button>
        )}
      </div>

      {bands.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted-foreground">
          Nothing marked {label} yet.
        </p>
      ) : (
        <ul ref={listRef}>
          {bands.map((band, i) => {
            const isDragged = drag?.from === i;
            const ty =
              drag === null
                ? 0
                : isDragged
                  ? drag.offset
                  : (projectedIndex(i, drag.from, drag.to) - i) *
                    (geom.current?.rowH ?? 0);
            return (
              <li
                key={band.name}
                className={`relative flex items-center border-b border-border bg-card ${
                  isDragged ? "shadow-lg" : ""
                }`}
                style={{
                  transform: ty ? `translateY(${ty}px)` : undefined,
                  transition: isDragged ? "none" : "transform 150ms ease",
                  zIndex: isDragged ? 10 : undefined,
                }}
              >
                <button
                  type="button"
                  aria-label={`Drag to reorder ${band.name}`}
                  onPointerDown={(e) => onHandleDown(e, i)}
                  onPointerMove={onHandleMove}
                  onPointerUp={onHandleUp}
                  onPointerCancel={onHandleUp}
                  style={{ touchAction: "none" }}
                  className="grid h-12 w-9 shrink-0 cursor-grab touch-none place-items-center text-muted-foreground active:cursor-grabbing"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                    <circle cx="6" cy="4" r="1.4" />
                    <circle cx="10" cy="4" r="1.4" />
                    <circle cx="6" cy="8" r="1.4" />
                    <circle cx="10" cy="8" r="1.4" />
                    <circle cx="6" cy="12" r="1.4" />
                    <circle cx="10" cy="12" r="1.4" />
                  </svg>
                </button>

                <div className="min-w-0 flex-1">
                  <BandRow band={band} status={status} onOpen={onOpen} />
                </div>

                <div className="flex shrink-0 flex-col pr-2">
                  <button
                    type="button"
                    aria-label={`Move ${band.name} up`}
                    disabled={i === 0}
                    onClick={() => move(i, i - 1)}
                    className="grid h-8 w-9 place-items-center rounded text-muted-foreground hover:bg-muted disabled:opacity-25"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M6 14l6-6 6 6" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${band.name} down`}
                    disabled={i === bands.length - 1}
                    onClick={() => move(i, i + 1)}
                    className="grid h-8 w-9 place-items-center rounded text-muted-foreground hover:bg-muted disabled:opacity-25"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M6 10l6 6 6-6" />
                    </svg>
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
