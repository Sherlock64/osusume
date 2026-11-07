import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useId, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { tagsQuery } from '@/lib/catalog';

const SHOWN_MAX = 30;

/** Chooses tags from the vocabulary. Holds no form input: read the choice from `selected`. */
export function TagPicker({
  label,
  hint,
  selected,
  onChange,
}: {
  label: string;
  hint?: string;
  selected: readonly string[];
  onChange: (next: string[]) => void;
}) {
  const filterId = useId();
  const [filter, setFilter] = useState('');
  const tags = useQuery(tagsQuery);
  const all = tags.data ?? [];
  const chosen = all.filter((tag) => selected.includes(tag.id));
  const needle = filter.trim().toLowerCase();
  const matching = all.filter(
    (tag) => !selected.includes(tag.id) && tag.name.toLowerCase().includes(needle),
  );

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={filterId}>{label}</Label>
      {hint !== undefined && <p className="text-muted-foreground text-sm">{hint}</p>}
      {chosen.length > 0 && (
        <ul aria-label="Chosen tags" className="flex flex-wrap gap-1">
          {chosen.map((tag) => (
            <li key={tag.id} className="max-w-full">
              <Badge
                variant="secondary"
                className="h-auto max-w-full overflow-visible pr-0.5 whitespace-normal wrap-anywhere"
              >
                {tag.name}
                <button
                  type="button"
                  className="hover:bg-accent inline-flex size-11 shrink-0 md:size-6 cursor-pointer items-center justify-center rounded-xs"
                  aria-label={`Remove ${tag.name}`}
                  onClick={() => {
                    onChange(selected.filter((id) => id !== tag.id));
                  }}
                >
                  <X className="size-3" aria-hidden />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <Input
        id={filterId}
        type="search"
        placeholder="Find a tag"
        value={filter}
        onChange={(event) => {
          setFilter(event.target.value);
        }}
        onKeyDown={(event) => {
          // This sits inside the entry's form, which Enter would submit.
          if (event.key === 'Enter') event.preventDefault();
        }}
      />
      {tags.isError && (
        <p role="alert" className="text-destructive text-sm">
          The tags could not be loaded.
        </p>
      )}
      {matching.length > 0 && (
        <ul aria-label="Available tags" className="flex flex-wrap gap-1">
          {matching.slice(0, SHOWN_MAX).map((tag) => (
            <li key={tag.id} className="max-w-full">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-auto min-h-11 max-w-full whitespace-normal wrap-anywhere md:min-h-8"
                onClick={() => {
                  onChange([...selected, tag.id]);
                }}
              >
                {tag.name}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {matching.length > SHOWN_MAX && (
        <p className="text-muted-foreground text-sm">
          {`Showing ${String(SHOWN_MAX)} of ${String(matching.length)}. Type to narrow it down.`}
        </p>
      )}
    </div>
  );
}
