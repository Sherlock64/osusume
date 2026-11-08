import {
  CANVAS_GROUP_NAME_MAX,
  SERIES_RATING_DEFAULT,
  type CanvasGroup,
  type CanvasLink,
  type CanvasLinkKind,
  type CanvasNode,
} from '@osusume/shared';
import {
  applyNodeChanges,
  ConnectionMode,
  Controls,
  Panel,
  ReactFlow,
  useReactFlow,
  useStore,
  ViewportPortal,
  type NodeChange,
  type OnConnectEnd,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { CanvasMenu, MenuItem } from '@/components/canvas/canvas-menu';
import { ConstellationsCard } from '@/components/canvas/constellations-card';
import { GROUP_HANDLE, GroupNode, type GroupFlowNode } from '@/components/canvas/group-node';
import { LinkEdge, LinkSample, type LinkFlowEdge } from '@/components/canvas/link-edge';
import { MapSearch } from '@/components/canvas/map-search';
import { SeriesNode, STAR_SIZE, type SeriesFlowNode } from '@/components/canvas/series-node';
import { ConfirmButton } from '@/components/confirm-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  drawnGroupBox,
  groupBox,
  nudgeGroup,
  nudgeSeries,
  placeInGroup,
  placeNodes,
  type LayoutState,
  type Point,
} from '@/lib/canvas-layout';
import './canvas.css';

interface RecommendationCanvasProps {
  username: string;
  nodes: CanvasNode[];
  links: CanvasLink[];
  groups: CanvasGroup[];
  editable: boolean;
  onMoveNodes: (positions: { seriesId: string; x: number; y: number }[]) => void;
  onSetLink: (link: CanvasLink) => void;
  onRemoveLink: (seriesAId: string, seriesBId: string) => void;
  onCreateGroup: (name: string, seriesId: string) => void;
  onRenameGroup: (groupId: string, name: string) => void;
  /** Settles once the group is gone, so the confirm dialog can show a failure. */
  onDeleteGroup: (groupId: string) => Promise<unknown>;
  /** `position` is where the series goes once it has joined. */
  onAddToGroup: (groupId: string, seriesId: string, position: Point) => void;
  onRemoveFromGroup: (groupId: string, seriesId: string) => void;
}

type OpenMenu =
  | { type: 'connect'; x: number; y: number; seriesAId: string; seriesBId: string; from: HTMLElement | null }
  | { type: 'edge'; x: number; y: number; link: CanvasLink; from: SVGElement | null }
  | { type: 'node'; x: number; y: number; seriesId: string; from: HTMLElement | null; step: 'main' | 'link' | 'group' }
  | { type: 'group'; x: number; y: number; groupId: string; from: HTMLElement | null; step: 'main' | 'add' | 'rename' };

type CanvasFlowNode = SeriesFlowNode | GroupFlowNode;

const nodeTypes = { series: SeriesNode, constellation: GroupNode };
const edgeTypes = { link: LinkEdge };

// Room for the title block and legend, so the first fit doesn't start underneath them.
const FIT_DESKTOP = { padding: { top: '110px', right: '80px', bottom: '110px', left: '48px' } } as const;
// The legend stands taller with its steps open, so nothing starts behind it on a first visit.
const FIT_FIRST_VISIT = { padding: { ...FIT_DESKTOP.padding, left: '300px' } } as const;
// On a phone, keep nodes legible and tappable even if they don't all fit.
const FIT_PHONE = { minZoom: 0.6 };

const COARSE_POINTER = '(pointer: coarse)';

/** Group nodes share xyflow's id space with series, so they carry a prefix. */
const GROUP_PREFIX = 'group:';

/** Flags a node for one transform slide, cleared on the next drag. */
const SLIDE = 'canvas-slide';

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
          <li>Right-click a series (or Shift+F10) to link it or start a group. Drag a group by its name; right-click the name for more.</li>
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
    a.data.popIn === b.data.popIn &&
    a.data.highlighted === b.data.highlighted
  );
}

function moveBy(nodes: SeriesFlowNode[], from: ReadonlyMap<string, Point>, delta: Point) {
  return nodes.map((node) => {
    const start = from.get(node.id);
    return start ? { ...node, position: { x: start.x + delta.x, y: start.y + delta.y } } : node;
  });
}

/** The map search card, inside <ReactFlow> so it can pan the view. */
function SearchCard({
  onHighlight,
  ...props
}: {
  username: string;
  nodes: readonly CanvasNode[];
  compact: boolean;
  onHighlight: (seriesId: string | null) => void;
}) {
  const { setCenter, getZoom, getNode } = useReactFlow();
  const domNode = useStore((state) => state.domNode);
  return (
    <ConstellationsCard
      {...props}
      onFocus={(seriesId) => {
        onHighlight(seriesId);
        const node = seriesId === null ? undefined : getNode(seriesId);
        if (!node || !domNode) return;
        // shortcut: the card reports typing and picks alike, so only a click on a result (focus on it) counts as a pick, not Enter.
        const picked = !props.compact && document.activeElement?.closest('.react-flow__panel li') != null;
        const zoom = Math.max(getZoom(), 0.75);
        // On a phone the open card covers the top of the map: centre the match in the part below it.
        const card = props.compact ? document.querySelector('[data-map-card]') : null;
        const covered = card ? card.getBoundingClientRect().bottom - domNode.getBoundingClientRect().top : 0;
        const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        void setCenter(node.position.x + STAR_SIZE / 2, node.position.y + STAR_SIZE / 2 - covered / 2 / zoom, {
          zoom,
          duration: still ? 0 : 400,
        }).then(() => {
          // Keyboard users land on the bubble, so Shift+F10 opens its menu straight away.
          if (picked)
            domNode
              .querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(node.id)}"] a`)
              ?.focus({ preventScroll: true });
        });
      }}
    />
  );
}

/** An inline name field for a group, in a menu. */
function NameForm({ initial, submitLabel, onSubmit }: { initial: string; submitLabel: string; onSubmit: (name: string) => void }) {
  const id = useId();
  const [name, setName] = useState(initial);
  return (
    <form
      className="flex flex-col gap-2 px-2 pt-1"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim() !== '') onSubmit(name.trim());
      }}
    >
      <Label htmlFor={id}>Group name</Label>
      <Input
        id={id}
        autoFocus
        required
        maxLength={CANVAS_GROUP_NAME_MAX}
        value={name}
        onChange={(event) => {
          setName(event.target.value);
        }}
      />
      <Button type="submit" size="sm" disabled={name.trim() === ''}>
        {submitLabel}
      </Button>
    </form>
  );
}

function pointOf(event: MouseEvent | TouchEvent) {
  const touch = 'changedTouches' in event ? event.changedTouches[0] : undefined;
  const source = touch ?? (event as MouseEvent);
  return { x: source.clientX, y: source.clientY };
}

/** The recommendation canvas: series as draggable nodes, linked by "goes together" or "doesn't" lines. */
export function RecommendationCanvas({
  username,
  nodes: seriesNodes,
  links,
  groups,
  editable,
  onMoveNodes,
  onSetLink,
  onRemoveLink,
  onCreateGroup,
  onRenameGroup,
  onDeleteGroup,
  onAddToGroup,
  onRemoveFromGroup,
}: RecommendationCanvasProps) {
  const coarse = useCoarsePointer();
  const interactive = editable && !coarse;
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  // Nodes the last drop or join moved for the user, which slide there instead of jumping.
  const [slid, setSlid] = useState<ReadonlySet<string>>(new Set());

  const groupOf = useMemo(
    () => new Map(seriesNodes.flatMap((node) => (node.groupId === null ? [] : [[node.seriesId, node.groupId] as const]))),
    [seriesNodes],
  );

  const placed = useMemo(() => {
    const boxes = groups.flatMap((group) => {
      const box = groupBox(
        seriesNodes.flatMap((node) =>
          node.groupId === group.id && node.x !== null && node.y !== null ? [{ x: node.x, y: node.y }] : [],
        ),
      );
      return box ? [box] : [];
    });
    return placeNodes(seriesNodes, boxes);
  }, [seriesNodes, groups]);
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
          rating: node?.rating ?? SERIES_RATING_DEFAULT,
          interactive,
          popIn: popped.has(position.seriesId),
          highlighted: highlighted === position.seriesId,
        },
      };
    });
  }, [placed, seriesNodes, interactive, popped, highlighted]);

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

  // Boxes follow the local positions, so they refit live while a member is dragged.
  const groupNodes = useMemo(
    () =>
      groups.flatMap((group): GroupFlowNode[] => {
        const box = drawnGroupBox(
          nodes
            .filter((node) => groupOf.get(node.id) === group.id)
            .map((node) => ({ ...node.position, title: node.data.title })),
        );
        if (!box) return [];
        const id = GROUP_PREFIX + group.id;
        return [
          {
            id,
            type: 'constellation',
            position: { x: box.x, y: box.y },
            width: box.width,
            height: box.height,
            zIndex: -1,
            draggable: interactive,
            dragHandle: `.${GROUP_HANDLE}`,
            ...(slid.has(id) && { className: SLIDE }),
            data: { groupId: group.id, name: group.name, interactive },
          },
        ];
      }),
    [groups, nodes, groupOf, interactive, slid],
  );
  const shownNodes = useMemo(
    (): CanvasFlowNode[] => [
      ...groupNodes,
      ...nodes.map((node) => (slid.has(node.id) ? { ...node, className: SLIDE } : node)),
    ],
    [groupNodes, nodes, slid],
  );

  const layout = (overrides: Iterable<readonly [string, Point]> = []): LayoutState => ({
    positions: new Map([...nodes.map((node) => [node.id, node.position] as const), ...overrides]),
    groupOf,
  });

  // A group's drag moves its members from where they were when it started.
  const groupDrag = useRef<{ nodeId: string; groupId: string; box: Point; members: Map<string, Point> } | null>(null);

  const openMenuFor = (nodeId: string, x: number, y: number, from: HTMLElement | null) => {
    setMenu(
      nodeId.startsWith(GROUP_PREFIX) ?
        { type: 'group', x, y, groupId: nodeId.slice(GROUP_PREFIX.length), from, step: 'main' }
      : { type: 'node', x, y, seriesId: nodeId, from, step: 'main' },
    );
  };

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
    setMenu({ type: 'connect', ...point, seriesAId: from, seriesBId: to, from: null });
  };

  const chooseKind = (kind: CanvasLinkKind) => {
    if (menu?.type === 'connect') {
      onSetLink({ seriesAId: menu.seriesAId, seriesBId: menu.seriesBId, kind });
    } else if (menu?.type === 'edge') {
      onSetLink({ ...menu.link, kind });
    }
    setMenu(null);
  };

  const menuGroup = menu?.type === 'group' ? groups.find((group) => group.id === menu.groupId) : undefined;
  const nodeGroupId = menu?.type === 'node' ? groupOf.get(menu.seriesId) : undefined;
  const nodeGroup = groups.find((group) => group.id === nodeGroupId);

  return (
    <div
      className="size-full"
      // Enter on a group's name opens its menu; the ContextMenu key and Shift+F10 arrive as contextmenu events.
      onKeyDown={(event) => {
        const target = event.target as HTMLElement;
        if (!interactive || event.key !== 'Enter' || !target.classList.contains(GROUP_HANDLE)) return;
        const id = target.closest<HTMLElement>('.react-flow__node')?.dataset.id;
        if (id === undefined) return;
        event.preventDefault();
        const rect = target.getBoundingClientRect();
        openMenuFor(id, rect.x, rect.bottom, target);
      }}
    >
      <ReactFlow
        className="canvas-flow"
        nodes={shownNodes}
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
        onNodesChange={(changes: NodeChange<CanvasFlowNode>[]) => {
          // Group nodes are derived from their members: a drag of one moves the members instead.
          const drag = groupDrag.current;
          const groupMove = changes.find((change) => change.type === 'position' && change.id === drag?.nodeId);
          if (drag && groupMove?.type === 'position' && groupMove.position) {
            const delta = { x: groupMove.position.x - drag.box.x, y: groupMove.position.y - drag.box.y };
            setNodes((current) => moveBy(current, drag.members, delta));
          }
          const seriesChanges = changes.filter(
            (change) => !(change.type === 'add' ? change.item.id : change.id).startsWith(GROUP_PREFIX),
          ) as NodeChange<SeriesFlowNode>[];
          if (seriesChanges.length > 0) setNodes((current) => applyNodeChanges(seriesChanges, current));
        }}
        onNodeDragStart={(_event, node) => {
          if (slid.size > 0) setSlid(new Set());
          if (node.type !== 'constellation') return;
          const members = new Map(
            nodes.filter((member) => groupOf.get(member.id) === node.data.groupId).map((member) => [member.id, member.position]),
          );
          groupDrag.current = { nodeId: node.id, groupId: node.data.groupId, box: node.position, members };
        }}
        onNodeDragStop={(_event, node) => {
          if (node.type === 'constellation') {
            const drag = groupDrag.current;
            groupDrag.current = null;
            if (!drag) return;
            const dragged = { x: node.position.x - drag.box.x, y: node.position.y - drag.box.y };
            // Judged against where everything stood before the drag.
            const delta = nudgeGroup(layout(drag.members), drag.groupId, dragged);
            setNodes((current) => moveBy(current, drag.members, delta));
            if (delta.x !== dragged.x || delta.y !== dragged.y) setSlid(new Set([node.id, ...drag.members.keys()]));
            onMoveNodes([...drag.members].map(([seriesId, p]) => ({ seriesId, x: p.x + delta.x, y: p.y + delta.y })));
            return;
          }
          const spot = nudgeSeries(layout([[node.id, node.position]]), node.id, node.position);
          if (spot !== node.position) {
            setNodes((current) => current.map((other) => (other.id === node.id ? { ...other, position: spot } : other)));
            const groupId = groupOf.get(node.id);
            setSlid(new Set(groupId === undefined ? [node.id] : [node.id, GROUP_PREFIX + groupId]));
          }
          onMoveNodes([{ seriesId: node.id, x: spot.x, y: spot.y }]);
        }}
        onNodeContextMenu={
          interactive ?
            (event, node) => {
              event.preventDefault();
              const focused = document.activeElement;
              const from =
                focused instanceof HTMLElement && event.currentTarget.contains(focused) ? focused : null;
              // A right-click opens at the pointer; the keyboard's menu keys at the focused bubble or name.
              if (event.button === 2 || !from) {
                openMenuFor(node.id, event.clientX, event.clientY, from);
              } else {
                const rect = from.getBoundingClientRect();
                openMenuFor(node.id, rect.x + rect.width / 2, rect.y + rect.height / 2, from);
              }
            }
          : undefined
        }
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
        <SearchCard username={username} nodes={seriesNodes} compact={coarse} onHighlight={setHighlighted} />
      </ReactFlow>
      {menu && (
        <CanvasMenu
          x={menu.x}
          y={menu.y}
          // One menu for every step, so going from Link to… to the kind picker doesn't close it.
          returnFocusTo={menu.from}
          onDismiss={() => {
            setMenu(null);
          }}
        >
          {(menu.type === 'connect' || menu.type === 'edge') && (
            <>
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
            </>
          )}
          {menu.type === 'node' && menu.step === 'main' && (
            <>
              <MenuItem
                onSelect={() => {
                  setMenu({ ...menu, step: 'link' });
                }}
              >
                Link to…
              </MenuItem>
              <MenuItem
                onSelect={() => {
                  setMenu({ ...menu, step: 'group' });
                }}
              >
                New group…
              </MenuItem>
              {nodeGroup && (
                <MenuItem
                  onSelect={() => {
                    onRemoveFromGroup(nodeGroup.id, menu.seriesId);
                    setMenu(null);
                  }}
                >
                  <span className="truncate">Remove from {nodeGroup.name}</span>
                </MenuItem>
              )}
            </>
          )}
          {menu.type === 'node' && menu.step === 'link' && (
            <div className="px-2 pt-1">
              <MapSearch
                username={username}
                nodes={seriesNodes}
                label="Link to"
                exclude={new Set([menu.seriesId])}
                autoFocus
                onPick={(seriesBId) => {
                  setMenu({ type: 'connect', x: menu.x, y: menu.y, seriesAId: menu.seriesId, seriesBId, from: menu.from });
                }}
              />
            </div>
          )}
          {menu.type === 'node' && menu.step === 'group' && (
            <NameForm
              initial=""
              submitLabel="Create"
              onSubmit={(name) => {
                onCreateGroup(name, menu.seriesId);
                setMenu(null);
              }}
            />
          )}
          {menu.type === 'group' && menuGroup && menu.step === 'main' && (
            <>
              <MenuItem
                onSelect={() => {
                  setMenu({ ...menu, step: 'add' });
                }}
              >
                Add series…
              </MenuItem>
              <MenuItem
                onSelect={() => {
                  setMenu({ ...menu, step: 'rename' });
                }}
              >
                Rename…
              </MenuItem>
              {/* A ghost item like its neighbours; the dialog it opens keeps the danger styling. */}
              <div className="[&>button]:hover:bg-destructive/10 flex flex-col [&>button]:justify-start [&>button]:border-transparent [&>button]:bg-transparent">
                <ConfirmButton
                  label="Delete group"
                  title={`Delete ${menuGroup.name}?`}
                  description="The group goes. Its series stay on the map where they are, with their lines."
                  onConfirm={async () => {
                    await onDeleteGroup(menuGroup.id);
                    setMenu(null);
                  }}
                />
              </div>
            </>
          )}
          {menu.type === 'group' && menuGroup && menu.step === 'add' && (
            <div className="px-2 pt-1">
              <MapSearch
                username={username}
                nodes={seriesNodes}
                label={`Add to ${menuGroup.name}`}
                exclude={new Set(seriesNodes.filter((node) => node.groupId === menuGroup.id).map((node) => node.seriesId))}
                autoFocus
                onPick={(seriesId) => {
                  const groupOfAfter = new Map(groupOf).set(seriesId, menuGroup.id);
                  const position = placeInGroup({ ...layout(), groupOf: groupOfAfter }, seriesId, menuGroup.id);
                  setSlid(new Set([seriesId, GROUP_PREFIX + menuGroup.id]));
                  onAddToGroup(menuGroup.id, seriesId, position);
                  setMenu(null);
                }}
              />
            </div>
          )}
          {menu.type === 'group' && menuGroup && menu.step === 'rename' && (
            <NameForm
              initial={menuGroup.name}
              submitLabel="Save"
              onSubmit={(name) => {
                onRenameGroup(menuGroup.id, name);
                setMenu(null);
              }}
            />
          )}
        </CanvasMenu>
      )}
    </div>
  );
}
