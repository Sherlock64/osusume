import { Link } from '@tanstack/react-router';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { ImageOff } from 'lucide-react';
import { useRef, useState } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type SeriesNodeData = {
  seriesId: string;
  title: string;
  imageUrl: string | null;
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
      className={cn(
        'bg-card text-card-foreground flex flex-col gap-2 rounded-lg border p-2 shadow-sm',
        data.popIn && 'canvas-pop',
        bouncing && 'canvas-bounce',
      )}
      style={{ width: 160 }}
      onAnimationEnd={(event) => {
        if (event.animationName === 'canvas-bounce') setBouncing(false);
      }}
    >
      {data.interactive &&
        HANDLES.map((handle) => (
          <Handle
            key={handle.id}
            id={handle.id}
            type="source"
            position={handle.position}
            className="bg-background! border-muted-foreground! size-3!"
          />
        ))}
      <div className="bg-muted flex h-32 items-center justify-center overflow-hidden rounded-md">
        {data.imageUrl === null ?
          <ImageOff className="text-muted-foreground size-6" aria-hidden />
        : <img
            src={data.imageUrl}
            alt=""
            loading="lazy"
            draggable={false}
            className="size-full object-cover"
          />
        }
      </div>
      <p className="line-clamp-2 min-h-10 text-sm font-medium wrap-anywhere">{data.title}</p>
      <Link
        to="/series/$id"
        params={{ id: data.seriesId }}
        draggable={false}
        className={buttonVariants({ variant: 'outline', size: 'sm' })}
        onPointerDown={(event) => {
          pressedAt.current = { x: event.clientX, y: event.clientY };
        }}
        onClick={(event) => {
          // A drag that starts on the button must not follow the link when released.
          const start = pressedAt.current;
          if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_SLOP) {
            event.preventDefault();
          }
        }}
      >
        View series
      </Link>
    </div>
  );
}
