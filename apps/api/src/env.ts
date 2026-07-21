import { z } from 'zod';

const schema = z.object({
  API_PORT: z.coerce.number().int().positive().default(4000),
  API_HOST: z.string().default('0.0.0.0'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  ADMIN_API_TOKEN: z.string().min(8),
});

export const env = schema.parse(process.env);
