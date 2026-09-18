import dotenv from 'dotenv';

dotenv.config();

const REQUIRED_KEYS = [
  'DATABASE_URL',
  'JWT_SECRET',
  'FRONTEND_URL',
  'FITSMS_API_TOKEN',
  'FITSMS_SENDER_ID',
  'DEVELOPER_USERNAME',
  'DEVELOPER_PASSWORD',
  'PLATFORM_JWT_SECRET'
] as const;

export function assertEnv(): void {
  const missing = REQUIRED_KEYS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

assertEnv();

export const env = {
  DATABASE_URL: process.env.DATABASE_URL!,
  JWT_SECRET: process.env.JWT_SECRET!,
  FRONTEND_URL: process.env.FRONTEND_URL!,
  FITSMS_API_TOKEN: process.env.FITSMS_API_TOKEN!,
  FITSMS_SENDER_ID: process.env.FITSMS_SENDER_ID!,
  DEVELOPER_USERNAME: process.env.DEVELOPER_USERNAME!,
  DEVELOPER_PASSWORD: process.env.DEVELOPER_PASSWORD!,
  // Deliberately separate from JWT_SECRET, not asked for explicitly but
  // added as a second independent barrier between tenant and platform-admin
  // sessions — see requirePlatformAdmin.ts / requireAuth.ts notes.
  PLATFORM_JWT_SECRET: process.env.PLATFORM_JWT_SECRET!,
  PORT: process.env.PORT ?? '4000',
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  IS_PRODUCTION: process.env.NODE_ENV === 'production',
} as const;
