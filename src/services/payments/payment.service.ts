import { prisma } from '../../prisma/client';
import { env } from '../../config/env';
import { CreditService } from '../credits/credit.service';
import { PaymentOrderStatus, FulfillmentStatus, PaymentMethod, PaymentReviewDecision } from '@prisma/client';
import fs from 'fs';
import path from 'path';

export class PaymentService {
  /**
   * Create new payment order with Single Active Order Lock
   */
  static async createOrder(userId: string, packageCode: string): Promise<any> {
    const pkg = await prisma.creditPackage.findUnique({
      where: { code: packageCode, isActive: true },
    });

    if (!pkg) {
      throw new Error('Tanlangan tarif paketi topilmadi');
    }

    if (pkg.priceUzs === 0) {
      throw new Error('Bepul paket uchun to‘lov buyurtmasi yaratilmaydi');
    }

    // SINGLE ACTIVE ORDER LOCK:
    // Check if user has an existing unfinished order
    const activeOrder = await prisma.paymentOrder.findFirst({
      where: {
        userId,
        status: {
          in: [
            PaymentOrderStatus.CREATED,
            PaymentOrderStatus.AWAITING_PAYMENT,
            PaymentOrderStatus.RECEIPT_SUBMITTED,
            PaymentOrderStatus.UNDER_REVIEW,
          ],
        },
        paymentExpiresAt: { gt: new Date() },
      },
      include: { review: true },
    });

    if (activeOrder) {
      throw new Error(
        `Sizda to‘lanmagan faol buyurtma mavjud (#${activeOrder.orderNumber}). Yangi buyurtma ochish uchun avval mavjud buyurtmani yakunlang yoki bekor qiling.`
      );
    }

    const orderNumber = `RC-${Date.now().toString(36).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const paymentExpiresAt = new Date(Date.now() + env.MANUAL_PAYMENT_WINDOW_MINUTES * 60 * 1000);

    const order = await prisma.paymentOrder.create({
      data: {
        orderNumber,
        userId,
        packageCode: pkg.code,
        amountUzs: pkg.priceUzs,
        creditsToGrant: pkg.totalCredits,
        status: PaymentOrderStatus.CREATED,
        method: PaymentMethod.UNSELECTED,
        paymentExpiresAt,
      },
    });

    await prisma.paymentEvent.create({
      data: {
        orderId: order.id,
        eventType: 'ORDER_CREATED',
        details: { packageCode: pkg.code, amountUzs: pkg.priceUzs },
      },
    });

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      packageName: pkg.name,
      baseCredits: pkg.baseCredits,
      bonusCredits: pkg.bonusCredits,
      totalCredits: pkg.totalCredits,
      amountUzs: pkg.priceUzs,
      status: order.status,
      method: order.method,
      paymentExpiresAt: order.paymentExpiresAt,
      serverTime: new Date(),
    };
  }

  /**
   * Select payment method (Click or Uzum Bank) and activate QR display
   */
  static async selectPaymentMethod(userId: string, orderId: string, method: 'CLICK' | 'UZUM'): Promise<any> {
    const order = await prisma.paymentOrder.findFirst({
      where: { id: orderId, userId },
    });

    if (!order) {
      throw new Error('Buyurtma topilmadi');
    }

    if (order.status !== PaymentOrderStatus.CREATED && order.status !== PaymentOrderStatus.AWAITING_PAYMENT) {
      throw new Error('Ushbu buyurtma holati uchun to‘lov usulini o‘zgartirib bo‘lmaydi');
    }

    if (order.paymentExpiresAt < new Date()) {
      await prisma.paymentOrder.update({
        where: { id: order.id },
        data: { status: PaymentOrderStatus.EXPIRED },
      });
      throw new Error('To‘lov vaqti tugagan (30 daqiqa). Yangi buyurtma yarating.');
    }

    const pMethod = method === 'CLICK' ? PaymentMethod.CLICK : PaymentMethod.UZUM;
    const providerSetting = await prisma.paymentProviderSetting.findUnique({
      where: { provider: method },
    });

    const qrAsset = method === 'CLICK'
      ? (providerSetting?.qrAssetUrl || env.CLICK_PAYMENT_QR_ASSET)
      : (providerSetting?.qrAssetUrl || env.UZUM_PAYMENT_QR_ASSET);

    const deepLinkUrl = method === 'CLICK'
      ? (providerSetting?.deepLinkUrl || env.CLICK_PAYMENT_URL)
      : (providerSetting?.deepLinkUrl || env.UZUM_PAYMENT_URL);

    // Refresh 30-minute timer from moment of method selection
    const paymentExpiresAt = new Date(Date.now() + env.MANUAL_PAYMENT_WINDOW_MINUTES * 60 * 1000);

    const updated = await prisma.paymentOrder.update({
      where: { id: orderId },
      data: {
        method: pMethod,
        status: PaymentOrderStatus.AWAITING_PAYMENT,
        paymentExpiresAt,
      },
    });

    await prisma.paymentEvent.create({
      data: {
        orderId: order.id,
        eventType: 'METHOD_SELECTED',
        details: { method },
      },
    });

    return {
      orderId: updated.id,
      orderNumber: updated.orderNumber,
      amountUzs: updated.amountUzs,
      method: updated.method,
      status: updated.status,
      paymentExpiresAt: updated.paymentExpiresAt,
      serverTime: new Date(),
      qrAssetUrl: qrAsset,
      deepLinkUrl,
    };
  }

  /**
   * Cancel payment order with mandatory reason
   */
  static async cancelOrder(
    userId: string,
    orderId: string,
    reason: string,
    comment?: string
  ): Promise<any> {
    const validReasons = [
      'Boshqa to‘lov usulini tanlamoqchiman',
      'Buyurtmani adashib rasmiylashtirdim',
      'Boshqa tarifni tanlamoqchiman',
      'Boshqa sabab',
    ];

    if (!reason || reason.trim().length === 0) {
      throw new Error('Bekor qilish sababi ko‘rsatilmadi');
    }

    if (reason === 'Boshqa sabab') {
      if (!comment || comment.trim().length === 0) {
        throw new Error('Iltimos, bekor qilish sababini yozib qoldiring');
      }
      const words = comment.trim().split(/\s+/).length;
      if (words > 50) {
        throw new Error('Izoh maksimal 50 ta so‘zdan iborat bo‘lishi kerak');
      }
    }

    const order = await prisma.paymentOrder.findFirst({
      where: { id: orderId, userId },
    });

    if (!order) {
      throw new Error('Buyurtma topilmadi');
    }

    if (
      order.status === PaymentOrderStatus.PAYMENT_CONFIRMED ||
      order.status === PaymentOrderStatus.UNDER_REVIEW
    ) {
      throw new Error('Tekshiruvdagi yoki tasdiqlangan to‘lovni to‘g‘ridan-to‘g‘ri bekor qilib bo‘lmaydi');
    }

    const updated = await prisma.paymentOrder.update({
      where: { id: orderId },
      data: {
        status: PaymentOrderStatus.CANCELLED,
        cancelReason: reason,
        cancelComment: comment?.trim() || null,
      },
    });

    await prisma.paymentEvent.create({
      data: {
        orderId,
        eventType: 'ORDER_CANCELLED',
        details: { reason, comment },
      },
    });

    return { success: true, status: updated.status };
  }

  /**
   * Save uploaded payment receipt and put order into review
   */
  static async submitReceipt(
    userId: string,
    orderId: string,
    file: { originalname: string; mimetype: string; size: number; path: string }
  ): Promise<any> {
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'application/pdf'];
    if (!allowedTypes.includes(file.mimetype)) {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      throw new Error('Faqat PNG, JPG, JPEG, WEBP yoki PDF formatidagi cheklar qabul qilinadi');
    }

    const maxBytes = env.PAYMENT_RECEIPT_MAX_SIZE_MB * 1024 * 1024;
    if (file.size > maxBytes) {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      throw new Error(`Chek hajmi ${env.PAYMENT_RECEIPT_MAX_SIZE_MB} MB dan oshmasligi kerak`);
    }

    const order = await prisma.paymentOrder.findFirst({
      where: { id: orderId, userId },
    });

    if (!order) {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      throw new Error('Buyurtma topilmadi');
    }

    if (order.status === PaymentOrderStatus.CANCELLED || order.status === PaymentOrderStatus.EXPIRED) {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      throw new Error('Muddati o‘tgan yoki bekor qilingan buyurtmaga chek yuklab bo‘lmaydi');
    }

    return prisma.$transaction(async (tx) => {
      // Save receipt record
      const receipt = await tx.paymentReceipt.upsert({
        where: { orderId },
        update: {
          originalName: file.originalname,
          mimeType: file.mimetype,
          sizeBytes: file.size,
          storedPath: file.path,
          uploadedAt: new Date(),
        },
        create: {
          orderId,
          originalName: file.originalname,
          mimeType: file.mimetype,
          sizeBytes: file.size,
          storedPath: file.path,
        },
      });

      // Update order status to UNDER_REVIEW
      const updatedOrder = await tx.paymentOrder.update({
        where: { id: orderId },
        data: {
          status: PaymentOrderStatus.UNDER_REVIEW,
        },
      });

      await tx.paymentEvent.create({
        data: {
          orderId,
          eventType: 'RECEIPT_UPLOADED',
          details: { originalName: file.originalname, sizeBytes: file.size },
        },
      });

      // Send in-app notification
      await tx.notification.create({
        data: {
          userId,
          title: "To'lov cheki qabul qilindi",
          message: "Chekingiz qabul qilindi! To‘lovingiz odatda 1–2 soat ichida administratorlar tomonidan tekshiriladi.",
          type: 'PURCHASE_PENDING',
          link: `/payment/checkout/${orderId}`,
        },
      });

      return {
        success: true,
        receiptId: receipt.id,
        orderStatus: updatedOrder.status,
        message: "Chekingiz qabul qilindi! To‘lovingiz odatda 1–2 soat ichida administratorlar tomonidan tekshiriladi.",
      };
    });
  }

  /**
   * Get single order details with real-time countdown sync
   */
  static async getOrderDetails(userId: string, orderId: string, isAdmin = false): Promise<any> {
    const where: any = { id: orderId };
    if (!isAdmin) {
      where.userId = userId;
    }

    const order = await prisma.paymentOrder.findFirst({
      where,
      include: {
        receipt: true,
        review: true,
        user: {
          select: { id: true, username: true, email: true, firstName: true, lastName: true },
        },
      },
    });

    if (!order) {
      throw new Error('Buyurtma topilmadi');
    }

    // Check expiration dynamically
    if (
      (order.status === PaymentOrderStatus.CREATED || order.status === PaymentOrderStatus.AWAITING_PAYMENT) &&
      order.paymentExpiresAt < new Date()
    ) {
      await prisma.paymentOrder.update({
        where: { id: order.id },
        data: { status: PaymentOrderStatus.EXPIRED },
      });
      order.status = PaymentOrderStatus.EXPIRED;
    }

    const pkg = await prisma.creditPackage.findUnique({ where: { code: order.packageCode } });

    let qrAssetUrl = null;
    let deepLinkUrl = null;
    if (order.method === PaymentMethod.CLICK) {
      qrAssetUrl = env.CLICK_PAYMENT_QR_ASSET;
      deepLinkUrl = env.CLICK_PAYMENT_URL;
    } else if (order.method === PaymentMethod.UZUM) {
      qrAssetUrl = env.UZUM_PAYMENT_QR_ASSET;
      deepLinkUrl = env.UZUM_PAYMENT_URL;
    }

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      packageCode: order.packageCode,
      packageName: pkg?.name || order.packageCode,
      baseCredits: pkg?.baseCredits,
      bonusCredits: pkg?.bonusCredits,
      totalCredits: order.creditsToGrant,
      amountUzs: order.amountUzs,
      status: order.status,
      fulfillmentStatus: order.fulfillmentStatus,
      method: order.method,
      paymentExpiresAt: order.paymentExpiresAt,
      serverTime: new Date(),
      qrAssetUrl,
      deepLinkUrl,
      receipt: order.receipt
        ? {
            id: order.receipt.id,
            originalName: order.receipt.originalName,
            sizeBytes: order.receipt.sizeBytes,
            mimeType: order.receipt.mimeType,
            uploadedAt: order.receipt.uploadedAt,
          }
        : null,
      review: order.review,
      user: order.user,
      cancelReason: order.cancelReason,
      cancelComment: order.cancelComment,
    };
  }

  /**
   * ADMIN ACTION: Approve manual payment and fulfill credits
   */
  static async adminApprovePayment(adminId: string, orderId: string, note?: string): Promise<any> {
    return prisma.$transaction(async (tx) => {
      const order = await tx.paymentOrder.findUnique({
        where: { id: orderId },
      });

      if (!order) {
        throw new Error('Buyurtma topilmadi');
      }

      if (order.fulfillmentStatus === FulfillmentStatus.FULFILLED) {
        throw new Error('Ushbu buyurtma allaqachon to‘ldirilgan');
      }

      // Mark payment confirmed & fulfilled
      const updated = await tx.paymentOrder.update({
        where: { id: orderId },
        data: {
          status: PaymentOrderStatus.PAYMENT_CONFIRMED,
          fulfillmentStatus: FulfillmentStatus.FULFILLED,
        },
      });

      // Create/Update review
      await tx.paymentReview.upsert({
        where: { orderId },
        update: {
          adminId,
          decision: PaymentReviewDecision.APPROVED,
          note: note || 'Administrator tomonidan tasdiqlandi',
          reviewedAt: new Date(),
        },
        create: {
          orderId,
          adminId,
          decision: PaymentReviewDecision.APPROVED,
          note: note || 'Administrator tomonidan tasdiqlandi',
        },
      });

      // Grant package credits to user
      await CreditService.fulfillPackageCredits(tx, order.userId, order.packageCode, order.orderNumber);

      // Log audit
      await tx.adminAuditLog.create({
        data: {
          adminId,
          action: 'PAYMENT_APPROVE',
          targetType: 'PaymentOrder',
          targetId: orderId,
          details: { orderNumber: order.orderNumber, amountUzs: order.amountUzs, note },
        },
      });

      return updated;
    });
  }

  /**
   * ADMIN ACTION: Reject manual payment
   */
  static async adminRejectPayment(adminId: string, orderId: string, reason: string): Promise<any> {
    return prisma.$transaction(async (tx) => {
      const order = await tx.paymentOrder.findUnique({ where: { id: orderId } });
      if (!order) throw new Error('Buyurtma topilmadi');

      if (order.fulfillmentStatus === FulfillmentStatus.FULFILLED) {
        throw new Error('Tasdiqlangan va to‘ldirilgan buyurtmani rad etib bo‘lmaydi');
      }

      const updated = await tx.paymentOrder.update({
        where: { id: orderId },
        data: {
          status: PaymentOrderStatus.REJECTED,
        },
      });

      await tx.paymentReview.upsert({
        where: { orderId },
        update: {
          adminId,
          decision: PaymentReviewDecision.REJECTED,
          note: reason,
          reviewedAt: new Date(),
        },
        create: {
          orderId,
          adminId,
          decision: PaymentReviewDecision.REJECTED,
          note: reason,
        },
      });

      await tx.notification.create({
        data: {
          userId: order.userId,
          title: "To'lov cheki qabul qilinmadi",
          message: `Buyurtmangiz (#${order.orderNumber}) bo‘yicha taqdim etilgan chek ma’murlar tomonidan rad etildi. Sabab: ${reason}`,
          type: 'PURCHASE_FAILED',
          link: `/payment/checkout/${orderId}`,
        },
      });

      await tx.adminAuditLog.create({
        data: {
          adminId,
          action: 'PAYMENT_REJECT',
          targetType: 'PaymentOrder',
          targetId: orderId,
          details: { orderNumber: order.orderNumber, reason },
        },
      });

      return updated;
    });
  }
}
