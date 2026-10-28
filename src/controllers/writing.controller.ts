import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { WritingService } from '../services/ai/writing.service';
import { GeminiService } from '../services/ai/gemini.service';
import { prisma } from '../prisma/client';

export class WritingController {
  /**
   * Real-time live grammar & spelling check while typing
   */
  static async liveCheck(req: AuthenticatedRequest, res: Response) {
    try {
      const { text, level, topic, documentRevision } = req.body;

      if (!text || text.trim().length === 0) {
        return res.json({
          success: true,
          revision: documentRevision || 1,
          errors: [],
          verifiedSentences: [],
          overallStatus: 'EMPTY',
        });
      }

      try {
        const checkResult = await GeminiService.liveCheckWriting(
          text,
          level || 'B2',
          topic
        );

        return res.json({
          success: true,
          revision: documentRevision || 1,
          ...checkResult,
        });
      } catch (geminiError: any) {
        console.warn('[Writing LiveCheck Fallback]: Gemini unavailable or rate-limited. Falling back to local check.', geminiError?.message);
        const fallback = WritingService.heuristicSpellCheck(text);
        return res.json({
          success: true,
          revision: documentRevision || 1,
          ...fallback,
        });
      }
    } catch (err: any) {
      const fallback = WritingService.heuristicSpellCheck(req.body.text || '');
      res.json({
        success: true,
        revision: req.body.documentRevision || 1,
        ...fallback,
      });
    }
  }

  /**
   * Save writing draft
   */
  static async saveDraft(req: AuthenticatedRequest, res: Response) {
    try {
      const { content, mode, targetWordCount, revision } = req.body;
      const draft = await prisma.writingDraft.create({
        data: {
          userId: req.user!.id,
          content: content || '',
          mode: mode || 'FREE',
          targetWordCount: targetWordCount ? Number(targetWordCount) : null,
          revision: revision ? Number(revision) : 1,
        },
      });
      res.json({ success: true, draft });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }

  /**
   * Submit complete writing for evaluation
   */
  static async submitWriting(req: AuthenticatedRequest, res: Response) {
    try {
      const { text, level, targetWordCount, topicType, topicTitle } = req.body;
      if (!text || !level || !targetWordCount) {
        return res.status(400).json({ success: false, message: 'Barcha maydonlarni to‘ldiring' });
      }

      const result = await WritingService.submitWriting(
        req.user!.id,
        text,
        level,
        Number(targetWordCount),
        topicType || 'FREE',
        topicTitle
      );

      res.json({ success: true, ...result });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }

  static async getSubmissions(req: AuthenticatedRequest, res: Response) {
    try {
      const submissions = await prisma.writingSubmission.findMany({
        where: { userId: req.user!.id },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });
      res.json({ success: true, submissions });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  static async getSubmission(req: AuthenticatedRequest, res: Response) {
    try {
      const id = req.params.id as string;
      const submission = await prisma.writingSubmission.findFirst({
        where: { id, userId: req.user!.id },
      });
      if (!submission) {
        return res.status(404).json({ success: false, message: 'Yozish mashqi topilmadi' });
      }
      res.json({ success: true, submission });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
}
