import { usernameKey, type CompareResponse, type CompareRow } from '@osusume/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { createRoute, Link } from '@tanstack/react-router';
import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { CoverImage } from '@/components/cover-image';
import { PageHeader, SectionHeading } from '@/components/page-header';
import { EmptyState, LoadMore, QueryFallback } from '@/components/states';
import { StatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { request } from '@/lib/api-request';
import {
  addCompareNames,
  compareGroups,
  isUnavailable,
  removeCompareName,
  type CompareGroup,
} from '@/lib/compare';
import { useCursorList } from '@/lib/pagination';
import { cn } from '@/lib/utils';
import { appRoute } from '@/routes/app';

const groupNotes: Record<CompareGroup['id'], string> = {
  onAll: 'Everyone has these.',
  onSome: 'More than one of you, but not everyone.',
  onOne: 'Only one of you has these.',
};

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
      <p className="mb-1.5 text-sm font-medium">Friends</p>
      <div className="flex flex-wrap gap-2">
        {picks.map(({ id, username }) => (
          <Button
            key={id}
            variant="outline"
            className="h-auto min-h-11 whitespace-normal wrap-anywhere md:min-h-9"
            onClick={() => {
              onPick(username);
            }}
          >
            <Plus />
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
    <li
      className={cn(
        'flex max-w-full items-center gap-1 rounded-md border pl-3 text-sm',
        unavailable ? 'border-dashed' : 'bg-secondary border-transparent',
      )}
    >
      <span className="min-w-0 py-1 font-medium wrap-anywhere">
        {name}
        {unavailable && <span className="text-muted-foreground font-normal"> (not available)</span>}
      </span>
      <Button variant="ghost" size="icon" aria-label={`Remove ${name}`} onClick={onRemove}>
        <X />
      </Button>
    </li>
  );
}

function Row({ row, showsWho }: { row: CompareRow; showsWho: boolean }) {
  const missing = row.statuses.filter(({ status }) => status === null);
  return (
    <tr className="group/row block py-3 md:table-row md:py-0">
      <th
        scope="row"
        className="bg-background relative block text-left font-normal md:sticky md:left-0 md:z-10 md:table-cell md:py-2 md:pr-4"
      >
        <div className="flex items-center gap-3">
          <CoverImage cover={row.cover} size="small" alt="" title={row.seriesTitle} className="w-14 shrink-0 md:w-11" />
          <div className="min-w-0">
            <Link
              to="/seasons/$id"
              params={{ id: row.seasonId }}
              className="text-foreground text-sm font-medium wrap-anywhere group-hover/row:underline after:absolute after:inset-0 md:text-base"
            >
              {row.seasonTitle}
            </Link>
            {row.seriesTitle !== row.seasonTitle && (
              <p className="text-muted-foreground text-xs wrap-anywhere">{row.seriesTitle}</p>
            )}
          </div>
        </div>
      </th>
      {row.statuses.map(({ username, status }) => (
        <td
          key={username}
          className={cn(
            'mt-2 items-center justify-between gap-3 text-sm md:mt-0 md:table-cell md:py-2 md:pr-4',
            status === null ? 'hidden' : 'flex',
          )}
        >
          <span className="min-w-0 wrap-anywhere md:hidden">{username}</span>
          {status === null ?
            <span className="text-muted-foreground text-xs">Not on list</span>
          : <StatusBadge status={status} />}
        </td>
      ))}
      {showsWho && missing.length > 0 && (
        // The table's own "Not on list" cells are hidden on phones; this one line stands in for them.
        <td className="text-muted-foreground mt-2 block text-xs wrap-anywhere md:hidden">
          Not on list: {missing.map(({ username }) => username).join(', ')}
        </td>
      )}
    </tr>
  );
}

function Group({ group }: { group: CompareGroup }) {
  const { id, title, rows, showsWho } = group;
  return (
    <section id={id} className="mt-8 scroll-mt-32">
      <SectionHeading actions={<Badge variant="secondary">{rows.length}</Badge>}>
        {title}
      </SectionHeading>
      <p className="text-muted-foreground -mt-2 mb-3 text-sm">{groupNotes[id]}</p>
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="block w-full border-collapse md:table">
            <thead className="hidden md:table-header-group">
              <tr className="border-b">
                <th scope="col" className="bg-background sticky left-0 z-10 min-w-64 pb-2 text-left">
                  <span className="eyebrow">Season</span>
                </th>
                {rows[0]?.statuses.map(({ username }) => (
                  <th
                    key={username}
                    scope="col"
                    className="w-40 max-w-40 min-w-32 pr-4 pb-2 text-left align-bottom text-sm font-medium wrap-anywhere"
                  >
                    {username}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="block divide-y md:table-row-group">
              {rows.map((row) => (
                <Row key={row.seasonId} row={row} showsWho={showsWho} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Comparison({ result }: { result: CompareResponse }) {
  const available = result.users.filter((person) => person.available).length;
  // With two lists, "at least two but not all" can't happen.
  const groups = compareGroups(result.comparison).filter(
    ({ id }) => id !== 'onSome' || available > 2,
  );
  if (groups.length === 0) return <NothingToCompare />;
  return (
    <>
      <nav
        aria-label="Jump to a group"
        className="bg-background sticky top-14 z-20 -mx-4 mt-6 flex gap-1 border-b px-4 py-2 sm:-mx-6 sm:px-6"
      >
        {groups.map(({ id, title, rows }) => (
          <a
            key={id}
            href={`#${id}`}
            className="hover:bg-accent flex min-h-11 flex-1 flex-col justify-center rounded-md px-2 py-1 md:flex-none md:px-3"
          >
            <span className="font-heading text-xl leading-none font-medium">{rows.length}</span>
            <span className="text-muted-foreground mt-0.5 text-xs">{title}</span>
          </a>
        ))}
      </nav>
      {groups.map((group) => (
        <Group key={group.id} group={group} />
      ))}
    </>
  );
}

function NothingToCompare() {
  return (
    <EmptyState title="Nothing to compare yet">
      Add someone above. It takes at least two lists you're allowed to see.
    </EmptyState>
  );
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
      <PageHeader
        title="Compare"
        description="See what your lists share, and where each of you stands on every season."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <p className="eyebrow mb-2">Comparing</p>
          {names.length === 0 ?
            <p className="text-muted-foreground text-sm">Nobody yet.</p>
          : <ul aria-label="People to compare" className="flex flex-wrap gap-2">
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
          }
        </div>
        <div>
          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setNames(addCompareNames(names, typed));
              setTyped('');
            }}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
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
        </div>
      </div>
      {names.length === 0 ?
        <NothingToCompare />
      : result.data === undefined ?
        <QueryFallback query={result} />
      : <div aria-busy={result.isPlaceholderData} className={cn(result.isPlaceholderData && 'opacity-60')}>
          <Comparison result={result.data} />
        </div>
      }
    </>
  );
}

export const compareRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/compare',
  component: ComparePage,
});
