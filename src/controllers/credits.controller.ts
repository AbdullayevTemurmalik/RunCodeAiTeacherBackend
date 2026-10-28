import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { CreditService } from '../services/credits/credit.service';
import { prisma } from '../prisma/client';

export class CreditsController {
  static async getBalance(req: AuthenticatedRequest, res: Response) {
    try {
      const wallet = await CreditService.getWallet(req.user!.id);
      res.json({
        success: true,
        tier: req.user!.tier,
        wallet,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  static async getLedger(req: AuthenticatedRequest, res: Response) {
    try {
      const wallet = await prisma.creditWallet.findUnique({
        where: { userId: req.user!.id },
      });
      if (!wallet) {
        return res.json({ success: true, ledger: [] });
      }

      const ledger = await prisma.creditLedger.findMany({
        where: { walletId: wallet.id },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });

      const formatted = ledger.map((l) => ({
        id: l.id,
        amountCredits: CreditService.unitsToCredits(l.amountUnits),
        bucket: l.bucket,
        reason: l.reason,
        referenceType: l.referenceType,
        balanceAfterCredits: CreditService.unitsToCredits(l.balanceAfterUnits),
        createdAt: l.createdAt,
      }));

      res.json({ success: true, ledger: formatted });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  static async getPackages(req: AuthenticatedRequest, res: Response) {
    try {
      const packages = await prisma.creditPackage.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
      });
      res.json({ success: true, packages });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
}
