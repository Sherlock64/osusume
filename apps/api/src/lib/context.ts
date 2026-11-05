import type { Auth } from '../auth/auth.ts';
import type { Database } from '../db/client.ts';
import type { Mailer } from './mailer.ts';

export interface AppDependencies {
  /** Resolves when the database answers a query; rejects otherwise. */
  checkDatabase: () => Promise<void>;
  db: Database;
  auth: Auth;
  mailer: Mailer;
  /** Base URL users reach the site at, with no trailing slash. */
  publicBaseUrl: string;
}

/** What every route can read from its context. */
export interface AppEnv {
  Variables: { deps: AppDependencies };
}
