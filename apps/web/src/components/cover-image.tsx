import type { Cover } from '@osusume/shared';
import { ImageOff } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

interface CoverImageProps {
  cover: Cover | null;
  /** Served sizes, by longest edge: small 160, medium 320, large 640 px. */
  size: 'small' | 'medium' | 'large';
  alt: string;
  className?: string;
}

/** A series or season cover. Shows a placeholder when there is none or it fails to load. */
export function CoverImage({ cover, size, alt, className }: CoverImageProps) {
  const [failedId, setFailedId] = useState<string | null>(null);
  const frame = cn('bg-muted aspect-[2/3] overflow-hidden rounded-md', className);

  if (cover === null || cover.id === failedId) {
    return (
      <div role="img" aria-label={alt} className={cn(frame, 'flex items-center justify-center')}>
        <ImageOff className="text-muted-foreground size-6" aria-hidden />
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
