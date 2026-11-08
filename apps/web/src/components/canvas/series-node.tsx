import type { Cover, SeriesRating } from '@osusume/shared';
import { Link } from '@tanstack/react-router';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { useRef, useState } from 'react';
import { CoverImage } from '@/components/cover-image';
import { RatingStars, STAR, ratingText } from '@/components/star-rating';
import { cn } from '@/lib/utils';

export type SeriesNodeData = {
  seriesId: string;
  title: string;
  cover: Cover | null;
  rating: SeriesRating;
  /** Whether the node can be dragged and connected. */
  interactive: boolean;
  /** Newly placed by the layout this session: plays a brief pop-in. */
  popIn: boolean;
};

export type SeriesFlowNode = Node<SeriesNodeData, 'series'>;

const HANDLES = [
  { id: 'top', position: Position.Top },
  { id: 'right', position: Position.Right },
  { id: 'bottom', position: Position.Bottom },
  { id: 'left', position: Position.Left },
] as const;

/** Diameter of a node's cover circle, the ring the lines meet. Its title hangs below, outside the node's box. */
export const STAR_SIZE = 128;

/** Pixels the pointer may move between press and release for the series button to count as a click. */
const CLICK_SLOP = 4;

export function SeriesNode({ data, dragging }: NodeProps<SeriesFlowNode>) {
  const [bouncing, setBouncing] = useState(false);
  const [wasDragging, setWasDragging] = useState(dragging);
  if (wasDragging !== dragging) {
    setWasDragging(dragging);
    if (!dragging) setBouncing(true);
  }
  const pressedAt = useRef<{ x: number; y: number } | null>(null);

  return (
    <div
      className={cn('relative', data.popIn && 'canvas-pop', bouncing && 'canvas-bounce')}
      style={{ width: STAR_SIZE, height: STAR_SIZE }}
      onAnimationEnd={(event) => {
        if (event.animationName === 'canvas-bounce') setBouncing(false);
      }}
    >
      {/* Always rendered, since lines attach to them; hidden when the node can't be connected. */}
      {HANDLES.map((handle) => (
        <Handle
          key={handle.id}
          id={handle.id}
          type="source"
          position={handle.position}
          className={cn(!data.interactive && 'pointer-events-none! opacity-0')}
        />
      ))}
      {/* Lines run between centres and are trimmed to the ring, so they meet it from any angle. */}
      <Handle id="center" type="source" position={Position.Top} className="invisible! pointer-events-none! top-1/2! size-0!" />
      <Link
        to="/series/$id"
        params={{ id: data.seriesId }}
        draggable={false}
        aria-label={`${data.title}, ${ratingText(data.rating)}`}
        // xyflow turns off pointer events on nodes that can't be dragged or connected; the link must still work.
        className="group pointer-events-auto block rounded-full"
        onPointerDown={(event) => {
          pressedAt.current = { x: event.clientX, y: event.clientY };
        }}
        onClick={(event) => {
          // A drag that starts on the link must not follow it when released.
          const start = pressedAt.current;
          if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_SLOP) {
            event.preventDefault();
          }
        }}
      >
        {/* No pointer events on the image, or the browser's image drag beats the node's. */}
        <CoverImage
          cover={data.cover}
          size="medium"
          alt=""
          title={data.title}
          // A crisp gold ring with a hairline of sky inside it. The plate's own name is dropped: the label below has it.
          className="bg-background border-star aspect-square rounded-full border-2 p-0.5 [&_img]:pointer-events-none [&_img]:rounded-full [&>p]:hidden [&>svg]:w-1/2 [&>svg]:flex-none [&>svg]:self-center [&>svg]:my-auto"
        />
        <RatingStars
          rating={data.rating}
          className="bg-background absolute bottom-1 left-1/2 -translate-x-1/2 rounded-full border px-1.5 py-0.5"
        />
        {/* A solid plate under the title keeps it at full contrast over lines and specks: an atlas cartouche, gold double rule and a star set in its top edge. */}
        <div className="absolute top-full left-1/2 mt-3 -translate-x-1/2">
          <svg viewBox="-6 -6 12 12" aria-hidden className="fill-star absolute -top-2 left-1/2 z-10 size-4 -translate-x-1/2">
            <path d={STAR} />
          </svg>
          <p className="font-heading bg-card text-card-foreground border-star/70 outline-star/35 line-clamp-3 w-max max-w-56 rounded-sm border px-3 pt-1.5 pb-1 text-center text-2xl leading-tight shadow-lg shadow-black/25 outline outline-offset-2 wrap-anywhere group-hover:underline">
            {data.title}
          </p>
        </div>
      </Link>
    </div>
  );
}
