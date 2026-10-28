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

  static async getTask(req: AuthenticatedRequest, res: Response) {
    try {
      const id = req.params.id as string;
      const task = await prisma.essayTask.findUnique({
        where: { id },
      });
      if (!task) {
        return res.status(404).json({ success: false, message: 'Topshiriq topilmadi' });
      }
      res.json({ success: true, task });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  static async generateTopic(req: AuthenticatedRequest, res: Response) {
    try {
      const { level, category, wordCount } = req.body;
      const targetCount = Number(wordCount) || 50;

      const topicData = await GeminiService.generateEssayTopic(
        level || 'B1',
        category || 'General',
        targetCount
      );

      const task = await prisma.essayTask.create({
        data: {
          userId: req.user!.id,
          level: level || 'B1',
          category: category || 'General',
          targetWordCount: targetCount,
          difficulty: level || 'Intermediate',
          title: topicData.title,
          instructions: topicData.instructions,
          requiredWords: topicData.requiredWords,
          requiredPhrases: topicData.requiredPhrases,
        },
      });

      res.status(201).json({ success: true, task });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  static async validateWords(req: AuthenticatedRequest, res: Response) {
    try {
      const { text, targetWordCount, requiredWords, requiredPhrases } = req.body;
      const result = EssayService.validateEssayRequirements(
        text || '',
        Number(targetWordCount) || 30,
        requiredWords || [],
        requiredPhrases || []
      );
      res.json({ success: true, ...result });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }

  static async saveDraft(req: AuthenticatedRequest, res: Response) {
    try {
      const id = req.params.id as string;
      const { content } = req.body;
      const draft = await EssayService.saveDraft(req.user!.id, id, content || '');
      res.json({ success: true, draft });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }

  static async getDraft(req: AuthenticatedRequest, res: Response) {
    try {
      const id = req.params.id as string;
      const draft = await EssayService.getDraft(req.user!.id, id);
      res.json({ success: true, draft });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  static async submitEssay(req: AuthenticatedRequest, res: Response) {
    try {
      const taskId = req.body.taskId || req.params.id;
      const text = req.body.text || req.body.content;
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
