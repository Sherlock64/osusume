import type { CanvasLink, CanvasLinkKind } from '@osusume/shared';
import { BaseEdge, getStraightPath, type Edge, type EdgeProps } from '@xyflow/react';
import { STAR_SIZE } from '@/components/canvas/series-node';

export type LinkFlowEdge = Edge<{ link: CanvasLink }, 'link'>;

const STAR = 'M0-6 1.3-1.3 6 0 1.3 1.3 0 6-1.3 1.3-6 0-1.3-1.3Z';
const CROSS = 'M-4-4 4 4M4-4-4 4';

interface Ends {
  kind: CanvasLinkKind;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** What tells the two lines apart without colour: a star on each end, or a cross in the middle. */
function LinkMarks({ kind, x1, y1, x2, y2 }: Ends) {
  if (kind === 'recommend') {
    return (
      <>
        <path className="canvas-mark" d={STAR} transform={`translate(${String(x1)} ${String(y1)})`} />
        <path className="canvas-mark" d={STAR} transform={`translate(${String(x2)} ${String(y2)})`} />
      </>
    );
  }
  return (
    <g transform={`translate(${String((x1 + x2) / 2)} ${String((y1 + y2) / 2)})`}>
      <circle className="canvas-mark-backing" r="8" />
      <path className="canvas-mark" d={CROSS} />
    </g>
  );
}

/** A sample of a line, for the legend and the line menu. */
export function LinkSample({ kind }: { kind: CanvasLinkKind }) {
  return (
    // Sized inline, since Button shrinks any svg inside it to an icon through CSS.
    <svg viewBox="0 0 44 16" style={{ width: 44, height: 16 }} className={`canvas-edge-${kind} shrink-0`} aria-hidden>
      <line x1="6" y1="8" x2="38" y2="8" />
      <LinkMarks kind={kind} x1={6} y1={8} x2={38} y2={8} />
    </svg>
  );
}

/** How far a line stops short of a node's centre: just outside its ring. */
const TRIM = STAR_SIZE / 2 + 4;

export function LinkEdge({ id, data, interactionWidth, ...ends }: EdgeProps<LinkFlowEdge>) {
  // Ends arrive at the two centres; pull each back to its ring. Overlapping nodes keep the full line.
  const length = Math.hypot(ends.targetX - ends.sourceX, ends.targetY - ends.sourceY);
  const trim = length > 2 * TRIM ? TRIM / length : 0;
  const dx = (ends.targetX - ends.sourceX) * trim;
  const dy = (ends.targetY - ends.sourceY) * trim;
  const sourceX = ends.sourceX + dx;
  const sourceY = ends.sourceY + dy;
  const targetX = ends.targetX - dx;
  const targetY = ends.targetY - dy;
  const [path] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  return (
    <>
      <BaseEdge id={id} path={path} {...(interactionWidth === undefined ? {} : { interactionWidth })} />
      {data && <LinkMarks kind={data.link.kind} x1={sourceX} y1={sourceY} x2={targetX} y2={targetY} />}
    </>
  );
}
