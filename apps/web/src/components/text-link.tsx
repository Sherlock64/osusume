import { createLink } from '@tanstack/react-router';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

function StyledAnchor({ className, ...props }: ComponentProps<'a'>) {
  return <a className={cn('text-sm underline underline-offset-4', className)} {...props} />;
}

export const TextLink = createLink(StyledAnchor);
