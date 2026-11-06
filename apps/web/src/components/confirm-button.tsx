import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { toApiError } from '@/lib/api-request';

interface ConfirmButtonProps {
  /** On the button, and on the dialog's confirm button unless `confirmLabel` is given. */
  label: string;
  title: string;
  description: string;
  confirmLabel?: string;
  /** The dialog stays open until this settles, and shows the error if it fails. */
  onConfirm: () => Promise<unknown>;
}

/** A button for a destructive action, which asks first. */
export function ConfirmButton({
  label,
  title,
  description,
  confirmLabel = label,
  onConfirm,
}: ConfirmButtonProps) {
  const [open, setOpen] = useState(false);
  const action = useMutation({
    mutationFn: onConfirm,
    onSuccess: () => {
      setOpen(false);
    },
  });

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (action.isPending) return;
        setOpen(next);
        action.reset();
      }}
    >
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {action.isError && (
          <p role="alert" className="text-destructive text-sm">
            {toApiError(action.error).message}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={action.isPending}>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={action.isPending}
            onClick={() => {
              action.mutate();
            }}
          >
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
