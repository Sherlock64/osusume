import { Popover } from 'radix-ui';
import { useRef, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';

interface CanvasMenuProps {
  /** Where to open, in viewport coordinates. */
  x: number;
  y: number;
  onDismiss: () => void;
  /** Where focus goes back to when the menu closes, unless it closed by a click elsewhere. */
  returnFocusTo?: HTMLElement | SVGElement | null;
  children: ReactNode;
}

/** A small menu opened at a point on the canvas. Escape or a click elsewhere dismisses it. */
export function CanvasMenu({ x, y, onDismiss, returnFocusTo, children }: CanvasMenuProps) {
  const clickedOutside = useRef(false);
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
          className="bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=open]:fade-in-0 z-50 flex w-56 flex-col gap-0.5 rounded-lg border p-1 shadow-md duration-100"
          onPointerDownOutside={() => {
            clickedOutside.current = true;
          }}
          onCloseAutoFocus={(event) => {
            if (clickedOutside.current || !returnFocusTo?.isConnected) return;
            event.preventDefault();
            returnFocusTo.focus();
          }}
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
