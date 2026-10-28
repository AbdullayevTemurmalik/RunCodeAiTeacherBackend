import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { env } from '../config/env';

/**
 * Hash 6-digit OTP using HMAC-SHA256 with server secret
 */
export function hashOtp(otp: string): string {
  return crypto.createHmac('sha256', env.OTP_HMAC_SECRET).update(otp).digest('hex');
}

/**
 * Verify OTP against stored HMAC hash
 */
export function verifyOtpHash(otp: string, storedHash: string): boolean {
  const calculatedHash = hashOtp(otp);
  return crypto.timingSafeEqual(Buffer.from(calculatedHash), Buffer.from(storedHash));
}

/**
 * Generate a cryptographically secure random 6-digit OTP
 */
export function generateRandomOtp(length = 6): string {
  const min = Math.pow(10, length - 1);
  const max = Math.pow(10, length) - 1;
  return crypto.randomInt(min, max + 1).toString();
}

/**
 * Generate secure session token and its SHA-256 hash for DB storage
 */
export function generateSessionToken(): { rawToken: string; tokenHash: string } {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  return { rawToken, tokenHash };
}

/**
 * Hash a session token for DB lookup
 */
export function hashSessionToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

/**
 * Hash password with bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, env.BCRYPT_COST_FACTOR);
}

/**
 * Compare password with bcrypt hash
 */
export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
