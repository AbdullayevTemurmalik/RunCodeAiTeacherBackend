import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { prisma } from '../prisma/client';
import { CreditService } from '../services/credits/credit.service';

export class ProfileController {
  static async getProfile(req: AuthenticatedRequest, res: Response) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user!.id },
        select: {
          id: true,
          email: true,
          username: true,
          firstName: true,
          lastName: true,
          age: true,
          role: true,
          tier: true,
          avatarUrl: true,
          language: true,
          theme: true,
          createdAt: true,
        },
      });

      if (!user) return res.status(404).json({ success: false, message: 'Foydalanuvchi topilmadi' });

      const wallet = await CreditService.getWallet(user.id);

      // Learning stats
      const [speakingCount, writingCount, essayCount] = await Promise.all([
        prisma.speakingSession.count({ where: { userId: user.id } }),
        prisma.writingSubmission.count({ where: { userId: user.id } }),
        prisma.essaySubmission.count({ where: { userId: user.id } }),
      ]);

      const [avgSpeaking, avgWriting, avgEssay] = await Promise.all([
        prisma.aiEvaluation.aggregate({
          _avg: { overallScore: true },
          where: { targetType: 'SPEAKING', targetId: { in: (await prisma.speakingSession.findMany({ where: { userId: user.id }, select: { id: true } })).map((s) => s.id) } },
        }),
        prisma.writingSubmission.aggregate({
          _avg: { overallScore: true },
          where: { userId: user.id, overallScore: { not: null } },
        }),
        prisma.essaySubmission.aggregate({
          _avg: { overallScore: true },
          where: { userId: user.id, overallScore: { not: null } },
        }),
      ]);

      res.json({
        success: true,
        profile: {
          ...user,
          wallet,
          stats: {
            speakingSessionsCount: speakingCount,
            writingSubmissionsCount: writingCount,
            essaySubmissionsCount: essayCount,
            avgSpeakingScore: avgSpeaking._avg.overallScore ? Number(avgSpeaking._avg.overallScore.toFixed(1)) : 0,
            avgWritingScore: avgWriting._avg.overallScore ? Number(avgWriting._avg.overallScore.toFixed(1)) : 0,
            avgEssayScore: avgEssay._avg.overallScore ? Number(avgEssay._avg.overallScore.toFixed(1)) : 0,
          },
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  static async updateProfile(req: AuthenticatedRequest, res: Response) {
    try {
      const { firstName, lastName, age, username } = req.body;

      const updateData: any = {};
      if (firstName) updateData.firstName = firstName.trim();
      if (lastName) updateData.lastName = lastName.trim();
      if (age !== undefined) updateData.age = Number(age);

      if (username) {
        const trimmedUser = username.trim().toLowerCase();
        if (trimmedUser !== req.user!.username.toLowerCase()) {
          const existing = await prisma.user.findFirst({
            where: { username: { equals: trimmedUser, mode: 'insensitive' } },
          });
          if (existing) {
            return res.status(400).json({ success: false, message: 'Bu username allaqachon band' });
          }
          updateData.username = trimmedUser;
        }
      }

      const updated = await prisma.user.update({
        where: { id: req.user!.id },
        data: updateData,
        select: {
          id: true,
          email: true,
          username: true,
          firstName: true,
          lastName: true,
          age: true,
          role: true,
          tier: true,
          language: true,
          theme: true,
        },
      });

      res.json({ success: true, message: 'Profil muvaffaqiyatli saqlandi', user: updated });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
}
