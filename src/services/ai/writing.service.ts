import { prisma } from '../../prisma/client';
import { GeminiService, WritingEvaluation } from './gemini.service';
import { CreditService } from '../credits/credit.service';
import { SubmissionStatus } from '@prisma/client';

export class WritingService {
  /**
   * Submit and evaluate basic writing
   */
  static async submitWriting(
    userId: string,
    text: string,
    level: string,
    targetWordCount: number,
    topicType: 'FREE' | 'TOPIC',
    topicTitle?: string
  ): Promise<{ submission: any; evaluation: WritingEvaluation; reward?: any }> {
    const trimmed = text.trim();
    if (!trimmed) {
      throw new Error("Matn kiritilmadi");
    }

    const tokens = trimmed.split(/[\s,.;:!?()"\n\r—\-_]+/).filter((t) => t.length > 0);
    const actualWordCount = tokens.length;

    if (actualWordCount < targetWordCount) {
      throw new Error(`So‘zlar soni yetarli emas. Kamida ${targetWordCount} ta so‘z bo‘lishi kerak (hozirda: ${actualWordCount} ta).`);
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error("Foydalanuvchi topilmadi");

    const isPaid = user.tier !== 'FREE';
    const estimatedCost = 15; // 15 credits for basic writing evaluation
    const opId = `writing-${userId}-${Date.now()}`;

    // 1. Reserve credits
    const reservation = await CreditService.reserveCredits(userId, 'WRITING', opId, estimatedCost, isPaid);

    let evaluation: WritingEvaluation;
    try {
      // 2. Call AI evaluator
      evaluation = await GeminiService.evaluateWriting(trimmed, level, topicTitle);
    } catch (aiErr: any) {
      await CreditService.releaseReservation(reservation.reservationId, 'AI baholash xatosi yuz berdi');
      throw new Error(`AI tekshiruvida xatolik yuz berdi: ${aiErr.message}`);
    }

    // 3. Commit reservation
    await CreditService.commitReservation(
      reservation.reservationId,
      undefined,
      `Yozish mashqi tekshiruvi: ${level} daraja (${actualWordCount} so'z)`
    );

    // 4. Store submission in DB
    const submission = await prisma.writingSubmission.create({
      data: {
        userId,
        level,
        topicType,
        topicTitle,
        targetWordCount,
        actualWordCount,
        text: trimmed,
        status: SubmissionStatus.COMPLETED,
        overallScore: evaluation.overallScore,
        evaluationResult: evaluation as any,
        creditsCharged: estimatedCost,
      },
    });

    await prisma.aiEvaluation.create({
      data: {
        targetType: 'WRITING',
        targetId: submission.id,
        overallScore: evaluation.overallScore,
        grammarScore: evaluation.grammarScore,
        vocabularyScore: evaluation.vocabularyScore,
        clarityScore: evaluation.clarityScore,
        strengths: evaluation.strongSentences,
        weaknesses: evaluation.weakSentences,
        corrections: evaluation.mistakes as any,
        rewrittenExample: evaluation.naturalRewrittenExample,
      },
    });

    // 5. Check reward
    const reward = await CreditService.checkAndGrantReward(
      userId,
      'WRITING',
      submission.id,
      evaluation.overallScore
    );

    return {
      submission,
      evaluation,
      reward: reward.rewarded ? { credits: reward.credits } : null,
    };
  }
}
