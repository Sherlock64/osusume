import type { CanvasLink, CanvasLinkKind, CanvasNode } from '@osusume/shared';
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  Panel,
  ReactFlow,
  type Edge,
  type NodeChange,
  type OnConnectEnd,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { CanvasMenu, MenuItem } from '@/components/canvas/canvas-menu';
import { SeriesNode, type SeriesFlowNode } from '@/components/canvas/series-node';
import { facingSides, placeNodes } from '@/lib/canvas-layout';
import './canvas.css';

interface RecommendationCanvasProps {
  nodes: CanvasNode[];
  links: CanvasLink[];
  editable: boolean;
  onMoveNodes: (positions: { seriesId: string; x: number; y: number }[]) => void;
  onSetLink: (link: CanvasLink) => void;
  onRemoveLink: (seriesAId: string, seriesBId: string) => void;
}

type LinkEdge = Edge<{ link: CanvasLink }>;

type OpenMenu =
  | { type: 'connect'; x: number; y: number; seriesAId: string; seriesBId: string }
  | { type: 'edge'; x: number; y: number; link: CanvasLink };

const nodeTypes = { series: SeriesNode };

const COARSE_POINTER = '(pointer: coarse)';

function subscribeCoarsePointer(onChange: () => void) {
  const query = window.matchMedia(COARSE_POINTER);
  query.addEventListener('change', onChange);
  return () => {
    query.removeEventListener('change', onChange);
  };
}

function useCoarsePointer() {
  return useSyncExternalStore(
    subscribeCoarsePointer,
    () => window.matchMedia(COARSE_POINTER).matches,
    () => false,
  );
}

function LegendLine({ kind }: { kind: CanvasLinkKind }) {
  return (
    <svg width="28" height="8" aria-hidden>
      <line
        x1="0"
        y1="4"
        x2="28"
        y2="4"
        strokeWidth="2.5"
        strokeDasharray={kind === 'avoid' ? '7 5' : undefined}
        style={{ stroke: kind === 'avoid' ? 'var(--canvas-avoid)' : 'var(--canvas-recommend)' }}
      />
    </svg>
  );
}

function Legend() {
  return (
    <Panel position="bottom-center">
      <div className="bg-card text-card-foreground flex flex-col gap-1 rounded-lg border px-2.5 py-2 text-xs">
        <span className="flex items-center gap-2">
          <LegendLine kind="recommend" />
          Goes together
        </span>
        <span className="flex items-center gap-2">
          <LegendLine kind="avoid" />
          Doesn&apos;t go together
        </span>
      </div>
    </Panel>
  );
}

function sameNode(a: SeriesFlowNode, b: SeriesFlowNode) {
  return (
    a.position.x === b.position.x &&
    a.position.y === b.position.y &&
    a.draggable === b.draggable &&
    a.data.title === b.data.title &&
    a.data.cover?.id === b.data.cover?.id &&
    a.data.interactive === b.data.interactive &&
    a.data.popIn === b.data.popIn
  );
}

function pointOf(event: MouseEvent | TouchEvent) {
  const touch = 'changedTouches' in event ? event.changedTouches[0] : undefined;
  const source = touch ?? (event as MouseEvent);
  return { x: source.clientX, y: source.clientY };
}

/** The recommendation canvas: series as draggable nodes, linked by "goes together" or "doesn't" lines. */
export function RecommendationCanvas({
  nodes: seriesNodes,
  links,
  editable,
  onMoveNodes,
  onSetLink,
  onRemoveLink,
}: RecommendationCanvasProps) {
  const coarse = useCoarsePointer();
  const interactive = editable && !coarse;
  const [menu, setMenu] = useState<OpenMenu | null>(null);

  const placed = useMemo(() => placeNodes(seriesNodes), [seriesNodes]);
  // Newly placed nodes pop in once; the optimistic save clears `placed` before they first paint.
  const [popped, setPopped] = useState<ReadonlySet<string>>(new Set());
  const fresh = editable ? placed.filter((node) => node.placed && !popped.has(node.seriesId)) : [];
  if (fresh.length > 0) setPopped(new Set([...popped, ...fresh.map((node) => node.seriesId)]));

  const flowNodes = useMemo(() => {
    const byId = new Map(seriesNodes.map((node) => [node.seriesId, node]));
    return placed.map((position): SeriesFlowNode => {
      const node = byId.get(position.seriesId);
      return {
        id: position.seriesId,
        type: 'series',
        position: { x: position.x, y: position.y },
        draggable: interactive,
        data: {
          seriesId: position.seriesId,
          title: node?.title ?? '',
          cover: node?.cover ?? null,
          interactive,
          popIn: popped.has(position.seriesId),
        },
      };
    });
  }, [placed, seriesNodes, interactive, popped]);

  // Local node state carries drags between prop updates; new props replace it.
  const [syncedFrom, setSyncedFrom] = useState(flowNodes);
  const [nodes, setNodes] = useState(flowNodes);
  if (syncedFrom !== flowNodes) {
    setSyncedFrom(flowNodes);
    // A refetch must not snap back a node that is being dragged.
    const previous = new Map(nodes.map((node) => [node.id, node]));
    setNodes(
      flowNodes.map((node) => {
        const before = previous.get(node.id);
        if (before === undefined) return node;
        if (before.dragging === true) return before;
        // Unchanged nodes keep their object, and changed ones their measured size, so xyflow
        // doesn't measure everything again and flash.
        if (sameNode(before, node)) return before;
        return { ...node, ...(before.measured === undefined ? {} : { measured: before.measured }) };
      }),
    );
  }

  // Persist the positions the layout chose, once per series.
  const reported = useRef(new Set<string>());
  useEffect(() => {
    if (!editable) return;
    const unsaved = placed.filter((node) => node.placed && !reported.current.has(node.seriesId));
    if (unsaved.length === 0) return;
    for (const node of unsaved) reported.current.add(node.seriesId);
    onMoveNodes(unsaved.map(({ seriesId, x, y }) => ({ seriesId, x, y })));
  }, [placed, editable, onMoveNodes]);

  const edges = useMemo(() => {
    const byId = new Map(nodes.map((node) => [node.id, node.position]));
    return links.flatMap((link): LinkEdge[] => {
      const a = byId.get(link.seriesAId);
      const b = byId.get(link.seriesBId);
      if (!a || !b) return [];
      const sides = facingSides(a, b);
      return [
        {
          id: `${link.seriesAId}:${link.seriesBId}`,
          source: link.seriesAId,
          target: link.seriesBId,
          sourceHandle: sides.from,
          targetHandle: sides.to,
          className: `canvas-edge-${link.kind}`,
          focusable: interactive,
          data: { link },
        },
      ];
    });
  }, [links, nodes, interactive]);

  const onConnectEnd: OnConnectEnd = (event, state) => {
    const from = state.fromNode?.id;
    const point = pointOf(event);
    // Dropping anywhere on a node counts, not only exactly on one of its handles.
    const to =
      state.toNode?.id ??
      document.elementFromPoint(point.x, point.y)?.closest<HTMLElement>('.react-flow__node')?.dataset.id;
    if (from === undefined || to === undefined || from === to) return;
    setMenu({ type: 'connect', ...point, seriesAId: from, seriesBId: to });
  };

  const chooseKind = (kind: CanvasLinkKind) => {
    if (menu?.type === 'connect') {
      onSetLink({ seriesAId: menu.seriesAId, seriesBId: menu.seriesBId, kind });
    } else if (menu?.type === 'edge') {
      onSetLink({ ...menu.link, kind });
    }
    setMenu(null);
  };

  return (
    <div className="h-full min-h-96 w-full">
      <ReactFlow
        className="canvas-flow"
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        connectionMode={ConnectionMode.Loose}
        nodesDraggable={interactive}
        nodesConnectable={interactive}
        elementsSelectable={false}
        edgesFocusable={interactive}
        onlyRenderVisibleElements
        fitView
        // On a phone, keep nodes legible and tappable even if they don't all fit.
        fitViewOptions={coarse ? { minZoom: 0.6 } : undefined}
        minZoom={0.1}
        onNodesChange={(changes: NodeChange<SeriesFlowNode>[]) => {
          setNodes((current) => applyNodeChanges(changes, current));
        }}
        onNodeDragStop={(_event, node) => {
          onMoveNodes([{ seriesId: node.id, x: node.position.x, y: node.position.y }]);
        }}
        onConnectEnd={interactive ? onConnectEnd : undefined}
        onEdgeClick={
          interactive ?
            (event, edge: LinkEdge) => {
              if (edge.data) setMenu({ type: 'edge', x: event.clientX, y: event.clientY, link: edge.data.link });
            }
          : undefined
        }
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.5} />
        <Controls showInteractive={false} />
        <Legend />
      </ReactFlow>
      {menu && (
        <CanvasMenu
          x={menu.x}
          y={menu.y}
          onDismiss={() => {
            setMenu(null);
          }}
        >
          <MenuItem
            disabled={menu.type === 'edge' && menu.link.kind === 'recommend'}
            onSelect={() => {
              chooseKind('recommend');
            }}
          >
            Goes together
          </MenuItem>
          <MenuItem
            disabled={menu.type === 'edge' && menu.link.kind === 'avoid'}
            onSelect={() => {
              chooseKind('avoid');
            }}
          >
            Doesn&apos;t go together
          </MenuItem>
          {menu.type === 'edge' && (
            <MenuItem
              onSelect={() => {
                onRemoveLink(menu.link.seriesAId, menu.link.seriesBId);
                setMenu(null);
              }}
            >
              Remove line
            </MenuItem>
          )}
        </CanvasMenu>
      )}
    </div>
  );
}
