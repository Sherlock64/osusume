import { z } from 'zod';

/** Treats `VAR=` in an env file the same as the variable being unset. */
function emptyAsUnset(value: unknown): unknown {
  return value === '' ? undefined : value;
}

const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ }).describe('a postgres:// URL');

const databaseEnvSchema = z.object({
  DATABASE_URL: z.preprocess(emptyAsUnset, postgresUrl),
});

const envSchema = databaseEnvSchema
  .extend({
    NODE_ENV: z.preprocess(
      emptyAsUnset,
      z.enum(['development', 'test', 'production']).default('development'),
    ),
    HOST: z.preprocess(emptyAsUnset, z.string().default('0.0.0.0')),
    PORT: z.preprocess(emptyAsUnset, z.coerce.number().int().min(1).max(65535).default(3000)),
    PUBLIC_BASE_URL: z.preprocess(
      emptyAsUnset,
      z.url({ protocol: /^https?$/ }).transform((url) => url.replace(/\/+$/, '')),
    ),
    IMAGE_STORAGE_PATH: z.preprocess(emptyAsUnset, z.string().min(1)),
    SMTP_HOST: z.preprocess(emptyAsUnset, z.string().min(1)),
    SMTP_PORT: z.preprocess(emptyAsUnset, z.coerce.number().int().min(1).max(65535)),
    SMTP_SECURE: z.preprocess(emptyAsUnset, z.stringbool().default(false)),
    SMTP_USER: z.preprocess(emptyAsUnset, z.string().optional()),
    SMTP_PASSWORD: z.preprocess(emptyAsUnset, z.string().optional()),
    SMTP_FROM: z.preprocess(emptyAsUnset, z.string().min(1)),
  })
  .superRefine((env, ctx) => {
    if ((env.SMTP_USER === undefined) !== (env.SMTP_PASSWORD === undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: [env.SMTP_USER === undefined ? 'SMTP_USER' : 'SMTP_PASSWORD'],
        message: 'SMTP_USER and SMTP_PASSWORD must be set together',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;
export type DatabaseEnv = z.infer<typeof databaseEnvSchema>;

export class EnvValidationError extends Error {
  override name = 'EnvValidationError';
}

function parse<Schema extends z.ZodType>(schema: Schema, source: NodeJS.ProcessEnv): z.infer<Schema> {
  const result = schema.safeParse(source);
  if (result.success) return result.data;

  // Names and rules only: a rejected value may hold a credential.
  const lines = result.error.issues.map((issue) => {
    const name = issue.path.join('.');
    const missing = source[name] === undefined || source[name] === '';
    return `  ${name}: ${missing && issue.code !== 'custom' ? 'is required' : issue.message}`;
  });
  throw new EnvValidationError(`Invalid environment configuration:\n${lines.join('\n')}`);
}

/** Validates the full api configuration. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return parse(envSchema, source);
}

/** Validates only what the migrate entry point needs. */
export function loadDatabaseEnv(source: NodeJS.ProcessEnv = process.env): DatabaseEnv {
  return parse(databaseEnvSchema, source);
}
