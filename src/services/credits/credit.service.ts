import { prisma } from '../../prisma/client';
import { env } from '../../config/env';
import { CreditBucket, ReservationStatus } from '@prisma/client';

export class InsufficientCreditsError extends Error {
  constructor(message = "Kredit balansingiz yetarli emas") {
    super(message);
    this.name = 'InsufficientCreditsError';
  }
}

export class CreditService {
  /**
   * Calculate effective units to deduct based on account tier
   * Free equivalent cost / 1.5 for paid users
   */
  static calculateUnitsToDeduct(freeEquivalentCredits: number, isPaidTier: boolean): bigint {
    const baseUnits = BigInt(Math.round(freeEquivalentCredits * env.CREDIT_INTERNAL_UNITS));
    if (!isPaidTier) {
      return baseUnits;
    }
    // paid_cost = free_cost / 1.5
    const discounted = Number(baseUnits) / env.PAID_USAGE_DISCOUNT_FACTOR;
    return BigInt(Math.round(discounted));
  }

  /**
   * Convert BigInt units to display credits (e.g. 100,000 units -> 100 credits)
   */
  static unitsToCredits(units: bigint): number {
    return Number(units) / env.CREDIT_INTERNAL_UNITS;
  }

  /**
   * Convert display credits to BigInt units
   */
  static creditsToUnits(credits: number): bigint {
    return BigInt(Math.round(credits * env.CREDIT_INTERNAL_UNITS));
  }

  /**
   * Initialize wallet for newly registered user with exactly 100 free credits
   */
  static async initializeSignupWallet(tx: any, userId: string): Promise<any> {
    const signupUnits = this.creditsToUnits(env.FREE_SIGNUP_CREDITS);

    // Check if wallet already exists
    const existing = await tx.creditWallet.findUnique({ where: { userId } });
    if (existing) {
      return existing;
    }

    const wallet = await tx.creditWallet.create({
      data: {
        userId,
        balanceUnits: signupUnits,
        freeUnits: signupUnits,
        paidUnits: BigInt(0),
        bonusUnits: BigInt(0),
        rewardUnits: BigInt(0),
        lifetimeEarnedUnits: signupUnits,
        lifetimeSpentUnits: BigInt(0),
      },
    });

    await tx.creditLedger.create({
      data: {
        walletId: wallet.id,
        amountUnits: signupUnits,
        bucket: CreditBucket.SIGNUP,
        reason: "Ro'yxatdan o'tish sovg'asi: 100 bepul kredit",
        referenceType: 'SIGNUP',
        referenceId: userId,
        balanceAfterUnits: signupUnits,
        idempotencyKey: `signup-${userId}`,
      },
    });

    return wallet;
  }

  /**
   * Get user wallet with friendly credit breakdown
   */
  static async getWallet(userId: string) {
    const wallet = await prisma.creditWallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      return null;
    }

    return {
      balanceCredits: this.unitsToCredits(wallet.balanceUnits),
      freeCredits: this.unitsToCredits(wallet.freeUnits),
      paidCredits: this.unitsToCredits(wallet.paidUnits),
      bonusCredits: this.unitsToCredits(wallet.bonusUnits),
      rewardCredits: this.unitsToCredits(wallet.rewardUnits),
      lifetimeEarnedCredits: this.unitsToCredits(wallet.lifetimeEarnedUnits),
      lifetimeSpentCredits: this.unitsToCredits(wallet.lifetimeSpentUnits),
    };
  }

  /**
   * Atomically reserve credits before starting billable operation
   */
  static async reserveCredits(
    userId: string,
    operationType: string,
    operationId: string,
    estimatedCredits: number,
    isPaidTier: boolean
  ): Promise<{ reservationId: string; reservedUnits: bigint }> {
    const unitsNeeded = this.calculateUnitsToDeduct(estimatedCredits, isPaidTier);

    return prisma.$transaction(async (tx) => {
      // Check existing reservation
      const existingRes = await tx.creditReservation.findUnique({
        where: { operationId },
      });
      if (existingRes && existingRes.status === ReservationStatus.PENDING) {
        return { reservationId: existingRes.id, reservedUnits: existingRes.amountUnits };
      }

      const wallet = await tx.creditWallet.findUnique({
        where: { userId },
      });

      if (!wallet || wallet.balanceUnits < unitsNeeded) {
        throw new InsufficientCreditsError(
          `Yetarli kredit mavjud emas. Kerak: ${estimatedCredits} kredit, Mavjud: ${wallet ? this.unitsToCredits(wallet.balanceUnits) : 0} kredit`
        );
      }

      // Deduct from available balance into reservation
      const updatedWallet = await tx.creditWallet.update({
        where: { id: wallet.id },
        data: {
          balanceUnits: { decrement: unitsNeeded },
        },
      });

      const reservation = await tx.creditReservation.create({
        data: {
          walletId: wallet.id,
          amountUnits: unitsNeeded,
          operationType,
          operationId,
          status: ReservationStatus.PENDING,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
        },
      });

      return { reservationId: reservation.id, reservedUnits: unitsNeeded };
    });
  }

  /**
   * Finalize and commit a credit reservation with real provider usage
   */
  static async commitReservation(
    reservationId: string,
    actualUnitsUsed?: bigint,
    reason = 'AI amali yakunlandi',
    metadata?: any
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const reservation = await tx.creditReservation.findUnique({
        where: { id: reservationId },
        include: { wallet: true },
      });

      if (!reservation || reservation.status !== ReservationStatus.PENDING) {
        return; // Already resolved
      }

      const usedUnits = actualUnitsUsed !== undefined && actualUnitsUsed <= reservation.amountUnits
        ? actualUnitsUsed
        : reservation.amountUnits;
      const unusedUnits = reservation.amountUnits - usedUnits;

      // If there are unused reserved units, return them to the wallet
      if (unusedUnits > BigInt(0)) {
        await tx.creditWallet.update({
          where: { id: reservation.walletId },
          data: {
            balanceUnits: { increment: unusedUnits },
            lifetimeSpentUnits: { increment: usedUnits },
          },
        });
      } else {
        await tx.creditWallet.update({
          where: { id: reservation.walletId },
          data: {
            lifetimeSpentUnits: { increment: usedUnits },
          },
        });
      }

      // Mark reservation committed
      await tx.creditReservation.update({
        where: { id: reservationId },
        data: { status: ReservationStatus.COMMITTED },
      });

      // Write immutable ledger entry
      const currentWallet = await tx.creditWallet.findUnique({
        where: { id: reservation.walletId },
      });

      await tx.creditLedger.create({
        data: {
          walletId: reservation.walletId,
          amountUnits: -usedUnits,
          bucket: CreditBucket.CONSUMPTION,
          reason,
          referenceType: reservation.operationType,
          referenceId: reservation.operationId,
          balanceAfterUnits: currentWallet?.balanceUnits || BigInt(0),
          metadata,
        },
      });
    });
  }

  /**
   * Release reserved credits if operation failed or was cancelled
   */
  static async releaseReservation(reservationId: string, reason = 'Amal bekor qilindi'): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const reservation = await tx.creditReservation.findUnique({
        where: { id: reservationId },
      });

      if (!reservation || reservation.status !== ReservationStatus.PENDING) {
        return;
      }

      // Return all reserved units back to wallet
      await tx.creditWallet.update({
        where: { id: reservation.walletId },
        data: {
          balanceUnits: { increment: reservation.amountUnits },
        },
      });

      await tx.creditReservation.update({
        where: { id: reservationId },
        data: { status: ReservationStatus.RELEASED },
      });

      const currentWallet = await tx.creditWallet.findUnique({
        where: { id: reservation.walletId },
      });

      await tx.creditLedger.create({
        data: {
          walletId: reservation.walletId,
          amountUnits: reservation.amountUnits,
          bucket: CreditBucket.REFUND,
          reason: `Rezervatsiya qaytarildi: ${reason}`,
          referenceType: reservation.operationType,
          referenceId: reservation.operationId,
          balanceAfterUnits: currentWallet?.balanceUnits || BigInt(0),
        },
      });
    });
  }

  /**
   * Grant bonus credits for high score (reward policy: score >= 8.5 -> 5 cr, >= 9.5 -> 10 cr)
   * Enforces daily limit (10 credits per day) and prevents duplicate reward per activity
   */
  static async checkAndGrantReward(
    userId: string,
    activityType: 'WRITING' | 'ESSAY' | 'SPEAKING',
    activityId: string,
    score: number
  ): Promise<{ rewarded: boolean; credits?: number; reason?: string }> {
    if (score < 8.5) {
      return { rewarded: false, reason: "Ball sovrin talabiga yetmadi (kamida 8.5 ball kerak)" };
    }

    const rewardCredits = score >= 9.5 ? 10 : 5;
    const today = new Date().toISOString().split('T')[0];

    return prisma.$transaction(async (tx) => {
      // 1. Check if already rewarded for this specific activity
      const existing = await tx.rewardGrant.findUnique({
        where: {
          userId_activityType_activityId: {
            userId,
            activityType,
            activityId,
          },
        },
      });
      if (existing) {
        return { rewarded: false, reason: "Ushbu mashq uchun mukofot allaqachon berilgan" };
      }

      // 2. Check daily rewards sum
      const dailyGrants = await tx.rewardGrant.findMany({
        where: {
          userId,
          grantedDate: today,
        },
      });
      const todayTotal = dailyGrants.reduce((sum, g) => sum + g.amountCredits, 0);
      if (todayTotal >= env.REWARD_DAILY_LIMIT) {
        return { rewarded: false, reason: `Kunlik mukofot limiti (${env.REWARD_DAILY_LIMIT} kredit) tugagan` };
      }

      const eligibleCredits = Math.min(rewardCredits, env.REWARD_DAILY_LIMIT - todayTotal);
      if (eligibleCredits <= 0) {
        return { rewarded: false, reason: "Kunlik limitga yetildi" };
      }

      const rewardUnits = this.creditsToUnits(eligibleCredits);

      // Record reward grant
      await tx.rewardGrant.create({
        data: {
          userId,
          activityType,
          activityId,
          score,
          amountCredits: eligibleCredits,
          grantedDate: today,
        },
      });

      // Update wallet
      const wallet = await tx.creditWallet.update({
        where: { userId },
        data: {
          balanceUnits: { increment: rewardUnits },
          rewardUnits: { increment: rewardUnits },
          lifetimeEarnedUnits: { increment: rewardUnits },
        },
      });

      // Add to ledger
      await tx.creditLedger.create({
        data: {
          walletId: wallet.id,
          amountUnits: rewardUnits,
          bucket: CreditBucket.REWARD,
          reason: `A'lo natija uchun mukofot: ${score} ball (${eligibleCredits} kredit)`,
          referenceType: activityType,
          referenceId: activityId,
          balanceAfterUnits: wallet.balanceUnits,
        },
      });

      // Send notification
      await tx.notification.create({
        data: {
          userId,
          title: "Sovrin kreditlari berildi!",
          message: `Tabriklaymiz! ${activityType} bo'yicha ${score} ball to'plaganingiz uchun sizga ${eligibleCredits} ta bepul bonus kredit taqdim etildi.`,
          type: 'REWARD',
          link: '/dashboard',
        },
      });

      return { rewarded: true, credits: eligibleCredits };
    });
  }

  /**
   * Fulfill package purchase credits after payment confirmation
   */
  static async fulfillPackageCredits(
    tx: any,
    userId: string,
    packageCode: string,
    orderNumber: string
  ): Promise<void> {
    const pkg = await tx.creditPackage.findUnique({
      where: { code: packageCode },
    });
    if (!pkg) {
      throw new Error(`Package ${packageCode} not found`);
    }

    const baseUnits = this.creditsToUnits(pkg.baseCredits);
    const bonusUnits = this.creditsToUnits(pkg.bonusCredits);
    const totalUnits = baseUnits + bonusUnits;

    // Determine user tier based on purchase (do not downgrade tier)
    const user = await tx.user.findUnique({ where: { id: userId } });
    let newTier = user?.tier;
    const tierPriority: Record<string, number> = { FREE: 0, PLUS: 1, PRO: 2, MAX: 3 };
    if (tierPriority[pkg.code] !== undefined && (newTier === undefined || tierPriority[pkg.code] > (tierPriority[newTier] || 0))) {
      newTier = pkg.code as any;
    }

    await tx.user.update({
      where: { id: userId },
      data: { tier: newTier },
    });

    const wallet = await tx.creditWallet.update({
      where: { userId },
      data: {
        balanceUnits: { increment: totalUnits },
        paidUnits: { increment: baseUnits },
        bonusUnits: { increment: bonusUnits },
        lifetimeEarnedUnits: { increment: totalUnits },
      },
    });

    // Ledger for base credits
    await tx.creditLedger.create({
      data: {
        walletId: wallet.id,
        amountUnits: baseUnits,
        bucket: CreditBucket.PURCHASED,
        reason: `${pkg.name} tarifi xaridi: ${pkg.baseCredits} kredit`,
        referenceType: 'PAYMENT',
        referenceId: orderNumber,
        balanceAfterUnits: wallet.balanceUnits - bonusUnits,
        idempotencyKey: `pay-base-${orderNumber}`,
      },
    });

    // Ledger for bonus credits if any
    if (bonusUnits > BigInt(0)) {
      await tx.creditLedger.create({
        data: {
          walletId: wallet.id,
          amountUnits: bonusUnits,
          bucket: CreditBucket.BONUS,
          reason: `${pkg.name} tarifi bonusi: ${pkg.bonusCredits} kredit`,
          referenceType: 'PAYMENT',
          referenceId: orderNumber,
          balanceAfterUnits: wallet.balanceUnits,
          idempotencyKey: `pay-bonus-${orderNumber}`,
        },
      });
    }

    // Send notification
    await tx.notification.create({
      data: {
        userId,
        title: "To'lov tasdiqlandi!",
        message: `${pkg.name} tarifi uchun to'lovingiz tasdiqlandi va hisobingizga ${pkg.totalCredits} ta kredit qo'shildi.`,
        type: 'PURCHASE_SUCCESS',
        link: '/dashboard',
      },
    });
  }
}
