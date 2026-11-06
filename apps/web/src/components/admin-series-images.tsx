import type { SeriesImage } from '@osusume/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { ActionButton } from '@/components/admin';
import { ConfirmButton } from '@/components/confirm-button';
import { CoverImage } from '@/components/cover-image';
import { QueryFallback } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { ApiError, request, toApiError } from '@/lib/api-request';
import { imageUploadProblem } from '@/lib/catalog-admin-form';
import { fetchAllPages } from '@/lib/pagination';

/** The whole of a series' image catalog, for managing it and for choosing a season's cover. */
export function useSeriesImages(seriesId: string) {
  return useQuery({
    queryKey: ['admin', 'series-images', seriesId],
    queryFn: () =>
      fetchAllPages((cursor) =>
        request(
          api.series[':id'].images.$get({
            param: { id: seriesId },
            query: cursor === undefined ? {} : { cursor },
          }),
        ),
      ),
  });
}

function UploadImage({ seriesId }: { seriesId: string }) {
  const queryClient = useQueryClient();
  const inputId = useId();
  // Clearing the input lets the same file be chosen again after a failure.
  const [inputKey, setInputKey] = useState(0);
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const problem = imageUploadProblem(file);
      if (problem !== null) throw new ApiError(400, 'invalid_image', problem);
      await request(api.series[':id'].images.$post({ param: { id: seriesId }, form: { file } }));
      await queryClient.invalidateQueries();
    },
    onSettled: () => {
      setInputKey((key) => key + 1);
    },
  });
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={inputId}>Upload an image</Label>
      <Input
        key={inputKey}
        id={inputId}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        disabled={upload.isPending}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file !== undefined) upload.mutate(file);
        }}
      />
      <p className="text-muted-foreground text-sm">
        {upload.isPending ? 'Uploading…' : 'JPEG, PNG or WebP, up to 10 MB.'}
      </p>
      {upload.isError && (
        <p role="alert" className="text-destructive text-sm">
          {toApiError(upload.error).message}
        </p>
      )}
    </div>
  );
}

function ImageCard({ seriesId, image }: { seriesId: string; image: SeriesImage }) {
  const queryClient = useQueryClient();
  const param = { id: seriesId, imageId: image.id };
  return (
    <li className="flex min-w-0 flex-col gap-2">
      <CoverImage cover={image} size="medium" alt="" />
      <div className="flex flex-wrap gap-2">
        {image.isPrimary ?
          <Badge variant="secondary">Primary</Badge>
        : <ActionButton
            label="Set primary"
            onAction={async () => {
              await request(api.series[':id'].images[':imageId'].primary.$post({ param }));
              await queryClient.invalidateQueries();
            }}
          />
        }
        <ConfirmButton
          label="Remove"
          title="Remove this image?"
          description="The image and its files are deleted. Seasons using it fall back to the series primary. If it is the primary, the earliest added image that remains takes over."
          onConfirm={async () => {
            await request(api.series[':id'].images[':imageId'].$delete({ param }));
            await queryClient.invalidateQueries();
          }}
        />
      </div>
    </li>
  );
}

export function SeriesImages({ seriesId }: { seriesId: string }) {
  const images = useSeriesImages(seriesId);
  return (
    <div className="flex flex-col gap-4">
      <UploadImage seriesId={seriesId} />
      {images.data === undefined ?
        <QueryFallback query={images} />
      : images.data.length === 0 ?
        <p className="text-muted-foreground text-sm">No images yet. A placeholder shows until one is added.</p>
      : <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {images.data.map((image) => (
            <ImageCard key={image.id} seriesId={seriesId} image={image} />
          ))}
        </ul>
      }
    </div>
  );
}
