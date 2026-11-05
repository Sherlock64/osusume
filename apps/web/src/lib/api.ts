import type { AppType } from '@osusume/api/app-type';
import { createApiClient } from '@osusume/shared/client';

export const api = createApiClient<AppType>(window.location.origin).api.v1;
