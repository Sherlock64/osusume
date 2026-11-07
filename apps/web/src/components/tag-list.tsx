import type { Tag } from '@osusume/shared';
import { Badge } from '@/components/ui/badge';

/** `limit` keeps a small card short, by counting the rest instead of listing them. */
export function TagList({ tags, limit = tags.length }: { tags: readonly Tag[]; limit?: number }) {
  if (tags.length === 0) return null;
  return (
    <ul aria-label="Tags" className="flex flex-wrap gap-1">
      {tags.slice(0, limit).map((tag) => (
        <li key={tag.id} className="max-w-full">
          <Badge variant="secondary" className="h-auto max-w-full whitespace-normal wrap-anywhere">
            {tag.name}
          </Badge>
        </li>
      ))}
      {tags.length > limit && (
        <li className="text-muted-foreground self-center px-1 text-xs">{`+${String(tags.length - limit)} more`}</li>
      )}
    </ul>
  );
}
