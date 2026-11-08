import { SEARCH_QUERY_MAX_LENGTH, type CanvasNode } from '@osusume/shared';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useEffect, useEffectEvent, useId, useRef, useState } from 'react';
import { CoverImage } from '@/components/cover-image';
import { QueryFallback } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { request } from '@/lib/api-request';

const DEBOUNCE_MS = 250;

/** Search of series on one user's map. Debounced 250 ms, server-side. Results are buttons. */
export function MapSearch({
  username,
  nodes,
  label,
  exclude,
  autoFocus,
  onResults,
  onPick,
}: {
  username: string;
  nodes: readonly CanvasNode[];
  label: string;
  exclude?: ReadonlySet<string>;
  autoFocus?: boolean;
  onResults?: (seriesIds: string[]) => void;
  onPick: (seriesId: string) => void;
}) {
  const inputId = useId();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const results = useQuery({
    queryKey: ['canvas', username, 'search', q],
    enabled: q !== '',
    queryFn: () =>
      request(
        api.users[':username'].canvas.search.$get({
          param: { username },
          query: { q },
        }),
      ),
  });

  useEffect(() => {
    const trimmed = text.trim();
    const timer = setTimeout(
      () => {
        setQ(trimmed);
      },
      trimmed === '' ? 0 : DEBOUNCE_MS,
    );
    return () => {
      clearTimeout(timer);
    };
  }, [text]);

  const byId = new Map(nodes.map((node) => [node.seriesId, node]));
  const knownNodes = (ids: readonly string[]) =>
    ids.flatMap((id) => {
      const node = byId.get(id);
      return node === undefined || exclude?.has(id) === true ? [] : [node];
    });
  const items =
    results.data === undefined ? undefined : knownNodes(results.data.seriesIds);

  // Reported per settled search only, so a canvas refetch (new `nodes`) does not pan again.
  const hadQuery = useRef(false);
  const report = useEffectEvent((ids: string[] | undefined) => {
    if (q === '') {
      if (hadQuery.current) onResults?.([]);
      hadQuery.current = false;
    } else if (ids !== undefined) {
      hadQuery.current = true;
      onResults?.(knownNodes(ids).map((node) => node.seriesId));
    }
  });
  useEffect(() => {
    report(results.data?.seriesIds);
  }, [q, results.data]);

  return (
    <div className='flex min-h-0 flex-col gap-2'>
      <form
        role='search'
        className='flex flex-col gap-1.5'
        onSubmit={(event) => {
          event.preventDefault();
          const top = items?.[0];
          if (top !== undefined) onPick(top.seriesId);
        }}
      >
        <Label htmlFor={inputId}>{label}</Label>
        <div className='relative'>
          <Search
            className='text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2'
            aria-hidden
          />
          <Input
            id={inputId}
            type='search'
            maxLength={SEARCH_QUERY_MAX_LENGTH}
            placeholder='Titles and alternate titles'
            autoComplete='off'
            autoFocus={autoFocus}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
            }}
            className='pl-9'
          />
        </div>
      </form>
      {q !== '' &&
        (items === undefined ? (
          <QueryFallback query={results} />
        ) : items.length === 0 ? (
          <p role='status' className='text-muted-foreground py-2 text-sm'>
            No series on the map match
          </p>
        ) : (
          <ul className='nowheel -mx-1 flex max-h-[50vh] flex-col gap-0.5 overflow-y-auto px-1 pointer-coarse:max-h-56'>
            {items.map((node) => (
              <li key={node.seriesId}>
                <Button
                  variant='ghost'
                  className='h-auto w-full justify-start gap-3 py-1 text-left font-normal whitespace-normal wrap-anywhere'
                  onClick={() => {
                    onPick(node.seriesId);
                  }}
                >
                  <CoverImage
                    cover={node.cover}
                    size='small'
                    alt=''
                    title={node.title}
                    className='w-8 shrink-0'
                  />
                  <span className='min-w-0 font-medium'>{node.title}</span>
                </Button>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
