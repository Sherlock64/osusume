import {
  catalogRequestStatuses,
  type AdminCatalogRequest,
  type CatalogProposal,
  type CatalogRequestStatus,
} from '@osusume/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { AdminPanel, AdminRow, QueueBadge, StatusFilter } from '@/components/admin';
import { Form, SubmitButton, TextareaField, TextField } from '@/components/form';
import { PageHeader } from '@/components/page-header';
import { SeasonFields, SeasonList } from '@/components/season-fields';
import { EmptyState, LoadMore, QueryFallback } from '@/components/states';
import { TagPicker } from '@/components/tag-picker';
import { TextLink } from '@/components/text-link';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { request } from '@/lib/api-request';
import { tagsQuery } from '@/lib/catalog';
import { rejectFormSchema, reviewedProposal, suggestionOutcome } from '@/lib/catalog-admin-form';
import { addSeasonFormSchema, newSeriesFormSchema } from '@/lib/catalog-request-form';
import { useForm } from '@/lib/form';
import { useCursorList } from '@/lib/pagination';
import { adminRoute } from '@/routes/app/admin';

type NewSeriesProposal = Extract<CatalogProposal, { kind: 'new_series' }>;
type AddSeasonProposal = Extract<CatalogProposal, { kind: 'add_season' }>;
/** Told of each approval or rejection, as the row leaves a pending queue straight after. */
type OnDecided = (decided: AdminCatalogRequest) => void;

/** Approves with the edited entry and accepted suggestions, then refreshes what that changed. */
function useApprove(requestId: string, onDecided: OnDecided) {
  const queryClient = useQueryClient();
  return async (proposal: CatalogProposal, acceptSuggestedTags: string[]) => {
    const decided = await request(
      api.admin['catalog-requests'][':id'].decision.$post({
        param: { id: requestId },
        json: { decision: 'approve', proposal, acceptSuggestedTags },
      }),
    );
    await queryClient.invalidateQueries();
    onDecided(decided);
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
        <label key={name} className="flex items-start gap-2 py-1 text-sm wrap-anywhere">
          <input
            type="checkbox"
            className="accent-primary mt-0.5 size-4 shrink-0"
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

function NewSeriesReview({
  requestId,
  filed,
  onDecided,
}: {
  requestId: string;
  filed: NewSeriesProposal;
  onDecided: OnDecided;
}) {
  const approve = useApprove(requestId, onDecided);
  const filedSeasons = filed.seasons ?? [];
  // A key below the filed count is that filed season.
  const [seasonKeys, setSeasonKeys] = useState(() => filedSeasons.map((_, index) => index));
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
      <SeasonList form={form} seasonKeys={seasonKeys} onChange={setSeasonKeys} filed={filedSeasons} />
      <div>
        <SubmitButton form={form}>Approve</SubmitButton>
      </div>
    </Form>
  );
}

function AddSeasonReview({
  requestId,
  filed,
  onDecided,
}: {
  requestId: string;
  filed: AddSeasonProposal;
  onDecided: OnDecided;
}) {
  const approve = useApprove(requestId, onDecided);
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

function RejectForm({ requestId, onDecided }: { requestId: string; onDecided: OnDecided }) {
  const queryClient = useQueryClient();
  const form = useForm({
    schema: rejectFormSchema,
    onSubmit: async (note) => {
      const decided = await request(
        api.admin['catalog-requests'][':id'].decision.$post({
          param: { id: requestId },
          json: { decision: 'reject', ...note },
        }),
      );
      await queryClient.invalidateQueries({ queryKey: ['admin', 'catalog-requests'] });
      await queryClient.invalidateQueries({ queryKey: ['catalog-requests'] });
      onDecided(decided);
    },
  });
  return (
    <Form form={form}>
      <h3 className="text-sm font-medium">Or reject it</h3>
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
        <ul>
          {seasons.map((season) => (
            <li key={season.ordinal}>
              Season {season.ordinal}: {season.title}
            </li>
          ))}
        </ul>
      )}
      {suggested.length > 0 && (
        <p>Suggested tags: {suggested.join(', ')}</p>
      )}
      {item.decisionNote !== null && (
        <p className="text-foreground whitespace-pre-wrap">Note: {item.decisionNote}</p>
      )}
    </>
  );
}

function RequestRow({ item, onDecided }: { item: AdminCatalogRequest; onDecided: OnDecided }) {
  const [reviewing, setReviewing] = useState(false);
  const { proposal, seriesId, seriesTitle } = item;
  const title = proposal.kind === 'new_series' ? proposal.series.title : proposal.season.title;

  return (
    <AdminRow
      title={title}
      badges={<QueueBadge state={item.status} />}
      meta={
        <>
          <p>
            {proposal.kind === 'new_series' ? 'New series' : 'New season for '}
            {proposal.kind === 'add_season' &&
              (seriesId === null ?
                (seriesTitle ?? 'a series no longer in the catalog')
              : <TextLink to="/admin/catalog/$id" params={{ id: seriesId }}>
                  {seriesTitle ?? 'this series'}
                </TextLink>)}
            {` · from ${item.requesterUsername ?? 'a removed user'} on ${new Date(item.createdAt).toLocaleDateString()}`}
          </p>
          {!reviewing && <FiledDetails item={item} />}
        </>
      }
      actions={
        item.status === 'pending' ?
          <Button
            variant={reviewing ? 'outline' : 'default'}
            size="sm"
            aria-expanded={reviewing}
            onClick={() => {
              setReviewing((open) => !open);
            }}
          >
            {reviewing ? 'Close' : 'Review'}
          </Button>
        : item.status === 'approved' &&
          proposal.kind === 'new_series' &&
          seriesId !== null && (
            <TextLink to="/admin/catalog/$id" params={{ id: seriesId }}>
              Manage this series and add images
            </TextLink>
          )
      }
    >
      {item.status === 'pending' && reviewing && (
        <AdminPanel aside={<RejectForm requestId={item.id} onDecided={onDecided} />}>
          <h3 className="mb-4 text-sm font-medium">Approve it, as edited here</h3>
          {proposal.kind === 'new_series' ?
            <NewSeriesReview requestId={item.id} filed={proposal} onDecided={onDecided} />
          : <AddSeasonReview requestId={item.id} filed={proposal} onDecided={onDecided} />}
        </AdminPanel>
      )}
    </AdminRow>
  );
}

function Decided({ item }: { item: AdminCatalogRequest }) {
  const { proposal, seriesId } = item;
  const title = proposal.kind === 'new_series' ? proposal.series.title : proposal.season.title;
  return (
    <Alert role="status" className="my-4">
      <AlertDescription className="wrap-anywhere">
        <p>{`${item.status === 'approved' ? 'Approved' : 'Rejected'} ${title}.`}</p>
        {item.status === 'approved' && proposal.kind === 'new_series' && seriesId !== null && (
          <TextLink to="/admin/catalog/$id" params={{ id: seriesId }}>
            Manage this series and add images
          </TextLink>
        )}
      </AlertDescription>
    </Alert>
  );
}

function AdminRequestsPage() {
  const [status, setStatus] = useState<CatalogRequestStatus | ''>('pending');
  const [decided, setDecided] = useState<AdminCatalogRequest | null>(null);
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
      <PageHeader
        eyebrow="Admin"
        title="Catalog requests"
        description="New series and seasons members have asked for. Fix anything that needs it, then approve."
      />
      <StatusFilter value={status} statuses={catalogRequestStatuses} onChange={setStatus} />
      {decided !== null && <Decided item={decided} />}
      {query.data === undefined ?
        <QueryFallback query={query} />
      : items.length === 0 ?
        <EmptyState title={status === 'pending' ? 'No requests are waiting' : 'No requests here'} />
      : <ul className="divide-y border-b">
          {items.map((item) => (
            <RequestRow key={item.id} item={item} onDecided={setDecided} />
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
