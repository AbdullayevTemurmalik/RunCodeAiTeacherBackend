import { prisma } from '../../prisma/client';
import { env } from '../../config/env';
import {
  hashOtp,
  verifyOtpHash,
  generateRandomOtp,
  generateSessionToken,
  hashSessionToken,
  hashPassword,
  comparePassword,
} from '../../utils/crypto';
import { BrevoEmailService } from '../email/brevo.service';
import { CreditService } from '../credits/credit.service';
import { Role, Tier, UserStatus } from '@prisma/client';
import crypto from 'crypto';

export interface RegisterStep1Input {
  firstName: string;
  lastName: string;
  age?: number;
  username: string;
}

export interface CompleteRegistrationInput extends RegisterStep1Input {
  email: string;
  password: string;
  otp: string;
}

export class AuthService {
  /**
   * Validate username format and uniqueness (case-insensitive)
   */
  static async validateUsername(username: string): Promise<{ valid: boolean; error?: string }> {
    const trimmed = username.trim().toLowerCase();
    if (trimmed.length < 3 || trimmed.length > 30) {
      return { valid: false, error: 'Username 3 dan 30 tagacha belgidan iborat bo‘lishi kerak' };
    }
    if (!/^[a-z0-9_]+$/.test(trimmed)) {
      return { valid: false, error: 'Username faqat lotin harflari, raqamlar va pastki chiziqdan iborat bo‘lishi mumkin' };
    }

    const existing = await prisma.user.findFirst({
      where: {
        username: { equals: trimmed, mode: 'insensitive' },
      },
    });

    if (existing) {
      return { valid: false, error: 'Ushbu username allaqachon band qilingan' };
    }

    return { valid: true };
  }

  /**
   * Step 2: Send 6-digit OTP to email
   */
  static async sendRegistrationOtp(email: string): Promise<{ success: boolean; cooldownSeconds?: number; error?: string }> {
    const normalizedEmail = email.trim().toLowerCase();

    // Check if email already registered
    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (existingUser) {
      return { success: false, error: 'Ushbu email bilan ro‘yxatdan o‘tilgan' };
    }

    // Rate-limiting check: max 3 sends per 15 minutes rolling window
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    const recentVerifications = await prisma.emailVerification.findMany({
      where: {
        email: normalizedEmail,
        createdAt: { gte: fifteenMinutesAgo },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (recentVerifications.length >= env.OTP_MAX_SENDS_PER_15_MINUTES) {
      return {
        success: false,
        error: `15 daqiqa ichida maksimal ${env.OTP_MAX_SENDS_PER_15_MINUTES} marta kod yuborish mumkin. Birozdan so‘ng qayta urinib ko‘ring.`,
      };
    }

    // Check resend cooldown (60 seconds)
    if (recentVerifications.length > 0) {
      const lastSent = recentVerifications[0].createdAt;
      const elapsedSeconds = Math.floor((Date.now() - lastSent.getTime()) / 1000);
      if (elapsedSeconds < env.OTP_RESEND_COOLDOWN_SECONDS) {
        return {
          success: false,
          cooldownSeconds: env.OTP_RESEND_COOLDOWN_SECONDS - elapsedSeconds,
          error: `Iltimos, yangi kod so‘rashdan oldin ${env.OTP_RESEND_COOLDOWN_SECONDS - elapsedSeconds} soniya kuting.`,
        };
      }
    }

    // Invalidate previous active OTPs for this email
    await prisma.emailVerification.updateMany({
      where: { email: normalizedEmail, isUsed: false },
      data: { isUsed: true },
    });

    const otp = generateRandomOtp(env.OTP_LENGTH);
    const hashedOtp = hashOtp(otp);
    const expiresAt = new Date(Date.now() + env.OTP_EXPIRY_MINUTES * 60 * 1000);

    await prisma.emailVerification.create({
      data: {
        email: normalizedEmail,
        hashedOtp,
        expiresAt,
        resendCount: recentVerifications.length + 1,
      },
    });

    const emailResult = await BrevoEmailService.sendOtpEmail(normalizedEmail, otp, 'registration');
    if (!emailResult.success) {
      return { success: false, error: emailResult.error || 'Email yuborishda xatolik yuz berdi' };
    }

    return { success: true };
  }

  /**
   * Verify registration OTP
   */
  static async verifyRegistrationOtp(email: string, otp: string): Promise<{ success: boolean; error?: string }> {
    const normalizedEmail = email.trim().toLowerCase();

    const verification = await prisma.emailVerification.findFirst({
      where: {
        email: normalizedEmail,
        isUsed: false,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!verification) {
      return { success: false, error: 'Tasdiqlash kodi topilmadi yoki eskirgan. Qaytadan kod so‘rang.' };
    }

    if (verification.expiresAt < new Date()) {
      await prisma.emailVerification.update({
        where: { id: verification.id },
        data: { isUsed: true },
      });
      return { success: false, error: 'Kodning amal qilish muddati tugagan (5 daqiqa).' };
    }

    if (verification.attempts >= env.OTP_MAX_ATTEMPTS) {
      await prisma.emailVerification.update({
        where: { id: verification.id },
        data: { isUsed: true },
      });
      return { success: false, error: 'Noto‘g‘ri urinishlar soni oshib ketdi. Yangi kod so‘rang.' };
    }

    const isValid = verifyOtpHash(otp.trim(), verification.hashedOtp);
    if (!isValid) {
      await prisma.emailVerification.update({
        where: { id: verification.id },
        data: { attempts: { increment: 1 } },
      });
      const remaining = env.OTP_MAX_ATTEMPTS - (verification.attempts + 1);
      return { success: false, error: `Noto‘g‘ri kod kiritildi. Qolgan urinishlar: ${remaining}` };
    }

    // Mark as used
    await prisma.emailVerification.update({
      where: { id: verification.id },
      data: { isUsed: true },
    });

    return { success: true };
  }

  /**
   * Step 3 & 4: Complete registration, create user, wallet & grant 100 free credits
   */
  static async completeRegistration(
    input: CompleteRegistrationInput,
    ipAddress?: string,
    userAgent?: string
  ): Promise<{ user: any; sessionToken: string }> {
    const normalizedEmail = input.email.trim().toLowerCase();
    const normalizedUsername = input.username.trim().toLowerCase();

    // Verify password requirements
    if (input.password.length < 6) {
      throw new Error('Parol kamida 6 ta belgidan iborat bo‘lishi kerak');
    }
    if (!/[A-Z]/.test(input.password)) {
      throw new Error('Parolda kamida 1 ta katta harf bo‘lishi kerak');
    }
    if (!/[0-9]/.test(input.password)) {
      throw new Error('Parolda kamida 1 ta raqam bo‘lishi kerak');
    }

    // Hash password
    const passwordHash = await hashPassword(input.password);

    // Atomically create user, wallet and signup ledger entry
    return prisma.$transaction(async (tx) => {
      // Check existing email
      const existingEmail = await tx.user.findUnique({
        where: { email: normalizedEmail },
      });
      if (existingEmail) {
        throw new Error('Ushbu email bilan allaqachon ro‘yxatdan o‘tilgan');
      }

      // Check existing username
      const existingUser = await tx.user.findFirst({
        where: { username: { equals: normalizedUsername, mode: 'insensitive' } },
      });
      if (existingUser) {
        throw new Error('Ushbu username allaqachon band qilingan');
      }

      const user = await tx.user.create({
        data: {
          email: normalizedEmail,
          username: normalizedUsername,
          firstName: input.firstName.trim(),
          lastName: input.lastName.trim(),
          age: input.age,
          passwordHash,
          role: Role.USER,
          tier: Tier.FREE,
          status: UserStatus.ACTIVE,
          language: 'uz',
          theme: 'dark',
        },
      });

      // Grant exactly 100 FREE credits
      await CreditService.initializeSignupWallet(tx, user.id);

      // Welcome Notification
      await tx.notification.create({
        data: {
          userId: user.id,
          title: "Xush kelibsiz!",
          message: "Sizga 100 ta bepul kredit berildi! Speaking, Writing va Essay bo‘limlarida foydalanishingiz mumkin.",
          type: 'WELCOME',
          link: '/dashboard',
        },
      });

      // Create session
      const { rawToken, tokenHash } = generateSessionToken();
      const expiresAt = new Date(Date.now() + env.SESSION_MAX_AGE_HOURS * 60 * 60 * 1000);

      await tx.userSession.create({
        data: {
          userId: user.id,
          tokenHash,
          ipAddress,
          userAgent,
          isActive: true,
          expiresAt,
        },
      });

      return {
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          tier: user.tier,
          language: user.language,
          theme: user.theme,
        },
        sessionToken: rawToken,
      };
    });
  }

  /**
   * User login with SINGLE-ACTIVE-SESSION enforcement
   */
  static async login(
    identifier: string,
    password: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<{ user: any; sessionToken: string; priorSessionRevoked: boolean }> {
    const trimmed = identifier.trim().toLowerCase();

    // Find user by email or username
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: trimmed },
          { username: { equals: trimmed, mode: 'insensitive' } },
        ],
      },
    });

    if (!user || user.status === UserStatus.DELETED) {
      throw new Error('Login yoki parol noto‘g‘ri');
    }

    if (user.status === UserStatus.SUSPENDED) {
      throw new Error('Hisobingiz ma’muriyat tomonidan vaqtincha muzlatilgan');
    }

    const isMatch = await comparePassword(password, user.passwordHash);
    if (!isMatch) {
      throw new Error('Login yoki parol noto‘g‘ri');
    }

    let priorSessionRevoked = false;

    // Single active session enforcement:
    // Revoke any previous active session atomically
    if (env.SINGLE_ACTIVE_SESSION) {
      const activeSessions = await prisma.userSession.findMany({
        where: { userId: user.id, isActive: true },
      });

      if (activeSessions.length > 0) {
        priorSessionRevoked = true;
        await prisma.userSession.updateMany({
          where: { userId: user.id, isActive: true },
          data: {
            isActive: false,
            revokedAt: new Date(),
          },
        });
      }
    }

    // Create new session
    const { rawToken, tokenHash } = generateSessionToken();
    const expiresAt = new Date(Date.now() + env.SESSION_MAX_AGE_HOURS * 60 * 60 * 1000);

    await prisma.userSession.create({
      data: {
        userId: user.id,
        tokenHash,
        ipAddress,
        userAgent,
        isActive: true,
        expiresAt,
      },
    });

    const wallet = await CreditService.getWallet(user.id);

    return {
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        age: user.age,
        role: user.role,
        tier: user.tier,
        language: user.language,
        theme: user.theme,
        wallet,
      },
      sessionToken: rawToken,
      priorSessionRevoked,
    };
  }

  /**
   * User logout: Revoke session token
   */
  static async logout(rawToken: string): Promise<void> {
    const tokenHash = hashSessionToken(rawToken);
    await prisma.userSession.updateMany({
      where: { tokenHash, isActive: true },
      data: {
        isActive: false,
        revokedAt: new Date(),
      },
    });
  }

  /**
   * Forgot password Step 1 & 2: Send recovery OTP
   */
  static async sendPasswordRecoveryOtp(email: string): Promise<{ success: boolean; error?: string }> {
    const normalizedEmail = email.trim().toLowerCase();

    // Privacy-safe: If user doesn't exist, we don't leak account existence, but internally return
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      // Safe generic response
      return { success: true };
    }

    // Invalidate prior resets
    await prisma.passwordReset.updateMany({
      where: { email: normalizedEmail, isUsed: false },
      data: { isUsed: true },
    });

    const otp = generateRandomOtp(env.OTP_LENGTH);
    const hashedOtp = hashOtp(otp);
    const expiresAt = new Date(Date.now() + env.OTP_EXPIRY_MINUTES * 60 * 1000);

    await prisma.passwordReset.create({
      data: {
        email: normalizedEmail,
        hashedOtp,
        expiresAt,
      },
    });

    await BrevoEmailService.sendOtpEmail(normalizedEmail, otp, 'recovery');
    return { success: true };
  }

  /**
   * Forgot password Step 3: Verify OTP and return username for confirmation
   */
  static async verifyPasswordRecoveryOtp(email: string, otp: string): Promise<{ success: boolean; username?: string; resetToken?: string; error?: string }> {
    const normalizedEmail = email.trim().toLowerCase();

    const record = await prisma.passwordReset.findFirst({
      where: {
        email: normalizedEmail,
        isUsed: false,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!record || record.expiresAt < new Date()) {
      return { success: false, error: 'Tiklash kodi eskirgan yoki topilmadi. Qaytadan so‘rang.' };
    }

    if (record.attempts >= env.OTP_MAX_ATTEMPTS) {
      return { success: false, error: 'Maksimal noto‘g‘ri urinishlar sonidan oshib ketdi.' };
    }

    const isValid = verifyOtpHash(otp.trim(), record.hashedOtp);
    if (!isValid) {
      await prisma.passwordReset.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      return { success: false, error: 'Noto‘g‘ri kod kiritildi' };
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');

    await prisma.passwordReset.update({
      where: { id: record.id },
      data: {
        isVerified: true,
        resetTokenHash,
      },
    });

    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

    return {
      success: true,
      username: user?.username || 'user',
      resetToken,
    };
  }

  /**
   * Forgot password Step 4 & 5: Set new password and revoke old sessions
   */
  static async resetPassword(resetToken: string, newPassword: string): Promise<{ success: boolean; error?: string }> {
    if (newPassword.length < 6 || !/[A-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      return { success: false, error: 'Parol kamida 6 ta belgi, 1 ta katta harf va 1 ta raqamdan iborat bo‘lishi kerak' };
    }

    const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
    const resetRecord = await prisma.passwordReset.findUnique({
      where: { resetTokenHash },
    });

    if (!resetRecord || !resetRecord.isVerified || resetRecord.isUsed || resetRecord.expiresAt < new Date()) {
      return { success: false, error: 'Tiklash havolasi yaroqsiz yoki muddati tugagan' };
    }

    const passwordHash = await hashPassword(newPassword);

    await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { email: resetRecord.email } });
      if (!user) throw new Error('Foydalanuvchi topilmadi');

      // Update password
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash },
      });

      // Mark reset token used
      await tx.passwordReset.update({
        where: { id: resetRecord.id },
        data: { isUsed: true },
      });

      // Revoke all existing sessions for security
      await tx.userSession.updateMany({
        where: { userId: user.id, isActive: true },
        data: { isActive: false, revokedAt: new Date() },
      });

      // Notify user of security event
      await tx.notification.create({
        data: {
          userId: user.id,
          title: "Parol muvaffaqiyatli o'zgartirildi",
          message: "Hisobingiz paroli muvaffaqiyatli yangilandi. Xavfsizlik maqsadida barcha faol sessiyalar yakunlandi.",
          type: 'SECURITY_SESSION',
        },
      });
    });

    return { success: true };
  }
}
