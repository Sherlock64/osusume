import type { AdminCatalogRequest, CatalogProposal, CatalogRequestStatus } from '@osusume/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { StatusFilter } from '@/components/admin';
import { Form, SubmitButton, TextareaField, TextField } from '@/components/form';
import { SeasonFields } from '@/components/season-fields';
import { EmptyState, LoadMore, QueryFallback } from '@/components/states';
import { TagPicker } from '@/components/tag-picker';
import { TextLink } from '@/components/text-link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { request } from '@/lib/api-request';
import { tagsQuery } from '@/lib/catalog';
import { rejectFormSchema, reviewedProposal, suggestionOutcome } from '@/lib/catalog-admin-form';
import { addSeasonFormSchema, newSeriesFormSchema } from '@/lib/catalog-request-form';
import { useForm } from '@/lib/form';
import { useCursorList } from '@/lib/pagination';
import { adminRoute } from '@/routes/app/admin';

const statusLabels: Record<CatalogRequestStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
};

type NewSeriesProposal = Extract<CatalogProposal, { kind: 'new_series' }>;
type AddSeasonProposal = Extract<CatalogProposal, { kind: 'add_season' }>;

/** Approves with the edited entry and accepted suggestions, then refreshes what that changed. */
function useApprove(requestId: string) {
  const queryClient = useQueryClient();
  return async (proposal: CatalogProposal, acceptSuggestedTags: string[]) => {
    await request(
      api.admin['catalog-requests'][':id'].decision.$post({
        param: { id: requestId },
        json: { decision: 'approve', proposal, acceptSuggestedTags },
      }),
    );
    await queryClient.invalidateQueries();
  };
}

function SuggestedTags({
  suggested,
  accepted,
  attachesTo,
  onChange,
}: {
  suggested: readonly string[];
  accepted: readonly string[];
  attachesTo: string;
  onChange: (next: string[]) => void;
}) {
  const tags = useQuery(tagsQuery);
  if (suggested.length === 0) return null;
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="text-sm font-medium">Suggested tags</legend>
      <p className="text-muted-foreground text-sm">Accepted tags attach to {attachesTo}.</p>
      {suggested.map((name) => (
        <label key={name} className="flex items-start gap-2 text-sm wrap-anywhere">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={accepted.includes(name)}
            onChange={(event) => {
              onChange(
                event.target.checked ? [...accepted, name] : accepted.filter((other) => other !== name),
              );
            }}
          />
          <span>
            {name}
            {tags.data !== undefined && (
              <span className="text-muted-foreground"> ({suggestionOutcome(name, tags.data)})</span>
            )}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function NewSeriesReview({ requestId, filed }: { requestId: string; filed: NewSeriesProposal }) {
  const approve = useApprove(requestId);
  const filedSeasons = filed.seasons ?? [];
  // Stable keys, so that removing a season keeps what was typed in the others. A key below the
  // filed count is that filed season.
  const [seasonKeys, setSeasonKeys] = useState(() => filedSeasons.map((_, index) => index));
  const [nextKey, setNextKey] = useState(filedSeasons.length);
  const [tagIds, setTagIds] = useState(filed.series.tagIds ?? []);
  const [accepted, setAccepted] = useState<string[]>([]);
  const form = useForm({
    schema: newSeriesFormSchema,
    onSubmit: (edited) =>
      approve(
        reviewedProposal(
          filed,
          edited,
          tagIds,
          seasonKeys.map((key) => filedSeasons[key]?.tagIds),
        ),
        accepted,
      ),
  });

  return (
    <Form form={form}>
      <input type="hidden" name="suggestedTags" value="" />
      <TextField form={form} name="title" label="Series title" defaultValue={filed.series.title} />
      <TextareaField
        form={form}
        name="altTitles"
        label="Alternate titles (optional)"
        hint="One per line."
        defaultValue={filed.series.altTitles?.join('\n')}
      />
      <TextareaField
        form={form}
        name="synopsis"
        label="Synopsis (optional)"
        defaultValue={filed.series.synopsis ?? undefined}
      />
      <SuggestedTags
        suggested={filed.suggestedTags ?? []}
        accepted={accepted}
        attachesTo="the new series"
        onChange={setAccepted}
      />
      <TagPicker label="Add tags by hand" selected={tagIds} onChange={setTagIds} />
      {seasonKeys.map((key, index) => (
        <fieldset key={key} className="flex min-w-0 flex-col gap-4 rounded-md border p-3">
          <legend className="px-1 text-sm font-medium">Season</legend>
          <SeasonFields form={form} prefix={`seasons.${String(index)}.`} defaults={filedSeasons[key]} />
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setSeasonKeys((keys) => keys.filter((other) => other !== key));
              }}
            >
              Remove this season
            </Button>
          </div>
        </fieldset>
      ))}
      <div>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setSeasonKeys((keys) => [...keys, nextKey]);
            setNextKey(nextKey + 1);
          }}
        >
          Add a season
        </Button>
      </div>
      <div>
        <SubmitButton form={form}>Approve</SubmitButton>
      </div>
    </Form>
  );
}

function AddSeasonReview({ requestId, filed }: { requestId: string; filed: AddSeasonProposal }) {
  const approve = useApprove(requestId);
  const [tagIds, setTagIds] = useState(filed.season.tagIds ?? []);
  const [accepted, setAccepted] = useState<string[]>([]);
  const form = useForm({
    // The series stays as filed: an add-season request can't be moved to another one.
    schema: addSeasonFormSchema(filed.seriesId),
    fieldForCode: { ordinal_taken: 'ordinal' },
    onSubmit: (edited) => approve(reviewedProposal(filed, edited, tagIds), accepted),
  });

  return (
    <Form form={form}>
      <input type="hidden" name="suggestedTags" value="" />
      <SeasonFields form={form} defaults={filed.season} />
      <SuggestedTags
        suggested={filed.suggestedTags ?? []}
        accepted={accepted}
        attachesTo="this season only"
        onChange={setAccepted}
      />
      <TagPicker
        label="Add tags by hand"
        hint="These attach to this season only."
        selected={tagIds}
        onChange={setTagIds}
      />
      <div>
        <SubmitButton form={form}>Approve</SubmitButton>
      </div>
    </Form>
  );
}

function RejectForm({ requestId }: { requestId: string }) {
  const queryClient = useQueryClient();
  const form = useForm({
    schema: rejectFormSchema,
    onSubmit: async (note) => {
      await request(
        api.admin['catalog-requests'][':id'].decision.$post({
          param: { id: requestId },
          json: { decision: 'reject', ...note },
        }),
      );
      await queryClient.invalidateQueries({ queryKey: ['admin', 'catalog-requests'] });
      await queryClient.invalidateQueries({ queryKey: ['catalog-requests'] });
    },
  });
  return (
    <Form form={form}>
      <TextareaField form={form} name="decisionNote" label="Note to the requester (optional)" />
      <div>
        <SubmitButton form={form} variant="destructive">
          Reject
        </SubmitButton>
      </div>
    </Form>
  );
}

function FiledDetails({ item }: { item: AdminCatalogRequest }) {
  const { proposal } = item;
  const suggested = proposal.suggestedTags ?? [];
  const seasons = proposal.kind === 'add_season' ? [proposal.season] : (proposal.seasons ?? []);
  return (
    <>
      {seasons.length > 0 && (
        <ul className="text-muted-foreground text-sm wrap-anywhere">
          {seasons.map((season) => (
            <li key={season.ordinal}>
              Season {season.ordinal}: {season.title}
            </li>
          ))}
        </ul>
      )}
      {suggested.length > 0 && (
        <p className="text-muted-foreground text-sm wrap-anywhere">Suggested tags: {suggested.join(', ')}</p>
      )}
      {item.decisionNote !== null && (
        <p className="text-sm wrap-anywhere whitespace-pre-wrap">Note: {item.decisionNote}</p>
      )}
    </>
  );
}

function RequestRow({ item }: { item: AdminCatalogRequest }) {
  const [reviewing, setReviewing] = useState(false);
  const { proposal, seriesId, seriesTitle } = item;
  const title = proposal.kind === 'new_series' ? proposal.series.title : proposal.season.title;

  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h2 className="min-w-0 font-medium wrap-anywhere">{title}</h2>
        <Badge variant={item.status === 'rejected' ? 'destructive' : 'secondary'}>
          {statusLabels[item.status]}
        </Badge>
      </div>
      <p className="text-muted-foreground text-sm wrap-anywhere">
        {proposal.kind === 'new_series' ? 'New series' : 'New season for '}
        {proposal.kind === 'add_season' &&
          (seriesId === null ?
            (seriesTitle ?? 'a series no longer in the catalog')
          : <TextLink to="/admin/catalog/$id" params={{ id: seriesId }}>
              {seriesTitle ?? 'this series'}
            </TextLink>)}
        {` · from ${item.requesterUsername ?? 'a removed user'} on ${new Date(item.createdAt).toLocaleDateString()}`}
      </p>
      <FiledDetails item={item} />
      {item.status === 'approved' && proposal.kind === 'new_series' && seriesId !== null && (
        <p className="text-sm">
          <TextLink to="/admin/catalog/$id" params={{ id: seriesId }}>
            Manage this series and add images
          </TextLink>
        </p>
      )}
      {item.status === 'pending' && (
        <div>
          <Button
            variant="outline"
            size="sm"
            aria-expanded={reviewing}
            onClick={() => {
              setReviewing((open) => !open);
            }}
          >
            {reviewing ? 'Close' : 'Review'}
          </Button>
        </div>
      )}
      {item.status === 'pending' && reviewing && (
        <div className="flex flex-col gap-6 rounded-md border p-3">
          {proposal.kind === 'new_series' ?
            <NewSeriesReview requestId={item.id} filed={proposal} />
          : <AddSeasonReview requestId={item.id} filed={proposal} />}
          <div className="border-t pt-4">
            <RejectForm requestId={item.id} />
          </div>
        </div>
      )}
    </li>
  );
}

function AdminRequestsPage() {
  const [status, setStatus] = useState<CatalogRequestStatus | ''>('pending');
  const { query, items } = useCursorList({
    queryKey: ['admin', 'catalog-requests', status],
    fetchPage: (cursor) =>
      request(
        api.admin['catalog-requests'].$get({
          query: {
            ...(status === '' ? {} : { status }),
            ...(cursor === undefined ? {} : { cursor }),
          },
        }),
      ),
  });

  return (
    <>
      <h1 className="mb-4 text-xl font-semibold">Catalog requests</h1>
      <StatusFilter value={status} labels={statusLabels} onChange={setStatus} />
      {query.data === undefined ?
        <QueryFallback query={query} />
      : items.length === 0 ?
        <EmptyState title="No requests here" />
      : <ul className="divide-y">
          {items.map((item) => (
            <RequestRow key={item.id} item={item} />
          ))}
        </ul>
      }
      <LoadMore query={query} />
    </>
  );
}

export const adminRequestsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'requests',
  component: AdminRequestsPage,
});
