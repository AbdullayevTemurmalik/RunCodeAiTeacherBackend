import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { PaymentService } from '../services/payments/payment.service';
import { prisma } from '../prisma/client';

export class PaymentController {
  static async createOrder(req: AuthenticatedRequest, res: Response) {
    try {
      const { packageCode } = req.body;
      if (!packageCode) {
        return res.status(400).json({ success: false, message: 'Tarif tanlanmadi' });
      }
      const order = await PaymentService.createOrder(req.user!.id, packageCode);
      res.status(201).json({ success: true, order });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }

  static async getActiveOrder(req: AuthenticatedRequest, res: Response) {
    try {
      const active = await prisma.paymentOrder.findFirst({
        where: {
          userId: req.user!.id,
          status: {
            in: ['CREATED', 'AWAITING_PAYMENT', 'RECEIPT_SUBMITTED', 'UNDER_REVIEW'],
          },
          paymentExpiresAt: { gt: new Date() },
        },
      });

      if (!active) {
        return res.json({ success: true, hasActiveOrder: false });
      }

      const details = await PaymentService.getOrderDetails(req.user!.id, active.id);
      res.json({ success: true, hasActiveOrder: true, order: details });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  static async getOrder(req: AuthenticatedRequest, res: Response) {
    try {
      const id = req.params.id as string;
      const order = await PaymentService.getOrderDetails(req.user!.id, id);
      res.json({ success: true, order });
    } catch (err: any) {
      res.status(404).json({ success: false, message: err.message });
    }
  }

  static async selectMethod(req: AuthenticatedRequest, res: Response) {
    try {
      const id = req.params.id as string;
      const { method } = req.body;
      if (method !== 'CLICK' && method !== 'UZUM') {
        return res.status(400).json({ success: false, message: 'Faqat Click yoki Uzum Bank tanlanishi mumkin' });
      }
      const result = await PaymentService.selectPaymentMethod(req.user!.id, id, method);
      res.json({ success: true, ...result });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }

  static async cancelOrder(req: AuthenticatedRequest, res: Response) {
    try {
      const id = req.params.id as string;
      const { reason, comment } = req.body;
      const result = await PaymentService.cancelOrder(req.user!.id, id, reason, comment);
      res.json({ success: true, message: 'Buyurtma muvaffaqiyatli bekor qilindi', ...result });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }

  static async uploadReceipt(req: AuthenticatedRequest, res: Response) {
    try {
      const id = req.params.id as string;
      const file = req.file;
      if (!file) {
        return res.status(400).json({ success: false, message: 'Chek fayli yuklanmadi' });
      }
      const result = await PaymentService.submitReceipt(req.user!.id, id, {
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        path: file.path,
      });
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }

  static async getHistory(req: AuthenticatedRequest, res: Response) {
    try {
      const orders = await prisma.paymentOrder.findMany({
        where: { userId: req.user!.id },
        include: {
          receipt: { select: { id: true, originalName: true, uploadedAt: true } },
          review: { select: { decision: true, note: true, reviewedAt: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
      res.json({ success: true, orders });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
}
