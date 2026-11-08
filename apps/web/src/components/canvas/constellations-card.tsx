import type { CanvasNode } from '@osusume/shared';
import { Panel } from '@xyflow/react';
import { ChevronUp, Search, X } from 'lucide-react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { MapSearch } from '@/components/canvas/map-search';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

/** The side card. Renders its own <Panel position="top-right"> and must be a child of <ReactFlow>. */
export function ConstellationsCard({
  username,
  nodes,
  compact,
  onFocus,
}: {
  username: string;
  nodes: readonly CanvasNode[];
  compact: boolean;
  onFocus: (seriesId: string | null) => void;
}) {
  const [open, setOpen] = useState(!compact);
  // Focus follows a toggle the user made, never the first render.
  const [toggled, setToggled] = useState(false);
  const toggle = (next: boolean) => {
    setOpen(next);
    setToggled(true);
  };

  const card = (
    <Card size="sm" className={compact ? 'w-full gap-2 px-3' : 'w-72 max-w-[calc(100vw-2rem)] gap-2 px-3'}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-heading text-base font-medium">Constellations</h2>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={compact ? 'Close search' : 'Collapse search'}
          onClick={() => {
            toggle(false);
          }}
        >
          {compact ?
            <X aria-hidden />
          : <ChevronUp aria-hidden />}
        </Button>
      </div>
      <MapSearch
        username={username}
        nodes={nodes}
        label="Find a series on the map"
        autoFocus={toggled}
        onResults={(ids) => {
          onFocus(ids[0] ?? null);
        }}
        onPick={(seriesId) => {
          onFocus(seriesId);
          if (compact) toggle(false);
        }}
      />
    </Card>
  );

  // React Flow's root is its own stacking context under the canvas title, so on phones the open card leaves it to sit
  // above the title, full width, at the panel's spot under the 56px shell header.
  if (open && compact) return createPortal(<div data-map-card className="fixed inset-x-4 top-18 z-20">{card}</div>, document.body);

  return (
    <Panel position="top-right">
      {open ?
        card
      : <Button
          variant="outline"
          size="icon"
          // md:size-11 overrides the icon size's md:size-9, so the round button stays 44px on desktop too.
          className="bg-card size-11 rounded-full md:size-11"
          aria-label="Find a series on the map"
          aria-expanded={false}
          autoFocus={toggled}
          onClick={() => {
            toggle(true);
          }}
        >
          <Search aria-hidden />
        </Button>
      }
    </Panel>
  );
}
