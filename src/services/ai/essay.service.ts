import { prisma } from '../../prisma/client';
import { GeminiService, EssayEvaluation } from './gemini.service';
import { CreditService } from '../credits/credit.service';
import { SubmissionStatus } from '@prisma/client';

export interface VocabularyValidationResult {
  isValid: boolean;
  wordCount: number;
  matchedWords: string[];
  missingWords: string[];
  errorMessage?: string;
}

export class EssayService {
  /**
   * Deterministic word and mandatory vocabulary validator
   */
  static validateEssayRequirements(
    text: string,
    targetWordCount: number,
    requiredWords: string[]
  ): VocabularyValidationResult {
    const trimmed = text.trim();
    if (!trimmed) {
      return {
        isValid: false,
        wordCount: 0,
        matchedWords: [],
        missingWords: requiredWords,
        errorMessage: "Insho matni kiritilmagan",
      };
    }

    // Tokenize text into words (removing punctuation, unicode aware)
    const tokens = trimmed.split(/[\s,.;:!?()"\n\r—\-_]+/).filter((t) => t.length > 0);
    const wordCount = tokens.length;

    // Check minimum word count
    if (wordCount < targetWordCount) {
      return {
        isValid: false,
        wordCount,
        matchedWords: [],
        missingWords: requiredWords,
        errorMessage: `So‘zlar soni yetarli emas. Kamida ${targetWordCount} ta so‘z bo‘lishi kerak (hozirda: ${wordCount} ta).`,
      };
    }

    // Match mandatory vocabulary using strict token boundaries (case-insensitive)
    const lowerTokens = tokens.map((t) => t.toLowerCase());
    const matchedWords: string[] = [];
    const missingWords: string[] = [];

    for (const req of requiredWords) {
      const cleanReq = req.trim().toLowerCase();
      // Match whole word lemma or standard simple plurals/past tense (e.g. enjoy/enjoys/enjoyed/enjoying)
      const isMatched = lowerTokens.some((tok) => {
        if (tok === cleanReq) return true;
        // Simple inflection matching: s, ed, ing
        if (tok === `${cleanReq}s` || tok === `${cleanReq}es`) return true;
        if (tok === `${cleanReq}ed` || tok === `${cleanReq}d`) return true;
        if (tok === `${cleanReq}ing`) return true;
        return false;
      });

      if (isMatched) {
        matchedWords.push(cleanReq);
      } else {
        missingWords.push(cleanReq);
      }
    }

    if (missingWords.length > 0) {
      return {
        isValid: false,
        wordCount,
        matchedWords,
        missingWords,
        errorMessage: `Quyidagi majburiy so‘zlar inshoda ishlatilmagan: ${missingWords.join(', ')}`,
      };
    }

    return {
      isValid: true,
      wordCount,
      matchedWords,
      missingWords: [],
    };
  }

  /**
   * Submit and evaluate essay with transactional credit billing
   */
  static async submitAndEvaluateEssay(
    userId: string,
    taskId: string,
    text: string
  ): Promise<{ submission: any; evaluation: EssayEvaluation; reward?: any }> {
    const task = await prisma.essayTask.findUnique({ where: { id: taskId } });
    if (!task) {
      throw new Error("Insho topshirig'i topilmadi");
    }

    const requiredWords: string[] = Array.isArray(task.requiredWords)
      ? (task.requiredWords as string[])
      : JSON.parse(task.requiredWords as any || '[]');

    // 1. Run deterministic validation first
    const validation = this.validateEssayRequirements(text, task.targetWordCount, requiredWords);
    if (!validation.isValid) {
      // Throw error WITHOUT deducting any credits!
      throw new Error(validation.errorMessage);
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error("Foydalanuvchi topilmadi");

    const isPaid = user.tier !== 'FREE';
    const estimatedCost = 20; // 20 credits for Essay evaluation
    const opId = `essay-${userId}-${Date.now()}`;

    // 2. Reserve credits atomically
    const reservation = await CreditService.reserveCredits(userId, 'ESSAY', opId, estimatedCost, isPaid);

    let evaluation: EssayEvaluation;
    try {
      // 3. Call AI evaluator
      evaluation = await GeminiService.evaluateEssay(
        text,
        task.title,
        requiredWords,
        task.level,
        task.targetWordCount
      );
    } catch (aiErr: any) {
      // Release reservation on AI failure so user is never charged for an undelivered result
      await CreditService.releaseReservation(reservation.reservationId, 'AI baholash xatosi yuz berdi');
      throw new Error(`AI tekshiruvida xatolik yuz berdi: ${aiErr.message}`);
    }

    // 4. Commit credit reservation
    await CreditService.commitReservation(
      reservation.reservationId,
      undefined,
      `Insho tekshiruvi: "${task.title}"`
    );

    // 5. Store submission & evaluation in DB
    const submission = await prisma.essaySubmission.create({
      data: {
        taskId: task.id,
        userId,
        text,
        wordCount: validation.wordCount,
        matchedWords: validation.matchedWords,
        missingWords: validation.missingWords,
        status: SubmissionStatus.COMPLETED,
        overallScore: evaluation.overallScore,
        evaluationResult: evaluation as any,
        creditsCharged: estimatedCost,
      },
    });

    await prisma.aiEvaluation.create({
      data: {
        targetType: 'ESSAY',
        targetId: submission.id,
        overallScore: evaluation.overallScore,
        grammarScore: evaluation.categoryScores.grammar,
        vocabularyScore: evaluation.categoryScores.vocabulary,
        clarityScore: evaluation.categoryScores.clarity,
        cohesionScore: evaluation.categoryScores.organization,
        strengths: evaluation.bestSentences,
        weaknesses: evaluation.sentencesNeedingImprovement,
        rewrittenExample: evaluation.naturalRewrittenExample,
      },
    });

    // 6. Check learning reward
    const reward = await CreditService.checkAndGrantReward(
      userId,
      'ESSAY',
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
