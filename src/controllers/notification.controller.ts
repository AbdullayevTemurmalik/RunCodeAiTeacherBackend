import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { prisma } from '../prisma/client';

export class NotificationController {
  static async getNotifications(req: AuthenticatedRequest, res: Response) {
    try {
      const notifications = await prisma.notification.findMany({
        where: { userId: req.user!.id },
        orderBy: { createdAt: 'desc' },
        take: 30,
      });

      const unreadCount = await prisma.notification.count({
        where: { userId: req.user!.id, isRead: false },
      });

      res.json({ success: true, notifications, unreadCount });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  static async markAllRead(req: AuthenticatedRequest, res: Response) {
    try {
      await prisma.notification.updateMany({
        where: { userId: req.user!.id, isRead: false },
        data: { isRead: true },
      });
      res.json({ success: true, message: 'Barcha xabarnomalar o‘qildi' });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  static async markAsRead(req: AuthenticatedRequest, res: Response) {
    try {
      const id = req.params.id as string;
      await prisma.notification.updateMany({
        where: { id, userId: req.user!.id },
        data: { isRead: true },
      });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
}
