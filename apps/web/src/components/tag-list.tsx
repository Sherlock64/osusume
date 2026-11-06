import type { Tag } from '@osusume/shared';
import { Badge } from '@/components/ui/badge';

export function TagList({ tags }: { tags: readonly Tag[] }) {
  if (tags.length === 0) return null;
  return (
    <ul aria-label="Tags" className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <li key={tag.id} className="max-w-full">
          <Badge variant="secondary" className="h-auto max-w-full whitespace-normal wrap-anywhere">
            {tag.name}
          </Badge>
        </li>
      ))}
    </ul>
  );
}
