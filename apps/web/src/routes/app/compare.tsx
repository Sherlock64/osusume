import { usernameKey, type CompareResponse, type CompareRow, listStatusLabels } from '@osusume/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { X } from 'lucide-react';
import { useState } from 'react';
import { EmptyState, LoadMore, QueryFallback } from '@/components/states';
import { TextLink } from '@/components/text-link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { request } from '@/lib/api-request';
import { addCompareNames, compareGroups, isUnavailable, removeCompareName } from '@/lib/compare';
import { useCursorList } from '@/lib/pagination';
import { appRoute } from '@/routes/app';

function QuickPicks({ names, onPick }: { names: string[]; onPick: (name: string) => void }) {
  const { query, items } = useCursorList({
    queryKey: ['friends', 'friend'],
    fetchPage: (cursor) =>
      request(
        api.friends.$get({
          query: { relation: 'friend', ...(cursor === undefined ? {} : { cursor }) },
        }),
      ),
  });
  const chosen = new Set(names.map(usernameKey));
  const picks = items.filter(({ username }) => !chosen.has(usernameKey(username)));
  if (picks.length === 0 && !query.hasNextPage) return null;
  return (
    <div className="mt-3">
      <p className="mb-1 text-sm font-medium">Friends</p>
      <div className="flex flex-wrap gap-2">
        {picks.map(({ id, username }) => (
          <Button
            key={id}
            size="sm"
            variant="outline"
            className="h-auto whitespace-normal wrap-anywhere"
            onClick={() => {
              onPick(username);
            }}
          >
            {username}
          </Button>
        ))}
      </div>
      <LoadMore query={query} />
    </div>
  );
}

function Person({
  name,
  unavailable,
  onRemove,
}: {
  name: string;
  unavailable: boolean;
  onRemove: () => void;
}) {
  return (
    <li className="bg-secondary flex max-w-full items-center gap-1 rounded-md py-0.5 pr-0.5 pl-2 text-sm">
      <span className="min-w-0 wrap-anywhere">
        {name}
        {unavailable && <span className="text-muted-foreground"> (not available)</span>}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 shrink-0"
        aria-label={`Remove ${name}`}
        onClick={onRemove}
      >
        <X />
      </Button>
    </li>
  );
}

function Row({ row, showsWho }: { row: CompareRow; showsWho: boolean }) {
  return (
    <li className="py-3">
      <h3 className="text-sm font-medium wrap-anywhere">
        <TextLink to="/seasons/$id" params={{ id: row.seasonId }}>
          {row.seriesTitle === row.seasonTitle ?
            row.seasonTitle
          : `${row.seriesTitle}: ${row.seasonTitle}`}
        </TextLink>
      </h3>
      {showsWho && (
        <p className="text-muted-foreground text-sm wrap-anywhere">On: {row.on.join(', ')}</p>
      )}
      <dl className="mt-1 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 text-sm sm:max-w-md">
        {row.statuses.map(({ username, status }) => (
          <div key={username} className="contents">
            <dt className="wrap-anywhere">{username}</dt>
            <dd className={status === null ? 'text-muted-foreground' : undefined}>
              {status === null ? 'Not on list' : listStatusLabels[status]}
            </dd>
          </div>
        ))}
      </dl>
    </li>
  );
}

function Comparison({ comparison }: { comparison: CompareResponse['comparison'] }) {
  if (comparison === null) return <NothingToCompare />;
  return (
    <>
      {compareGroups(comparison).map(({ id, title, rows, showsWho }) => (
        <section key={id} className="mt-6">
          <h2 className="font-medium">
            {title} ({rows.length})
          </h2>
          {rows.length === 0 ?
            <p className="text-muted-foreground mt-1 text-sm">Nothing here.</p>
          : <ul className="divide-y">
              {rows.map((row) => (
                <Row key={row.seasonId} row={row} showsWho={showsWho} />
              ))}
            </ul>
          }
        </section>
      ))}
    </>
  );
}

function NothingToCompare() {
  return <EmptyState title="Nothing to compare">It takes at least two visible lists.</EmptyState>;
}

function ComparePage() {
  const { user } = appRoute.useRouteContext();
  const [names, setNames] = useState<string[]>([user.username]);
  const [typed, setTyped] = useState('');
  const users = names.join(',');
  const result = useQuery({
    queryKey: ['compare', users],
    enabled: names.length > 0,
    placeholderData: keepPreviousData,
    queryFn: () => request(api.compare.$get({ query: { users } })),
  });

  return (
    <>
      <h1 className="mb-4 text-xl font-semibold">Compare</h1>
      <ul aria-label="People to compare" className="flex flex-wrap gap-2">
        {names.map((name) => (
          <Person
            key={usernameKey(name)}
            name={name}
            unavailable={isUnavailable(result.data?.users ?? [], name)}
            onRemove={() => {
              setNames(removeCompareName(names, name));
            }}
          />
        ))}
      </ul>
      <form
        className="mt-3 flex flex-wrap items-end gap-2 sm:max-w-md"
        onSubmit={(event) => {
          event.preventDefault();
          setNames(addCompareNames(names, typed));
          setTyped('');
        }}
      >
        <div className="flex min-w-48 flex-1 flex-col gap-1.5">
          <Label htmlFor="compare-add">Add by exact username</Label>
          <Input
            id="compare-add"
            autoComplete="off"
            value={typed}
            onChange={(event) => {
              setTyped(event.target.value);
            }}
          />
        </div>
        <Button type="submit" variant="outline">
          Add
        </Button>
      </form>
      <QuickPicks
        names={names}
        onPick={(name) => {
          setNames(addCompareNames(names, name));
        }}
      />
      {names.length === 0 ?
        <NothingToCompare />
      : result.data === undefined ?
        <QueryFallback query={result} />
      : <Comparison comparison={result.data.comparison} />}
    </>
  );
}

export const compareRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/compare',
  component: ComparePage,
});
