import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { CreditService, InsufficientCreditsError } from '../services/credits/credit.service';
import { prisma } from '../prisma/client';

describe('Credit Engine & Wallet Accounting', () => {
  let userId = '';

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email: `credittest_${Date.now()}@example.com`,
        username: `credittest_${Date.now()}`,
        passwordHash: 'dummy',
        firstName: 'Credit',
        lastName: 'Tester',
      },
    });
    userId = user.id;
    await CreditService.initializeSignupWallet(prisma, userId);
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
  });

  it('calculates paid usage discount accurately: paid_cost = free_cost / 1.5', () => {
    // 15 credits: Free user pays 15,000 units (15 cr)
    const freeUnits = CreditService.calculateUnitsToDeduct(15, false);
    expect(freeUnits).toBe(BigInt(15000));

    // Paid user pays 15,000 / 1.5 = 10,000 units (10 cr)
    const paidUnits = CreditService.calculateUnitsToDeduct(15, true);
    expect(paidUnits).toBe(BigInt(10000));

    // 20 credits: Free user pays 20,000 units
    const free20 = CreditService.calculateUnitsToDeduct(20, false);
    expect(free20).toBe(BigInt(20000));

    // Paid user pays 20,000 / 1.5 = 13,333 units
    const paid20 = CreditService.calculateUnitsToDeduct(20, true);
    expect(paid20).toBe(BigInt(13333));
  });

  it('verifies wallet balance inquiry', async () => {
    const wallet = await CreditService.getWallet(userId);
    expect(wallet?.balanceCredits).toBe(100);
    expect(wallet?.freeCredits).toBe(100);
  });

  it('atomically reserves credits and commits them to immutable ledger', async () => {
    const opId = `op-test-${Date.now()}`;
    const reservation = await CreditService.reserveCredits(userId, 'WRITING', opId, 15, false);

    expect(reservation.reservationId).toBeDefined();
    expect(reservation.reservedUnits).toBe(BigInt(15000));

    // Balance should be reduced during reservation
    let wallet = await CreditService.getWallet(userId);
    expect(wallet?.balanceCredits).toBe(85);

    // Commit reservation
    await CreditService.commitReservation(reservation.reservationId, reservation.reservedUnits, 'Yozish tekshiruvi');

    // Balance should remain 85 and lifetime spent should be recorded
    wallet = await CreditService.getWallet(userId);
    expect(wallet?.balanceCredits).toBe(85);
    expect(wallet?.lifetimeSpentCredits).toBe(15);
  });

  it('releases reserved credits back to wallet on failure', async () => {
    const opId = `op-fail-${Date.now()}`;
    const reservation = await CreditService.reserveCredits(userId, 'ESSAY', opId, 20, false);

    let wallet = await CreditService.getWallet(userId);
    expect(wallet?.balanceCredits).toBe(65);

    // Release reservation
    await CreditService.releaseReservation(reservation.reservationId, 'Test failure release');

    // Balance restored back to 85
    wallet = await CreditService.getWallet(userId);
    expect(wallet?.balanceCredits).toBe(85);
  });

  it('throws InsufficientCreditsError when attempting to spend more than available', async () => {
    const opId = `op-insufficient-${Date.now()}`;
    await expect(
      CreditService.reserveCredits(userId, 'SPEAKING', opId, 500, false)
    ).rejects.toThrow(InsufficientCreditsError);
  });

  it('grants rewards correctly for high scores and enforces daily limit', async () => {
    // Score < 8.5 -> No reward
    const low = await CreditService.checkAndGrantReward(userId, 'WRITING', 'act-1', 7.5);
    expect(low.rewarded).toBe(false);

    // Score 8.5 -> 5 credits
    const mid = await CreditService.checkAndGrantReward(userId, 'WRITING', 'act-2', 8.8);
    expect(mid.rewarded).toBe(true);
    expect(mid.credits).toBe(5);

    // Duplicate reward for same activity should be blocked
    const dup = await CreditService.checkAndGrantReward(userId, 'WRITING', 'act-2', 9.0);
    expect(dup.rewarded).toBe(false);

    // Second reward: score 9.5 -> eligible for 10, but daily limit is 10, 5 already granted -> receives remaining 5
    const high = await CreditService.checkAndGrantReward(userId, 'ESSAY', 'act-3', 9.8);
    expect(high.rewarded).toBe(true);
    expect(high.credits).toBe(5); // Remaining to reach 10 daily cap

    // Third reward on same day -> Daily cap reached
    const over = await CreditService.checkAndGrantReward(userId, 'SPEAKING', 'act-4', 9.9);
    expect(over.rewarded).toBe(false);
    expect(over.reason).toContain('Kunlik');
  });
});
