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

  /**
   * Local heuristic spell & grammar check when AI is rate-limited or unavailable
   */
  static heuristicSpellCheck(text: string): { errors: any[]; verifiedSentences: string[]; overallStatus: string } {
    const errors: any[] = [];
    const verifiedSentences: string[] = [];

    const commonTypos: Record<string, { replacement: string; type: string; uz: string; en: string }> = {
      undertand: { replacement: 'understand', type: 'Spelling', uz: "'undertand' so‘zi noto‘g‘ri yozilgan. To‘g‘ri shakli: 'understand'.", en: "Misspelled word. Correct spelling is 'understand'." },
      exsecas: { replacement: 'exercises', type: 'Spelling', uz: "'exsecas' noto‘g‘ri yozilgan. To‘g‘ri shakli: 'exercises'.", en: "Misspelled word. Correct spelling is 'exercises'." },
      teh: { replacement: 'the', type: 'Spelling', uz: "Harflar o‘rni almashgan. To‘g‘ri shakli: 'the'.", en: "Typo. Correct word is 'the'." },
      becuase: { replacement: 'because', type: 'Spelling', uz: "'becuase' xato yozilgan. To‘g‘ri shakli: 'because'.", en: "Misspelled word. Correct spelling is 'because'." },
      recieve: { replacement: 'receive', type: 'Spelling', uz: "'i' va 'e' harflari qoidasi: 'c' dan keyin 'ei' keladi ('receive').", en: "Rule: 'i' before 'e' except after 'c' ('receive')." },
      seperate: { replacement: 'separate', type: 'Spelling', uz: "'seperate' emas, balki 'separate' bo‘ladi.", en: "Correct spelling is 'separate'." },
      definately: { replacement: 'definitely', type: 'Spelling', uz: "To‘g‘ri shakli: 'definitely'.", en: "Correct spelling is 'definitely'." },
      dont: { replacement: "don't", type: 'Punctuation', uz: "Apostrof tushib qolgan: 'don\\'t'.", en: "Missing apostrophe in contraction: 'don\\'t'." },
      cant: { replacement: "can't", type: 'Punctuation', uz: "Apostrof tushib qolgan: 'can\\'t'.", en: "Missing apostrophe in contraction: 'can\\'t'." },
      wont: { replacement: "won't", type: 'Punctuation', uz: "Apostrof tushib qolgan: 'won\\'t'.", en: "Missing apostrophe in contraction: 'won\\'t'." },
    };

    // Check lowercase isolated 'i'
    const isolatedIMatches = text.matchAll(/\b(i)\b/g);
    for (const match of isolatedIMatches) {
      if (match.index !== undefined) {
        errors.push({
          originalSpan: 'i',
          replacement: 'I',
          errorType: 'Capitalization',
          explanationUzbek: "Ingliz tilida 'I' (men) doimo katta harf bilan yoziladi.",
          explanationEnglish: "The pronoun 'I' must always be capitalized.",
          grammarRule: 'Capitalization of first-person pronoun',
        });
        break; // report first occurrence
      }
    }

    // Check words against dictionary
    for (const [typo, info] of Object.entries(commonTypos)) {
      const regex = new RegExp(`\\b${typo}\\b`, 'gi');
      if (regex.test(text)) {
        errors.push({
          originalSpan: typo,
          replacement: info.replacement,
          errorType: info.type,
          explanationUzbek: info.uz,
          explanationEnglish: info.en,
          grammarRule: 'Spelling and Morphology',
        });
      }
    }

    // Split sentences and check for complete ones
    const rawSentences = text.split(/(?<=[.?!])\s+/).filter((s) => s.trim().length > 10);
    for (const sentence of rawSentences) {
      const hasError = errors.some((err) => sentence.toLowerCase().includes(err.originalSpan.toLowerCase()));
      if (!hasError && sentence.length > 15) {
        verifiedSentences.push(sentence.trim());
      }
    }

    return {
      errors,
      verifiedSentences,
      overallStatus: 'ANALYZED',
    };
  }
}
