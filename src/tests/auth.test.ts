import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AuthService } from '../services/auth/auth.service';
import { prisma } from '../prisma/client';
import { hashOtp, verifyOtpHash, generateRandomOtp } from '../utils/crypto';
import { CreditService } from '../services/credits/credit.service';

describe('Authentication & Single Session System', () => {
  const testEmail = `test_${Date.now()}@example.com`;
  const testUsername = `user_${Date.now()}`;
  let rawOtp = '';

  afterAll(async () => {
    // Cleanup
    await prisma.user.deleteMany({
      where: { email: { contains: 'example.com' } },
    });
  });

  it('generates a 6-digit random OTP and verifies keyed HMAC hash', () => {
    const otp = generateRandomOtp(6);
    expect(otp).toHaveLength(6);
    expect(/^\d{6}$/.test(otp)).toBe(true);

    const hash = hashOtp(otp);
    expect(verifyOtpHash(otp, hash)).toBe(true);
    expect(verifyOtpHash('000000', hash)).toBe(false);
  });

  it('validates username rules and uniqueness', async () => {
    const valid = await AuthService.validateUsername('valid_user_1');
    expect(valid.valid).toBe(true);

    const tooShort = await AuthService.validateUsername('ab');
    expect(tooShort.valid).toBe(false);

    const invalidChars = await AuthService.validateUsername('invalid-user!');
    expect(invalidChars.valid).toBe(false);
  });

  it('sends registration OTP and enforces 15-minute rate limit and 60s cooldown', async () => {
    const result1 = await AuthService.sendRegistrationOtp(testEmail);
    expect(result1.success).toBe(true);

    // Immediate second attempt should hit 60s cooldown
    const result2 = await AuthService.sendRegistrationOtp(testEmail);
    expect(result2.success).toBe(false);
    expect(result2.error).toContain('soniya kuting');
  });

  it('verifies OTP successfully with correct code and rejects wrong code', async () => {
    // Retrieve OTP from DB for testing
    const verification = await prisma.emailVerification.findFirst({
      where: { email: testEmail, isUsed: false },
      orderBy: { createdAt: 'desc' },
    });
    expect(verification).toBeDefined();

    // Wrong code attempt
    const wrong = await AuthService.verifyRegistrationOtp(testEmail, '999999');
    expect(wrong.success).toBe(false);
    expect(wrong.error).toContain('Noto‘g‘ri kod');

    // Manually mark verified for registration test
    await prisma.emailVerification.update({
      where: { id: verification!.id },
      data: { isUsed: true },
    });
  });

  it('enforces password rules: >=6 chars, >=1 uppercase, >=1 number', async () => {
    await expect(
      AuthService.completeRegistration({
        firstName: 'Ali',
        lastName: 'Valiyev',
        username: testUsername,
        email: testEmail,
        password: 'weak',
        otp: '123456',
      })
    ).rejects.toThrow('Parol kamida 6 ta belgidan iborat bo‘lishi kerak');

    await expect(
      AuthService.completeRegistration({
        firstName: 'Ali',
        lastName: 'Valiyev',
        username: testUsername,
        email: testEmail,
        password: 'nouppercase123',
        otp: '123456',
      })
    ).rejects.toThrow('kamida 1 ta katta harf');

    await expect(
      AuthService.completeRegistration({
        firstName: 'Ali',
        lastName: 'Valiyev',
        username: testUsername,
        email: testEmail,
        password: 'NoNumbersHere!',
        otp: '123456',
      })
    ).rejects.toThrow('kamida 1 ta raqam');
  });

  it('completes registration atomically, grants exactly 100 free credits, and creates session', async () => {
    const registered = await AuthService.completeRegistration({
      firstName: 'Temur',
      lastName: 'Malik',
      username: testUsername,
      email: testEmail,
      password: 'StrongPassword2026!',
      otp: '123456',
    });

    expect(registered.user).toBeDefined();
    expect(registered.user.email).toBe(testEmail);
    expect(registered.sessionToken).toBeDefined();

    // Verify exactly 100 credits granted
    const wallet = await CreditService.getWallet(registered.user.id);
    expect(wallet?.balanceCredits).toBe(100);
    expect(wallet?.freeCredits).toBe(100);
    expect(wallet?.paidCredits).toBe(0);

    // Verify welcome notification
    const notifications = await prisma.notification.findMany({
      where: { userId: registered.user.id },
    });
    expect(notifications.some((n) => n.type === 'WELCOME')).toBe(true);
  });

  it('enforces SINGLE ACTIVE SESSION: 2nd login revokes 1st session', async () => {
    // 1st login
    const login1 = await AuthService.login(testUsername, 'StrongPassword2026!');
    expect(login1.sessionToken).toBeDefined();

    // Check active session count
    let activeSessions = await prisma.userSession.findMany({
      where: { userId: login1.user.id, isActive: true },
    });
    expect(activeSessions).toHaveLength(1);

    // 2nd login from another device
    const login2 = await AuthService.login(testUsername, 'StrongPassword2026!');
    expect(login2.sessionToken).toBeDefined();
    expect(login2.priorSessionRevoked).toBe(true);

    // Only 1 session must be active now
    activeSessions = await prisma.userSession.findMany({
      where: { userId: login1.user.id, isActive: true },
    });
    expect(activeSessions).toHaveLength(1);

    // Check that the 1st session token is revoked in DB
    const firstSessionRecord = await prisma.userSession.findFirst({
      where: { userId: login1.user.id, isActive: false },
    });
    expect(firstSessionRecord?.revokedAt).not.toBeNull();
  });
});
