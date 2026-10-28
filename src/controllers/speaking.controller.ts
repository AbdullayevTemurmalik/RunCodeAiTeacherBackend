import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { prisma } from '../prisma/client';

export class SpeakingController {
  static async getSessions(req: AuthenticatedRequest, res: Response) {
    try {
      const sessions = await prisma.speakingSession.findMany({
        where: { userId: req.user!.id },
        orderBy: { startedAt: 'desc' },
        take: 20,
      });
      res.json({ success: true, sessions });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  static async getSession(req: AuthenticatedRequest, res: Response) {
    try {
      const id = req.params.id as string;
      const session = await prisma.speakingSession.findFirst({
        where: { id, userId: req.user!.id },
        include: { turns: { orderBy: { createdAt: 'asc' } } },
      });
      if (!session) {
        return res.status(404).json({ success: false, message: 'Speaking darsi topilmadi' });
      }
      res.json({ success: true, session });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
}
