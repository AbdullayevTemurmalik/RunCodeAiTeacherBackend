import { prisma } from '../../prisma/client';

export interface CreateTypingTestParams {
  userId: string;
  mode: 'TIME' | 'WORDS' | 'SENTENCES' | 'CHALLENGE';
  language?: 'EN' | 'UZ';
  difficulty?: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
  targetWords?: number;
  targetSeconds?: number;
}

export interface CompleteTypingTestParams {
  testId: string;
  userId: string;
  durationMs: number;
  correctCharacters: number;
  incorrectCharacters: number;
  correctedErrors?: number;
  uncorrectedErrors?: number;
  samples?: Array<{ elapsedMs: number; wpm: number; rawWpm: number }>;
}

export class TypingService {
  // English Word Banks by difficulty
  private static readonly EN_BEGINNER_WORDS = [
    'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'I',
    'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at',
    'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she',
    'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what',
    'so', 'up', 'out', 'if', 'about', 'who', 'get', 'which', 'go', 'me',
    'when', 'make', 'can', 'like', 'time', 'no', 'just', 'him', 'know', 'take',
    'people', 'into', 'year', 'your', 'good', 'some', 'could', 'them', 'see', 'other',
    'than', 'then', 'now', 'look', 'only', 'come', 'its', 'over', 'think', 'also'
  ];

  private static readonly EN_INTERMEDIATE_WORDS = [
    'develop', 'progress', 'computer', 'science', 'language', 'learning', 'improve',
    'practice', 'journey', 'knowledge', 'student', 'teacher', 'education', 'future',
    'success', 'project', 'system', 'program', 'engineer', 'design', 'creative',
    'solution', 'digital', 'network', 'connection', 'challenge', 'opportunity',
    'effective', 'efficient', 'communication', 'resource', 'strategy', 'community',
    'inspire', 'motivate', 'confidence', 'explore', 'discover', 'understanding'
  ];

  private static readonly EN_ADVANCED_WORDS = [
    'sophisticated', 'extraordinary', 'implementation', 'architecture', 'comprehensive',
    'characteristic', 'distinguished', 'transformation', 'infrastructure', 'collaboration',
    'phenomenon', 'philosophical', 'sustainability', 'unprecedented', 'entrepreneurial',
    'counterbalance', 'synchronization', 'interconnected', 'meticulously', 'perseverance'
  ];

  // English Sentences by difficulty
  private static readonly EN_SENTENCES = [
    'Practice makes progress every single day.',
    'English is an international bridge that connects cultures around the world.',
    'Technology continues to transform the way we learn, communicate, and grow.',
    'Learning a new skill requires steady patience, dedication, and active practice.',
    'Clear writing and fluent speaking unlock boundless career opportunities.',
    'The quick brown fox jumps over the lazy dog.',
    'Consistent daily effort leads to extraordinary long-term achievements.',
    'Education is the most powerful weapon which you can use to change the world.'
  ];

  // Uzbek Latin Word Banks & Sentences
  private static readonly UZ_WORDS = [
    'bilim', 'kitob', 'maktab', 'talaba', 'dastur', 'kelajak', 'muvaffaqiyat',
    'rivojlanish', 'orzu', 'mehnat', 'do‘stlik', 'quyosh', 'hayot', 'tizim',
    'o‘qish', 'yozish', 'gapirish', 'o‘rganish', 'tarix', 'inson', 'samarali',
    'kuchli', 'yangi', 'dunyo', 'yutuq', 'texnologiya', 'loyiha', 'madaniyat'
  ];

  private static readonly UZ_SENTENCES = [
    'Ilm olish igna bilan quduq qazishdek sabr-toqat talab etadi.',
    'Har kuni o‘rganilgan yangi bilim kelajak muvaffaqiyatining mustahkam poydevoridir.',
    'Ingliz tilini mukammal o‘rganish global imkoniyatlar eshigini ochadi.',
    'Mehnat qilgan elda aziz, o‘qigan inson jahonda aziz bo‘ladi.'
  ];

  /**
   * Generate curated reference text based on mode, language and difficulty
   */
  static generateReferenceText(
    mode: 'TIME' | 'WORDS' | 'SENTENCES' | 'CHALLENGE',
    language: 'EN' | 'UZ' = 'EN',
    difficulty: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED' = 'INTERMEDIATE',
    targetWords?: number,
    targetSeconds?: number
  ): string {
    const isUz = language === 'UZ';

    if (mode === 'SENTENCES') {
      const sentenceBank = isUz ? this.UZ_SENTENCES : this.EN_SENTENCES;
      const count = targetWords || 3;
      const selected: string[] = [];
      for (let i = 0; i < count; i++) {
        selected.push(sentenceBank[i % sentenceBank.length]);
      }
      return selected.join(' ');
    }

    // For TIME or WORDS or CHALLENGE: select word count
    let count = 25;
    if (mode === 'WORDS') {
      count = targetWords || 25;
    } else if (mode === 'TIME') {
      const seconds = targetSeconds || 30;
      count = Math.max(25, Math.ceil((seconds / 60) * 80)); // sufficient words for high WPM
    } else if (mode === 'CHALLENGE') {
      count = targetWords || 50;
    }

    const wordBank = isUz
      ? this.UZ_WORDS
      : difficulty === 'BEGINNER'
      ? this.EN_BEGINNER_WORDS
      : difficulty === 'ADVANCED'
      ? this.EN_ADVANCED_WORDS
      : this.EN_INTERMEDIATE_WORDS;

    const words: string[] = [];
    for (let i = 0; i < count; i++) {
      const randomIndex = Math.floor(Math.random() * wordBank.length);
      words.push(wordBank[randomIndex]);
    }

    return words.join(' ');
  }

  /**
   * Create a typing test record (100% FREE, NO CREDITS REQUIRED)
   */
  static async createTest(params: CreateTypingTestParams) {
    const {
      userId,
      mode,
      language = 'EN',
      difficulty = 'INTERMEDIATE',
      targetWords,
      targetSeconds,
    } = params;

    const referenceText = this.generateReferenceText(
      mode,
      language,
      difficulty,
      targetWords,
      targetSeconds
    );

    const test = await prisma.typingTest.create({
      data: {
        userId,
        mode,
        language,
        difficulty,
        targetWords: targetWords || null,
        targetSeconds: targetSeconds || null,
        referenceText,
        status: 'PENDING',
        startedAt: new Date(),
      },
    });

    return test;
  }

  /**
   * Complete test with deterministic scoring and statistics calculation
   */
  static async completeTest(params: CompleteTypingTestParams) {
    const {
      testId,
      userId,
      durationMs,
      correctCharacters,
      incorrectCharacters,
      correctedErrors = 0,
      uncorrectedErrors = 0,
      samples = [],
    } = params;

    const safeDurationMs = Math.max(1000, durationMs);
    const durationMinutes = safeDurationMs / 60000;
    const totalTyped = correctCharacters + incorrectCharacters;

    // Standard WPM = (correct characters / 5) / minutes
    const wpm = durationMinutes > 0 ? Number(((correctCharacters / 5) / durationMinutes).toFixed(1)) : 0;
    const rawWpm = durationMinutes > 0 ? Number(((totalTyped / 5) / durationMinutes).toFixed(1)) : 0;
    const cpm = durationMinutes > 0 ? Number((correctCharacters / durationMinutes).toFixed(0)) : 0;

    // Accuracy = (correct / totalTyped) * 100
    const accuracy = totalTyped > 0
      ? Number(((correctCharacters / totalTyped) * 100).toFixed(1))
      : 100;

    // Consistency calculation based on sample standard deviation
    let consistency = 90;
    if (samples.length > 2) {
      const wpms = samples.map((s) => s.wpm);
      const mean = wpms.reduce((a, b) => a + b, 0) / wpms.length;
      if (mean > 0) {
        const variance = wpms.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / wpms.length;
        const stdDev = Math.sqrt(variance);
        consistency = Math.max(50, Math.min(100, Number((100 - (stdDev / mean) * 40).toFixed(1))));
      }
    }

    // Determine personal performance level
    const personalRating = this.computePersonalRating(wpm, accuracy);

    // Save test result and speed samples in a single transaction
    const result = await prisma.$transaction(async (tx) => {
      // Mark test completed
      await tx.typingTest.update({
        where: { id: testId },
        data: {
          status: 'COMPLETED',
          finishedAt: new Date(),
        },
      });

      // Create TypingResult
      const typingResult = await tx.typingResult.create({
        data: {
          testId,
          userId,
          wpm,
          rawWpm,
          cpm,
          accuracy,
          consistency,
          correctCharacters,
          incorrectCharacters,
          correctedErrors,
          uncorrectedErrors,
          durationMs: safeDurationMs,
          personalRating,
        },
      });

      // Save speed samples if provided
      if (samples && samples.length > 0) {
        await tx.typingSpeedSample.createMany({
          data: samples.slice(0, 100).map((s) => ({
            testId,
            elapsedMs: s.elapsedMs,
            wpm: s.wpm,
            rawWpm: s.rawWpm,
          })),
        });
      }

      // Update aggregate UserStats
      const existingStats = await tx.typingUserStats.findUnique({
        where: { userId },
      });

      if (!existingStats) {
        await tx.typingUserStats.create({
          data: {
            userId,
            completedTests: 1,
            bestWpm: wpm,
            averageWpm: wpm,
            averageAccuracy: accuracy,
          },
        });
      } else {
        const newCount = existingStats.completedTests + 1;
        const newBest = Math.max(existingStats.bestWpm, wpm);
        const newAvgWpm = Number(
          ((existingStats.averageWpm * existingStats.completedTests + wpm) / newCount).toFixed(1)
        );
        const newAvgAcc = Number(
          ((existingStats.averageAccuracy * existingStats.completedTests + accuracy) / newCount).toFixed(1)
        );

        await tx.typingUserStats.update({
          where: { userId },
          data: {
            completedTests: newCount,
            bestWpm: newBest,
            averageWpm: newAvgWpm,
            averageAccuracy: newAvgAcc,
          },
        });
      }

      return typingResult;
    });

    return {
      result,
      wpm,
      rawWpm,
      cpm,
      accuracy,
      consistency,
      personalRating,
    };
  }

  /**
   * Personal rating rubric based on speed and accuracy
   */
  static computePersonalRating(wpm: number, accuracy: number): string {
    if (wpm >= 80 && accuracy >= 97) return 'Expert';
    if (wpm >= 65 && accuracy >= 95) return 'Excellent';
    if (wpm >= 50 && accuracy >= 93) return 'Very Good';
    if (wpm >= 35 && accuracy >= 90) return 'Good';
    if (wpm >= 20 && accuracy >= 85) return 'Improving';
    return 'Beginner';
  }

  /**
   * Get past completed tests for user
   */
  static async getUserHistory(userId: string, limit = 20) {
    return prisma.typingResult.findMany({
      where: { userId },
      include: {
        test: {
          select: {
            mode: true,
            language: true,
            difficulty: true,
            targetWords: true,
            targetSeconds: true,
          },
        },
      },
      orderBy: { completedAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Get user aggregate stats
   */
  static async getUserStats(userId: string) {
    const stats = await prisma.typingUserStats.findUnique({
      where: { userId },
    });

    return stats || {
      completedTests: 0,
      bestWpm: 0,
      averageWpm: 0,
      averageAccuracy: 0,
    };
  }

  /**
   * Get personal bests grouped by mode
   */
  static async getPersonalBests(userId: string) {
    const results = await prisma.typingResult.findMany({
      where: { userId },
      include: {
        test: {
          select: { mode: true, targetSeconds: true, targetWords: true },
        },
      },
      orderBy: { wpm: 'desc' },
      take: 50,
    });

    const bestByMode: Record<string, any> = {};
    for (const r of results) {
      const modeKey = r.test.mode;
      if (!bestByMode[modeKey] || r.wpm > bestByMode[modeKey].wpm) {
        bestByMode[modeKey] = r;
      }
    }

    return bestByMode;
  }
}
