import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** A small star, the atlas' section mark. Decorative. */
function StarMark() {
  return <span className="bg-star size-1.5 shrink-0 rotate-45" aria-hidden />;
}

/** The top of every app page: the h1, a line of context, and the page's main actions. */
export function PageHeader({
  title,
  eyebrow,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b pb-4', className)}>
      <div className="min-w-0">
        {eyebrow !== undefined && (
          <p className="eyebrow mb-1 flex items-center gap-2">
            {/* Not beside a back link, which brings its own arrow. */}
            {typeof eyebrow === 'string' && <StarMark />}
            {eyebrow}
          </p>
        )}
        <h1 className="text-3xl leading-tight font-medium wrap-anywhere sm:text-4xl">{title}</h1>
        {description !== undefined && (
          <p className="text-muted-foreground mt-1 max-w-prose text-sm">{description}</p>
        )}
      </div>
      {actions !== undefined && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** An h2 with a thin rule running out to its optional actions. */
export function SectionHeading({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-3">
      <h2 className="text-xl font-medium wrap-anywhere">{children}</h2>
      {/* A rule running out from a star, like a line of the logo's constellations. */}
      <span className="flex min-w-4 flex-1 items-center" aria-hidden>
        <StarMark />
        <span className="bg-border h-px flex-1" />
      </span>
      {actions}
    </div>
  );
}
