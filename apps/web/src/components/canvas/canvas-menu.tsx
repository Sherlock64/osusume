import { Popover } from 'radix-ui';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';

interface CanvasMenuProps {
  /** Where to open, in viewport coordinates. */
  x: number;
  y: number;
  onDismiss: () => void;
  children: ReactNode;
}

/** A small menu opened at a point on the canvas. Escape or a click elsewhere dismisses it. */
export function CanvasMenu({ x, y, onDismiss, children }: CanvasMenuProps) {
  const anchor = { getBoundingClientRect: () => DOMRect.fromRect({ x, y, width: 0, height: 0 }) };
  return (
    <Popover.Root
      open
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
    >
      <Popover.Anchor virtualRef={{ current: anchor }} />
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="bg-popover text-popover-foreground z-50 flex w-48 flex-col gap-0.5 rounded-lg border p-1 shadow-md"
        >
          {children}
          <MenuItem onSelect={onDismiss}>Cancel</MenuItem>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function MenuItem({
  onSelect,
  children,
  disabled,
}: {
  onSelect: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <Button variant="ghost" size="sm" className="justify-start" disabled={disabled} onClick={onSelect}>
      {children}
    </Button>
  );
}
