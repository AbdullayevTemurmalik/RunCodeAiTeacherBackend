import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { TypingService } from '../services/typing/typing.service';

export class TypingController {
  /**
   * Start a new typing test (100% Free, NO credit cost)
   */
  static async createTest(req: AuthenticatedRequest, res: Response) {
    try {
      const { mode, language, difficulty, targetWords, targetSeconds } = req.body;

      if (!mode) {
        return res.status(400).json({ success: false, message: 'Test rejimini tanlang' });
      }

      const test = await TypingService.createTest({
        userId: req.user!.id,
        mode,
        language,
        difficulty,
        targetWords: targetWords ? Number(targetWords) : undefined,
        targetSeconds: targetSeconds ? Number(targetSeconds) : undefined,
      });

      res.status(201).json({
        success: true,
        test,
        isFree: true,
        message: 'Typing mashg‘uloti yaratildi (100% Bepul)',
      });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }

  /**
   * Complete test and record metrics
   */
  static async completeTest(req: AuthenticatedRequest, res: Response) {
    try {
      const id = req.params.id as string;
      const {
        durationMs,
        correctCharacters,
        incorrectCharacters,
        correctedErrors,
        uncorrectedErrors,
        samples,
      } = req.body;

      if (durationMs === undefined || correctCharacters === undefined || incorrectCharacters === undefined) {
        return res.status(400).json({ success: false, message: 'Metrikalar to‘liq emas' });
      }

      const outcome = await TypingService.completeTest({
        testId: id,
        userId: req.user!.id,
        durationMs: Number(durationMs),
        correctCharacters: Number(correctCharacters),
        incorrectCharacters: Number(incorrectCharacters),
        correctedErrors: correctedErrors ? Number(correctedErrors) : 0,
        uncorrectedErrors: uncorrectedErrors ? Number(uncorrectedErrors) : 0,
        samples: samples || [],
      });

      res.json({
        success: true,
        data: outcome,
        creditsConsumed: 0,
        message: 'Natijalar muvaffaqiyatli saqlandi',
      });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }

  /**
   * User test history
   */
  static async getHistory(req: AuthenticatedRequest, res: Response) {
    try {
      const history = await TypingService.getUserHistory(req.user!.id);
      res.json({ success: true, history });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * User aggregate stats
   */
  static async getStats(req: AuthenticatedRequest, res: Response) {
    try {
      const stats = await TypingService.getUserStats(req.user!.id);
      res.json({ success: true, stats });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * User personal best records
   */
  static async getPersonalBests(req: AuthenticatedRequest, res: Response) {
    try {
      const personalBests = await TypingService.getPersonalBests(req.user!.id);
      res.json({ success: true, personalBests });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
}
