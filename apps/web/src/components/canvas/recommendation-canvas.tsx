import type { CanvasLink, CanvasLinkKind, CanvasNode } from '@osusume/shared';
import {
  applyNodeChanges,
  ConnectionMode,
  Controls,
  Panel,
  ReactFlow,
  useStore,
  ViewportPortal,
  type NodeChange,
  type OnConnectEnd,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { CanvasMenu, MenuItem } from '@/components/canvas/canvas-menu';
import { LinkEdge, LinkSample, type LinkFlowEdge } from '@/components/canvas/link-edge';
import { SeriesNode, type SeriesFlowNode } from '@/components/canvas/series-node';
import { placeNodes } from '@/lib/canvas-layout';
import './canvas.css';

interface RecommendationCanvasProps {
  nodes: CanvasNode[];
  links: CanvasLink[];
  editable: boolean;
  onMoveNodes: (positions: { seriesId: string; x: number; y: number }[]) => void;
  onSetLink: (link: CanvasLink) => void;
  onRemoveLink: (seriesAId: string, seriesBId: string) => void;
}

type OpenMenu =
  | { type: 'connect'; x: number; y: number; seriesAId: string; seriesBId: string }
  | { type: 'edge'; x: number; y: number; link: CanvasLink; from: SVGElement | null };

const nodeTypes = { series: SeriesNode };
const edgeTypes = { link: LinkEdge };

// Room for the title block and legend, so the first fit doesn't start underneath them.
const FIT_DESKTOP = { padding: { top: '110px', right: '80px', bottom: '110px', left: '48px' } } as const;
// The legend stands taller with its steps open, so nothing starts behind it on a first visit.
const FIT_FIRST_VISIT = { padding: { ...FIT_DESKTOP.padding, left: '300px' } } as const;
// On a phone, keep nodes legible and tappable even if they don't all fit.
const FIT_PHONE = { minZoom: 0.6 };

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

/** Rings and meridians around a pole above the first rows of the grid. Shown in the light theme only. */
function Graticule() {
  const radii = Array.from({ length: 16 }, (_, ring) => (ring + 1) * 400);
  const meridians = Array.from({ length: 24 }, (_, spoke) => (spoke * Math.PI) / 12);
  return (
    <ViewportPortal>
      <svg className="canvas-graticule" width="1" height="1" style={{ left: 600, top: -1400 }} aria-hidden>
        {radii.map((radius) => (
          <circle key={radius} r={radius} vectorEffect="non-scaling-stroke" />
        ))}
        {meridians.map((angle) => (
          <line
            key={angle}
            x2={6400 * Math.cos(angle)}
            y2={6400 * Math.sin(angle)}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
    </ViewportPortal>
  );
}

function Specks() {
  const [x, y] = useStore((state) => state.transform);
  return (
    <div
      className="canvas-specks star-field"
      style={{ backgroundPosition: `${String(x * 0.25)}px ${String(y * 0.25)}px` }}
      aria-hidden
    />
  );
}

function Guidance({ editable, coarse, hasLinks }: { editable: boolean; coarse: boolean; hasLinks: boolean }) {
  if (editable && !coarse) {
    return (
      // Open until the first line exists, then out of the way but one click from coming back.
      <details open={!hasLinks} className="text-muted-foreground">
        <summary className="text-foreground min-h-6 cursor-pointer rounded-xs font-medium">How to edit</summary>
        <ol className="mt-1 flex list-inside list-decimal flex-col gap-1">
          <li>Drag a series to move it. Click it to open it.</li>
          <li>Drag from a star on its edge onto another series to draw a line, then pick the type.</li>
          <li>Click a line to change or remove it.</li>
        </ol>
      </details>
    );
  }
  const explore =
    coarse ? 'Drag to pan, pinch to zoom, tap a series to open it.' : 'Drag to pan, scroll to zoom, click a series to open it.';
  return (
    <p className="text-muted-foreground">
      {editable ? `${explore} To move series or draw lines, open this page on a computer.` : `Read only. ${explore}`}
    </p>
  );
}

function Legend({ editable, coarse, hasLinks }: { editable: boolean; coarse: boolean; hasLinks: boolean }) {
  return (
    <Panel position="bottom-left">
      <div className="bg-card text-card-foreground flex w-64 max-w-[calc(100vw-6rem)] flex-col gap-2 rounded-lg border px-3 py-2 text-xs">
        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-2">
            <LinkSample kind="recommend" />
            Goes together
          </span>
          <span className="flex items-center gap-2">
            <LinkSample kind="avoid" />
            Doesn&apos;t go together
          </span>
        </div>
        <div className="border-t pt-2">
          <Guidance editable={editable} coarse={coarse} hasLinks={hasLinks} />
        </div>
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
    const byId = new Map(nodes.map((node) => [node.id, node]));
    return links.flatMap((link): LinkFlowEdge[] => {
      const a = byId.get(link.seriesAId);
      const b = byId.get(link.seriesBId);
      if (!a || !b) return [];
      return [
        {
          id: `${link.seriesAId}:${link.seriesBId}`,
          source: link.seriesAId,
          target: link.seriesBId,
          type: 'link',
          ariaLabel: `${a.data.title} ${link.kind === 'avoid' ? "doesn't go" : 'goes'} together with ${b.data.title}`,
          sourceHandle: 'center',
          targetHandle: 'center',
          className: `canvas-edge-${link.kind}`,
          focusable: interactive,
          data: { link },
          // Enter or Space on a focused line opens its menu, as a click does.
          ...(interactive && {
            domAttributes: {
              onKeyDown: (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                const rect = event.currentTarget.getBoundingClientRect();
                const from = event.currentTarget;
                setMenu({ type: 'edge', x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, link, from });
              },
            },
          }),
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
    <div className="size-full">
      <ReactFlow
        className="canvas-flow"
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        connectionMode={ConnectionMode.Loose}
        nodesDraggable={interactive}
        nodesConnectable={interactive}
        // One tab stop per series: its link inside, not also the node around it.
        nodesFocusable={false}
        elementsSelectable={false}
        edgesFocusable={interactive}
        onlyRenderVisibleElements
        fitView
        fitViewOptions={coarse ? FIT_PHONE : editable && links.length === 0 ? FIT_FIRST_VISIT : FIT_DESKTOP}
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
            (event, edge: LinkFlowEdge) => {
              const from = event.currentTarget instanceof SVGElement ? event.currentTarget : null;
              if (edge.data) setMenu({ type: 'edge', x: event.clientX, y: event.clientY, link: edge.data.link, from });
            }
          : undefined
        }
      >
        <Specks />
        <Graticule />
        <Controls showInteractive={false} position="bottom-right" />
        <Legend editable={editable} coarse={coarse} hasLinks={links.length > 0} />
      </ReactFlow>
      {menu && (
        <CanvasMenu
          x={menu.x}
          y={menu.y}
          returnFocusTo={menu.type === 'edge' ? menu.from : null}
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
            <LinkSample kind="recommend" />
            Goes together
          </MenuItem>
          <MenuItem
            disabled={menu.type === 'edge' && menu.link.kind === 'avoid'}
            onSelect={() => {
              chooseKind('avoid');
            }}
          >
            <LinkSample kind="avoid" />
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
