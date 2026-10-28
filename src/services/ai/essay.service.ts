import { prisma } from '../../prisma/client';
import { GeminiService, EssayEvaluation } from './gemini.service';
import { CreditService } from '../credits/credit.service';
import { SubmissionStatus } from '@prisma/client';

export interface VocabularyValidationResult {
  isValid: boolean;
  wordCount: number;
  matchedWords: string[];
  missingWords: string[];
  matchedPhrases: string[];
  missingPhrases: string[];
  errorMessage?: string;
}

export class EssayService {
  /**
   * Deterministic word and mandatory phrase validator
   */
  static validateEssayRequirements(
    text: string,
    targetWordCount: number,
    requiredWords: string[] = [],
    requiredPhrases: string[] = []
  ): VocabularyValidationResult {
    const trimmed = text.trim();
    if (!trimmed) {
      return {
        isValid: false,
        wordCount: 0,
        matchedWords: [],
        missingWords: requiredWords,
        matchedPhrases: [],
        missingPhrases: requiredPhrases,
        errorMessage: 'Insho matni kiritilmagan',
      };
    }

    // Tokenize text into words (removing punctuation, unicode aware)
    const tokens = trimmed.split(/[\s,.;:!?()"\n\r—\-_]+/).filter((t) => t.length > 0);
    const wordCount = tokens.length;

    // Normalize entire text for phrase searches (collapse spaces)
    const normalizedText = trimmed.toLowerCase().replace(/\s+/g, ' ');

    // Match mandatory single words using strict token boundaries (case-insensitive)
    const lowerTokens = tokens.map((t) => t.toLowerCase());
    const matchedWords: string[] = [];
    const missingWords: string[] = [];

    for (const req of requiredWords) {
      const cleanReq = req.trim().toLowerCase();
      // Match whole word lemma or standard simple plurals/past tense
      const isMatched = lowerTokens.some((tok) => {
        if (tok === cleanReq) return true;
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

    // Match mandatory 2-3 word consecutive phrases
    const matchedPhrases: string[] = [];
    const missingPhrases: string[] = [];

    for (const phrase of requiredPhrases) {
      const cleanPhrase = phrase.trim().toLowerCase();
      const escaped = cleanPhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const phraseRegex = new RegExp(`\\b${escaped}\\b`, 'i');

      if (phraseRegex.test(normalizedText)) {
        matchedPhrases.push(cleanPhrase);
      } else {
        missingPhrases.push(cleanPhrase);
      }
    }

    // Check minimum word count
    if (wordCount < targetWordCount) {
      return {
        isValid: false,
        wordCount,
        matchedWords,
        missingWords,
        matchedPhrases,
        missingPhrases,
        errorMessage: `So‘zlar soni yetarli emas. Kamida ${targetWordCount} ta so‘z bo‘lishi kerak (hozirda: ${wordCount} ta).`,
      };
    }

    // Check missing single words
    if (missingWords.length > 0) {
      return {
        isValid: false,
        wordCount,
        matchedWords,
        missingWords,
        matchedPhrases,
        missingPhrases,
        errorMessage: `Quyidagi majburiy so‘zlar inshoda ishlatilmagan: ${missingWords.join(', ')}`,
      };
    }

    // Check missing phrases
    if (missingPhrases.length > 0) {
      return {
        isValid: false,
        wordCount,
        matchedWords,
        missingWords,
        matchedPhrases,
        missingPhrases,
        errorMessage: `Quyidagi majburiy iboralar inshoda ishlatilmagan: ${missingPhrases.join(', ')}`,
      };
    }

    return {
      isValid: true,
      wordCount,
      matchedWords,
      missingWords: [],
      matchedPhrases,
      missingPhrases: [],
    };
  }

  /**
   * Save or update essay draft
   */
  static async saveDraft(userId: string, taskId: string, content: string) {
    const tokens = content.trim().split(/[\s,.;:!?()"\n\r—\-_]+/).filter((t) => t.length > 0);
    const currentWordCount = tokens.length;

    return prisma.essayDraft.upsert({
      where: {
        taskId_userId: { taskId, userId },
      },
      update: {
        content,
        currentWordCount,
      },
      create: {
        taskId,
        userId,
        content,
        currentWordCount,
      },
    });
  }

  /**
   * Retrieve essay draft
   */
  static async getDraft(userId: string, taskId: string) {
    return prisma.essayDraft.findUnique({
      where: {
        taskId_userId: { taskId, userId },
      },
    });
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
      : JSON.parse((task.requiredWords as any) || '[]');

    const requiredPhrases: string[] = Array.isArray(task.requiredPhrases)
      ? (task.requiredPhrases as string[])
      : JSON.parse((task.requiredPhrases as any) || '[]');

    // 1. Run deterministic validation first
    const validation = this.validateEssayRequirements(
      text,
      task.targetWordCount,
      requiredWords,
      requiredPhrases
    );

    if (!validation.isValid) {
      // Throw error WITHOUT deducting any credits!
      throw new Error(validation.errorMessage);
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error('Foydalanuvchi topilmadi');

    const isPaid = user.tier !== 'FREE';
    const estimatedCost = 20; // 20 credits for Essay evaluation
    const opId = `essay-${userId}-${Date.now()}`;

    // 2. Reserve credits atomically
    const reservation = await CreditService.reserveCredits(userId, 'ESSAY', opId, estimatedCost, isPaid);

    let evaluation: EssayEvaluation;
    try {
      // 3. Call AI evaluator with sentence-by-sentence analysis
      evaluation = await GeminiService.evaluateEssay(
        text,
        task.title,
        requiredWords,
        requiredPhrases,
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
        matchedPhrases: validation.matchedPhrases,
        missingPhrases: validation.missingPhrases,
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
