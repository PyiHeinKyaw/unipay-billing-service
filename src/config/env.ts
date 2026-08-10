import 'dotenv/config';

import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8001),
  HOST: z.string().min(1).default('0.0.0.0'),
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid URL'),
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  CORS_ORIGIN: z.string().default('*'),
});

export const env = envSchema.parse(process.env);

export type Env = z.infer<typeof envSchema>;
