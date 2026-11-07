import type { Cover } from '@osusume/shared';
import { useState } from 'react';
import { Constellation } from '@/components/logo-mark';
import { cn } from '@/lib/utils';

interface CoverImageProps {
  cover: Cover | null;
  /** Served sizes, by longest edge: small 160, medium 320, large 640 px. */
  size: 'small' | 'medium' | 'large';
  alt: string;
  /** The series' title. Named on the fallback when there is room, and it picks the constellation. */
  title?: string;
  className?: string;
}

function hash(text: string) {
  let sum = 0;
  for (const char of text) sum = (sum * 31 + (char.codePointAt(0) ?? 0)) % 1009;
  return sum;
}

/** A series or season cover. Shows a drawn plate when there is none or it fails to load. */
export function CoverImage({ cover, size, alt, title, className }: CoverImageProps) {
  const [failedId, setFailedId] = useState<string | null>(null);
  const frame = cn('bg-muted aspect-[2/3] overflow-hidden rounded-md', className);

  if (cover === null || cover.id === failedId) {
    const name = title ?? alt;
    return (
      <div
        {...(alt === '' ? { 'aria-hidden': true } : { role: 'img', 'aria-label': alt })}
        className={cn(frame, '@container flex flex-col border')}
      >
        <Constellation
          index={hash(name)}
          className="text-muted-foreground mx-auto min-h-0 w-3/4 flex-1"
        />
        {name !== '' && (
          <p className="font-heading text-muted-foreground line-clamp-3 hidden px-2 pb-2 text-sm leading-tight wrap-anywhere @[7rem]:block">
            {name}
          </p>
        )}
      </div>
    );
  }
  return (
    <div className={frame}>
      <img
        src={`/api/v1/images/${cover.id}/${size}`}
        alt={alt}
        width={cover.width}
        height={cover.height}
        loading="lazy"
        className="size-full object-cover"
        onError={() => {
          setFailedId(cover.id);
        }}
      />
    </div>
  );
}
