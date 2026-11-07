import type { AppType } from '@osusume/api/app-type';
import { hc } from 'hono/client';

export const api = hc<AppType>(window.location.origin).api.v1;
