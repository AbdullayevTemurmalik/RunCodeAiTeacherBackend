import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { prisma } from '../prisma/client';
import { PaymentService } from '../services/payments/payment.service';
import { CreditService } from '../services/credits/credit.service';
import { CreditBucket, UserStatus, PaymentOrderStatus } from '@prisma/client';
import fs from 'fs';
import path from 'path';

export class AdminController {
  static async getDashboard(req: AuthenticatedRequest, res: Response) {
    try {
      const [
        totalUsers,
        paidUsers,
        activeUsers,
        pendingPayments,
        confirmedPayments,
        walletsAggregate,
        speakingCount,
        writingCount,
        essayCount,
      ] = await Promise.all([
        prisma.user.count({ where: { status: { not: UserStatus.DELETED } } }),
        prisma.user.count({ where: { tier: { not: 'FREE' } } }),
        prisma.userSession.count({ where: { isActive: true } }),
        prisma.paymentOrder.count({ where: { status: PaymentOrderStatus.UNDER_REVIEW } }),
        prisma.paymentOrder.aggregate({
          _sum: { amountUzs: true },
          where: { status: PaymentOrderStatus.PAYMENT_CONFIRMED },
        }),
        prisma.creditWallet.aggregate({
          _sum: { lifetimeEarnedUnits: true, lifetimeSpentUnits: true },
        }),
        prisma.speakingSession.count(),
        prisma.writingSubmission.count(),
        prisma.essaySubmission.count(),
      ]);

      const revenueUzs = confirmedPayments._sum.amountUzs || 0;
      const totalPurchasedCredits = CreditService.unitsToCredits(walletsAggregate._sum.lifetimeEarnedUnits || BigInt(0));
      const totalConsumedCredits = CreditService.unitsToCredits(walletsAggregate._sum.lifetimeSpentUnits || BigInt(0));

      res.json({
        success: true,
        stats: {
          totalUsers,
          paidUsers,
          activeUsers,
          pendingPayments,
          confirmedRevenueUzs: revenueUzs,
          totalPurchasedCredits,
          totalConsumedCredits,
          activity: {
            speakingCount,
            writingCount,
            essayCount,
          },
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  static async getUsers(req: AuthenticatedRequest, res: Response) {
    try {
      const { search, tier, status, page = 1, limit = 20 } = req.query;
      const pageNum = Math.max(1, Number(page));
      const limitNum = Math.min(100, Math.max(1, Number(limit)));
      const skip = (pageNum - 1) * limitNum;

      const where: any = {};
      if (search) {
        const query = String(search).trim();
        where.OR = [
          { email: { contains: query, mode: 'insensitive' } },
          { username: { contains: query, mode: 'insensitive' } },
          { firstName: { contains: query, mode: 'insensitive' } },
          { lastName: { contains: query, mode: 'insensitive' } },
        ];
      }
      if (tier) where.tier = tier;
      if (status) where.status = status;

      const [users, total] = await Promise.all([
        prisma.user.findMany({
          where,
          select: {
            id: true,
            email: true,
            username: true,
            firstName: true,
            lastName: true,
            age: true,
            role: true,
            tier: true,
            status: true,
            createdAt: true,
            wallet: {
              select: { balanceUnits: true, lifetimeSpentUnits: true },
            },
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limitNum,
        }),
        prisma.user.count({ where }),
      ]);

      const formatted = users.map(({ wallet, ...u }) => ({
        ...u,
        creditBalance: wallet ? CreditService.unitsToCredits(wallet.balanceUnits) : 0,
        creditsConsumed: wallet ? CreditService.unitsToCredits(wallet.lifetimeSpentUnits) : 0,
      }));

      res.json({
        success: true,
        users: formatted,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          pages: Math.ceil(total / limitNum),
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  static async getUser(req: AuthenticatedRequest, res: Response) {
    try {
      const id = req.params.id as string;
      const user = await prisma.user.findUnique({
        where: { id },
        include: {
          wallet: true,
          paymentOrders: { orderBy: { createdAt: 'desc' }, take: 10 },
          speakingSessions: { orderBy: { startedAt: 'desc' }, take: 5 },
          writingSubmissions: { orderBy: { createdAt: 'desc' }, take: 5 },
          essaySubmissions: { orderBy: { createdAt: 'desc' }, take: 5 },
        },
      });
      if (!user) return res.status(404).json({ success: false, message: 'Foydalanuvchi topilmadi' });

      const { wallet, passwordHash, ...userClean } = user as any;
      res.json({
        success: true,
        user: {
          ...userClean,
          creditWallet: wallet
            ? {
                balanceCredits: CreditService.unitsToCredits(wallet.balanceUnits),
                lifetimeEarned: CreditService.unitsToCredits(wallet.lifetimeEarnedUnits),
                lifetimeSpent: CreditService.unitsToCredits(wallet.lifetimeSpentUnits),
              }
            : null,
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  static async updateUserStatus(req: AuthenticatedRequest, res: Response) {
    try {
      const id = req.params.id as string;
      const { status, reason } = req.body;

      if (!['ACTIVE', 'SUSPENDED', 'DELETED'].includes(status)) {
        return res.status(400).json({ success: false, message: 'Yaroqsiz status' });
      }

      const updated = await prisma.user.update({
        where: { id },
        data: { status: status as UserStatus },
      });

      // If suspended or deleted, revoke all sessions
      if (status !== 'ACTIVE') {
        await prisma.userSession.updateMany({
          where: { userId: id, isActive: true },
          data: { isActive: false, revokedAt: new Date() },
        });
      }

      await prisma.adminAuditLog.create({
        data: {
          adminId: req.user!.id,
          action: `USER_STATUS_${status}`,
          targetType: 'User',
          targetId: id,
          details: { status, reason },
        },
      });

      res.json({ success: true, message: `Foydalanuvchi holati ${status} ga o‘zgartirildi`, user: updated });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }

  static async adjustCredits(req: AuthenticatedRequest, res: Response) {
    try {
      const id = req.params.id as string;
      const { amountCredits, reason } = req.body;

      if (!amountCredits || !reason) {
        return res.status(400).json({ success: false, message: 'Kredit miqdori va sababi ko‘rsatilishi shart' });
      }

      const creditsNum = Number(amountCredits);
      const units = CreditService.creditsToUnits(Math.abs(creditsNum));

      await prisma.$transaction(async (tx) => {
        const wallet = await tx.creditWallet.findUnique({ where: { userId: id } });
        if (!wallet) throw new Error('Hamyon topilmadi');

        if (creditsNum < 0 && wallet.balanceUnits < units) {
          throw new Error('Mavjud balansdan ko‘p kredit yechib bo‘lmaydi');
        }

        const updatedWallet = await tx.creditWallet.update({
          where: { id: wallet.id },
          data: {
            balanceUnits: creditsNum > 0 ? { increment: units } : { decrement: units },
          },
        });

        await tx.creditLedger.create({
          data: {
            walletId: wallet.id,
            amountUnits: creditsNum > 0 ? units : -units,
            bucket: CreditBucket.ADJUSTMENT,
            reason: `Admin tuzatishi: ${reason}`,
            referenceType: 'ADMIN',
            referenceId: req.user!.id,
            balanceAfterUnits: updatedWallet.balanceUnits,
          },
        });

        await tx.adminAuditLog.create({
          data: {
            adminId: req.user!.id,
            action: 'CREDIT_ADJUSTMENT',
            targetType: 'User',
            targetId: id,
            details: { amountCredits: creditsNum, reason },
          },
        });
      });

      res.json({ success: true, message: 'Kreditlar muvaffaqiyatli o‘zgartirildi' });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }

  static async getPayments(req: AuthenticatedRequest, res: Response) {
    try {
      const { status, page = 1, limit = 20 } = req.query;
      const pageNum = Math.max(1, Number(page));
      const limitNum = Math.min(100, Math.max(1, Number(limit)));
      const skip = (pageNum - 1) * limitNum;

      const where: any = {};
      if (status) where.status = status;

      const [orders, total] = await Promise.all([
        prisma.paymentOrder.findMany({
          where,
          include: {
            user: { select: { id: true, username: true, email: true, firstName: true, lastName: true } },
            receipt: { select: { id: true, originalName: true, sizeBytes: true, uploadedAt: true } },
            review: true,
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limitNum,
        }),
        prisma.paymentOrder.count({ where }),
      ]);

      res.json({
        success: true,
        orders,
        pagination: { total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  static async getPayment(req: AuthenticatedRequest, res: Response) {
    try {
      const id = req.params.id as string;
      const order = await PaymentService.getOrderDetails(req.user!.id, id, true);
      res.json({ success: true, order });
    } catch (err: any) {
      res.status(404).json({ success: false, message: err.message });
    }
  }

  static async approvePayment(req: AuthenticatedRequest, res: Response) {
    try {
      const id = req.params.id as string;
      const { note } = req.body;
      const result = await PaymentService.adminApprovePayment(req.user!.id, id, note);
      res.json({ success: true, message: 'To‘lov tasdiqlandi va kreditlar yetkazildi', order: result });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }

  static async rejectPayment(req: AuthenticatedRequest, res: Response) {
    try {
      const id = req.params.id as string;
      const { reason } = req.body;
      if (!reason) {
        return res.status(400).json({ success: false, message: 'Rad etish sababi ko‘rsatilmadi' });
      }
      const result = await PaymentService.adminRejectPayment(req.user!.id, id, reason);
      res.json({ success: true, message: 'To‘lov rad etildi', order: result });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }

  static async getSalesAnalytics(req: AuthenticatedRequest, res: Response) {
    try {
      const { range = '30d' } = req.query;

      let days = 30;
      if (range === '7d') days = 7;
      if (range === '9d' || range === '90d') days = 90;

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      startDate.setHours(0, 0, 0, 0);

      const confirmedOrders = await prisma.paymentOrder.findMany({
        where: {
          status: PaymentOrderStatus.PAYMENT_CONFIRMED,
          updatedAt: { gte: startDate },
        },
        select: {
          packageCode: true,
          amountUzs: true,
          creditsToGrant: true,
          updatedAt: true,
        },
      });

      // Build daily map for Recharts line chart
      const dailyMap: Record<string, { date: string; PLUS: number; PRO: number; MAX: number; total: number; revenueUzs: number }> = {};

      for (let i = days - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = d.toISOString().split('T')[0];
        dailyMap[key] = { date: key, PLUS: 0, PRO: 0, MAX: 0, total: 0, revenueUzs: 0 };
      }

      const breakdown = {
        PLUS: { count: 0, revenue: 0, credits: 0 },
        PRO: { count: 0, revenue: 0, credits: 0 },
        MAX: { count: 0, revenue: 0, credits: 0 },
      };

      for (const ord of confirmedOrders) {
        const key = ord.updatedAt.toISOString().split('T')[0];
        if (dailyMap[key]) {
          dailyMap[key].total += 1;
          dailyMap[key].revenueUzs += ord.amountUzs;
          if (ord.packageCode === 'PLUS') dailyMap[key].PLUS += 1;
          if (ord.packageCode === 'PRO') dailyMap[key].PRO += 1;
          if (ord.packageCode === 'MAX') dailyMap[key].MAX += 1;
        }

        if (breakdown[ord.packageCode as keyof typeof breakdown]) {
          breakdown[ord.packageCode as keyof typeof breakdown].count += 1;
          breakdown[ord.packageCode as keyof typeof breakdown].revenue += ord.amountUzs;
          breakdown[ord.packageCode as keyof typeof breakdown].credits += ord.creditsToGrant;
        }
      }

      const chartData = Object.values(dailyMap);

      res.json({
        success: true,
        chartData,
        breakdown,
        totalRevenueUzs: confirmedOrders.reduce((sum, o) => sum + o.amountUzs, 0),
        totalOrdersCount: confirmedOrders.length,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  static async getAuditLogs(req: AuthenticatedRequest, res: Response) {
    try {
      const logs = await prisma.adminAuditLog.findMany({
        include: { admin: { select: { username: true, email: true, firstName: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      res.json({ success: true, logs });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  static async streamReceipt(req: AuthenticatedRequest, res: Response) {
    try {
      const orderId = req.params.orderId as string;
      const receipt = await prisma.paymentReceipt.findUnique({
        where: { orderId },
      });

      if (!receipt || !fs.existsSync(receipt.storedPath)) {
        return res.status(404).json({ success: false, message: 'Chek fayli topilmadi' });
      }

      res.setHeader('Content-Type', receipt.mimeType);
      fs.createReadStream(receipt.storedPath).pipe(res);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
}
