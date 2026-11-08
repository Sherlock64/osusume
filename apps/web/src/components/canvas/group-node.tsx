import type { Node, NodeProps } from '@xyflow/react';
import { STAR } from '@/components/star-rating';

export type GroupNodeData = {
  groupId: string;
  name: string;
  /** Whether the name is a drag handle and menu target. */
  interactive: boolean;
};

export type GroupFlowNode = Node<GroupNodeData, 'constellation'>;

/** The handle xyflow drags a group by, and the target its menu opens from. */
export const GROUP_HANDLE = 'canvas-group-handle';

const PLATE =
  'font-heading bg-card text-card-foreground border-star/70 outline-star/35 absolute top-0 left-6 max-w-[calc(100%-3rem)] -translate-y-1/2 truncate rounded-sm border px-3 pt-1 pb-0.5 text-xl leading-tight shadow-md shadow-black/20 outline outline-offset-2';

/** A constellation: a hairline box around its members, named on its top edge. Only the name takes the pointer. */
export function GroupNode({ data }: NodeProps<GroupFlowNode>) {
  return (
    <div className="canvas-group border-star/40 bg-star/5 relative size-full rounded-2xl border">
      {data.interactive ?
        <button
          type="button"
          aria-haspopup="menu"
          aria-label={`${data.name}, group. Drag to move it, press Enter for its menu.`}
          className={`${GROUP_HANDLE} ${PLATE} focus-visible:ring-ring cursor-grab focus-visible:ring-2 active:cursor-grabbing`}
        >
          <Star />
          {data.name}
        </button>
      : <p className={PLATE}>
          <Star />
          {data.name}
        </p>
      }
    </div>
  );
}

function Star() {
  return (
    <svg viewBox="-6 -6 12 12" aria-hidden className="fill-star mr-1.5 inline size-3 align-baseline">
      <path d={STAR} />
    </svg>
  );
}
