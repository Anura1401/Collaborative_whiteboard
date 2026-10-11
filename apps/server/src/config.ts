import { z } from 'zod';

const ConfigSchema = z.object({
  DATABASE_URL: z.string().default(process.env.DATABASE_URL || 'postgres://localhost:5432/whiteboard'),
  ALLOW_IN_MEMORY_DB: z.coerce.boolean().default(false),
  PORT: z.coerce.number().int().positive().default(8080),
  TICKET_SECRET: z.string().min(16).default('secret-ticket-signing-key-minimum-32-bytes-long!'),
  ALLOWED_ORIGINS: z.string().default('http://localhost:5173,http://127.0.0.1:5173,http://localhost:8080'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  SNAPSHOT_EVERY: z.coerce.number().int().positive().default(500),
  RING_BUFFER_SIZE: z.coerce.number().int().positive().default(1000),
  ROOM_IDLE_EVICT_MS: z.coerce.number().int().positive().default(300000),
  MAX_CLIENTS_PER_ROOM: z.coerce.number().int().positive().default(50),
  WS_MAX_PAYLOAD_BYTES: z.coerce.number().int().positive().default(65536),
  OP_RATE_PER_SEC: z.coerce.number().int().positive().default(30),
  EPHEMERAL_RATE_PER_SEC: z.coerce.number().int().positive().default(30),
});

export type ServerConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  try {
    process.loadEnvFile?.('.env');
  } catch {
    try {
      process.loadEnvFile?.('../../.env');
    } catch {
      // Ignore if .env is missing
    }
  }

  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    console.error('Invalid environment variables:', parsed.error.format());
    process.exit(1);
  }
  return parsed.data;
}

export const config = loadConfig();
