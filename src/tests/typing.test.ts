import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../prisma/client';
import { TypingService } from '../services/typing/typing.service';

describe('Typing Trainer System (100% Free & Unlimited)', () => {
  let testUserId: string;

  beforeAll(async () => {
    // Create test user with 0 credits to verify 0-credit free policy
    const user = await prisma.user.create({
      data: {
        username: `typing_user_${Date.now()}`,
        email: `typing_${Date.now()}@example.com`,
        passwordHash: 'hashed_password',
        firstName: 'Typing',
        lastName: 'Tester',
        role: 'USER',
        tier: 'FREE',
      },
    });
    testUserId = user.id;

    // Create wallet with 0 credits
    await prisma.creditWallet.create({
      data: {
        userId: testUserId,
        balanceUnits: BigInt(0),
        freeUnits: BigInt(0),
        paidUnits: BigInt(0),
      },
    });
  });

  afterAll(async () => {
    if (testUserId) {
      await prisma.user.delete({ where: { id: testUserId } });
    }
  });

  it('generates reference text for TIME, WORDS, and SENTENCES modes in English and Uzbek', () => {
    const timeText = TypingService.generateReferenceText('TIME', 'EN', 'INTERMEDIATE', undefined, 30);
    expect(timeText.split(' ').length).toBeGreaterThanOrEqual(25);

    const wordsText = TypingService.generateReferenceText('WORDS', 'EN', 'BEGINNER', 10);
    expect(wordsText.split(' ').length).toBe(10);

    const sentencesText = TypingService.generateReferenceText('SENTENCES', 'EN', 'INTERMEDIATE', 2);
    expect(sentencesText.length).toBeGreaterThan(20);

    const uzbekWords = TypingService.generateReferenceText('WORDS', 'UZ', 'INTERMEDIATE', 10);
    expect(uzbekWords.split(' ').length).toBe(10);
  });

  it('creates typing test with 0 credit deduction for user with 0 credits', async () => {
    const test = await TypingService.createTest({
      userId: testUserId,
      mode: 'WORDS',
      language: 'EN',
      difficulty: 'INTERMEDIATE',
      targetWords: 10,
    });

    expect(test.id).toBeDefined();
    expect(test.status).toBe('PENDING');

    // Confirm wallet balance is still 0
    const wallet = await prisma.creditWallet.findUnique({ where: { userId: testUserId } });
    expect(wallet?.balanceUnits).toBe(BigInt(0));
  });

  it('computes WPM, CPM, accuracy, mistakes, and personal rating deterministically', async () => {
    const test = await TypingService.createTest({
      userId: testUserId,
      mode: 'TIME',
      language: 'EN',
      difficulty: 'INTERMEDIATE',
      targetSeconds: 30,
    });

    // Student typed 150 correct characters and 5 errors in 30 seconds (30,000 ms)
    const outcome = await TypingService.completeTest({
      testId: test.id,
      userId: testUserId,
      durationMs: 30000,
      correctCharacters: 150,
      incorrectCharacters: 5,
      correctedErrors: 2,
      uncorrectedErrors: 3,
      samples: [
        { elapsedMs: 10000, wpm: 55, rawWpm: 58 },
        { elapsedMs: 20000, wpm: 60, rawWpm: 62 },
        { elapsedMs: 30000, wpm: 60, rawWpm: 62 },
      ],
    });

    // 150 chars / 5 = 30 words in 0.5 minutes = 60 WPM
    expect(outcome.wpm).toBe(60);
    expect(outcome.cpm).toBe(300);
    expect(outcome.accuracy).toBeGreaterThan(95);
    expect(['Good', 'Very Good', 'Excellent', 'Expert']).toContain(outcome.personalRating);

    // Verify credits remain 0! (Free policy)
    const wallet = await prisma.creditWallet.findUnique({ where: { userId: testUserId } });
    expect(wallet?.balanceUnits).toBe(BigInt(0));
  });

  it('safely handles zero-duration or division-by-zero attempts without crash', async () => {
    const test = await TypingService.createTest({
      userId: testUserId,
      mode: 'WORDS',
      targetWords: 10,
    });

    const outcome = await TypingService.completeTest({
      testId: test.id,
      userId: testUserId,
      durationMs: 0, // 0 duration
      correctCharacters: 0,
      incorrectCharacters: 0,
    });

    expect(outcome.wpm).toBe(0);
    expect(outcome.accuracy).toBe(100);
    expect(outcome.personalRating).toBe('Beginner');
  });

  it('persists user stats, increments completed tests, and tracks personal bests', async () => {
    const stats = await TypingService.getUserStats(testUserId);
    expect(stats.completedTests).toBeGreaterThanOrEqual(2);
    expect(stats.bestWpm).toBeGreaterThan(0);

    const history = await TypingService.getUserHistory(testUserId);
    expect(history.length).toBeGreaterThanOrEqual(2);
  });
});
