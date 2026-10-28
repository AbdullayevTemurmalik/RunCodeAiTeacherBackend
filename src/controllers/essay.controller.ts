import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { EssayService } from '../services/ai/essay.service';
import { GeminiService } from '../services/ai/gemini.service';
import { prisma } from '../prisma/client';

export class EssayController {
  static async getTasks(req: AuthenticatedRequest, res: Response) {
    try {
      const tasks = await prisma.essayTask.findMany({
        orderBy: { createdAt: 'desc' },
      });
      res.json({ success: true, tasks });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  static async generateTopic(req: AuthenticatedRequest, res: Response) {
    try {
      const { level, category, wordCount } = req.body;
      const topicData = await GeminiService.generateEssayTopic(
        level || 'B1',
        category || 'General',
        Number(wordCount) || 50
      );

      const task = await prisma.essayTask.create({
        data: {
          level: level || 'B1',
          category: category || 'General',
          targetWordCount: Number(wordCount) || 50,
          difficulty: level || 'Intermediate',
          title: topicData.title,
          instructions: topicData.instructions,
          requiredWords: topicData.requiredWords,
        },
      });

      res.status(201).json({ success: true, task });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  static async validateWords(req: AuthenticatedRequest, res: Response) {
    try {
      const { text, targetWordCount, requiredWords } = req.body;
      const result = EssayService.validateEssayRequirements(
        text || '',
        Number(targetWordCount) || 30,
        requiredWords || []
      );
      res.json({ success: true, ...result });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }

  static async submitEssay(req: AuthenticatedRequest, res: Response) {
    try {
      const { taskId, text } = req.body;
      if (!taskId || !text) {
        return res.status(400).json({ success: false, message: 'Topshiriq va insho matnini kiriting' });
      }

      const result = await EssayService.submitAndEvaluateEssay(req.user!.id, taskId, text);
      res.json({ success: true, ...result });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }

  static async getSubmissions(req: AuthenticatedRequest, res: Response) {
    try {
      const submissions = await prisma.essaySubmission.findMany({
        where: { userId: req.user!.id },
        include: { task: true },
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
      const submission = await prisma.essaySubmission.findFirst({
        where: { id, userId: req.user!.id },
        include: { task: true },
      });
      if (!submission) {
        return res.status(404).json({ success: false, message: 'Insho topilmadi' });
      }
      res.json({ success: true, submission });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
}
