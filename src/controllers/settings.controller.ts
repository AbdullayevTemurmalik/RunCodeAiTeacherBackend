import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { prisma } from '../prisma/client';

export class SettingsController {
  static async getSettings(req: AuthenticatedRequest, res: Response) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user!.id },
        select: { language: true, theme: true },
      });
      res.json({ success: true, settings: user });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  static async updateSettings(req: AuthenticatedRequest, res: Response) {
    try {
      const { language, theme } = req.body;
      const data: any = {};
      if (language && (language === 'uz' || language === 'en')) {
        data.language = language;
      }
      if (theme && (theme === 'light' || theme === 'dark')) {
        data.theme = theme;
      }

      const updated = await prisma.user.update({
        where: { id: req.user!.id },
        data,
        select: { language: true, theme: true },
      });

      res.json({ success: true, settings: updated });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
}
