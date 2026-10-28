import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { WritingService } from '../services/ai/writing.service';
import { prisma } from '../prisma/client';

export class WritingController {
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
