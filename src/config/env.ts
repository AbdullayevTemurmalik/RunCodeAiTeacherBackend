import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

// Load .env
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(5000),
  APP_NAME: z.string().default('RunCodeAITeacher'),
  FRONTEND_URL: z.string().default('http://localhost:5173'),
  ADMIN_URL: z.string().default('http://localhost:5174'),
  BACKEND_URL: z.string().default('http://localhost:5000'),
  CORS_ALLOWED_ORIGINS: z.string().default('http://localhost:5173,http://localhost:5174'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DB_NAME: z.string().default('RuncodeAiTeacher'),
  DB_USER: z.string().default('postgres'),
  DB_PASSWORD: z.string().default('password'),
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().default(5432),

  EMAIL_PROVIDER: z.string().default('brevo'),
  BREVO_API_KEY: z.string().default(''),
  BREVO_SENDER_EMAIL: z.string().default('tmaq77@gmail.com'),
  BREVO_SENDER_NAME: z.string().default('RunCodeAITeacher'),
  ENABLE_DEV_EMAIL_SIMULATION: z.preprocess((val) => val === 'true' || val === true, z.boolean()).default(true),

  GEMINIAPIKEY: z.string().optional(),
  GEMINI_API_KEY_PRIMARY: z.string().default(''),
  GEMINI_API_KEY_SECONDARY: z.string().default(''),
  GEMINI_LIVE_MODEL: z.string().default('gemini-2.5-flash'),
  GEMINI_TEXT_MODEL: z.string().default('gemini-3.8-flash'),
  GEMINI_TTS_MODEL: z.string().default('gemini-3.8-flash-lite-tts'),
  GEMINI_TRANSCRIPTION_MODEL: z.string().default('gemini-3.5-transcribe'),

  OTP_LENGTH: z.coerce.number().default(6),
  OTP_EXPIRY_MINUTES: z.coerce.number().default(5),
  OTP_MAX_SENDS_PER_15_MINUTES: z.coerce.number().default(3),
  OTP_MAX_ATTEMPTS: z.coerce.number().default(5),
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().default(60),

  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET must be at least 16 chars').default('development_session_secret_runcode_2026'),
  OTP_HMAC_SECRET: z.string().min(16, 'OTP_HMAC_SECRET must be at least 16 chars').default('development_otp_hmac_secret_runcode_2026'),
  SESSION_MAX_AGE_HOURS: z.coerce.number().default(24),
  SINGLE_ACTIVE_SESSION: z.preprocess((val) => val === 'true' || val === true, z.boolean()).default(true),
  BCRYPT_COST_FACTOR: z.coerce.number().default(12),

  FREE_SIGNUP_CREDITS: z.coerce.number().default(100),
  CREDIT_INTERNAL_UNITS: z.coerce.number().default(1000),
  PAID_USAGE_DISCOUNT_FACTOR: z.coerce.number().default(1.5),
  REWARD_DAILY_LIMIT: z.coerce.number().default(10),

  PLUS_BASE_CREDITS: z.coerce.number().default(200),
  PLUS_BONUS_CREDITS: z.coerce.number().default(20),
  PLUS_PRICE_UZS: z.coerce.number().default(15000),

  PRO_BASE_CREDITS: z.coerce.number().default(500),
  PRO_BONUS_CREDITS: z.coerce.number().default(50),
  PRO_PRICE_UZS: z.coerce.number().default(30000),

  MAX_BASE_CREDITS: z.coerce.number().default(1000),
  MAX_BONUS_CREDITS: z.coerce.number().default(100),
  MAX_PRICE_UZS: z.coerce.number().default(50000),

  PAYMENT_MODE: z.string().default('manual'),
  MANUAL_PAYMENT_WINDOW_MINUTES: z.coerce.number().default(30),
  PAYMENT_REVIEW_ESTIMATE_MIN_HOURS: z.coerce.number().default(1),
  PAYMENT_REVIEW_ESTIMATE_MAX_HOURS: z.coerce.number().default(2),

  CLICK_PAYMENT_ENABLED: z.preprocess((val) => val === 'true' || val === true, z.boolean()).default(true),
  CLICK_PAYMENT_QR_ASSET: z.string().default('/assets/payments/click_qr.png'),
  CLICK_PAYMENT_URL: z.string().default('https://my.click.uz/clickp2p/9E9EB6EE67E40DB610877D03FC6AB8BD136BDBF5F386F48C91E40184E1EB9EE7'),

  UZUM_PAYMENT_ENABLED: z.preprocess((val) => val === 'true' || val === true, z.boolean()).default(true),
  UZUM_PAYMENT_QR_ASSET: z.string().default('/assets/payments/uzum_qr.png'),
  UZUM_PAYMENT_URL: z.string().default('https://b.2u.uz/ttc?qr=Nzk5MzoyMDU4NjEzMjowMU00VDA0VlgyNjVYQU1IR1k5SjdNV1ZEODp1OVhXZWtrenRJNmNadm5oZVhXQ1NhOWJOdFk9'),

  PAYMENT_RECEIPT_MAX_SIZE_MB: z.coerce.number().default(10),
  RECEIPT_STORAGE_PROVIDER: z.string().default('local'),
  RECEIPT_PRIVATE_DIRECTORY: z.string().default('./private/receipts'),

  PAYMENT_EXPIRY_JOB_ENABLED: z.preprocess((val) => val === 'true' || val === true, z.boolean()).default(true),
  AUTH_RATE_LIMIT_ENABLED: z.preprocess((val) => val === 'true' || val === true, z.boolean()).default(true),
  AUDIT_LOG_ENABLED: z.preprocess((val) => val === 'true' || val === true, z.boolean()).default(true),
  LOG_LEVEL: z.string().default('info'),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Environment validation error:', parsed.error.format());
  throw new Error('Invalid environment configuration');
}

export const env = parsed.data;

// Parse GEMINIAPIKEY into primary and secondary if provided
if (env.GEMINIAPIKEY) {
  const keys = env.GEMINIAPIKEY.split(',').map((k) => k.trim()).filter(Boolean);
  if (keys[0] && !env.GEMINI_API_KEY_PRIMARY) env.GEMINI_API_KEY_PRIMARY = keys[0];
  if (keys[1] && !env.GEMINI_API_KEY_SECONDARY) env.GEMINI_API_KEY_SECONDARY = keys[1];
}
