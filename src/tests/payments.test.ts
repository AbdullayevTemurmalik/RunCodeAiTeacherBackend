import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PaymentService } from '../services/payments/payment.service';
import { prisma } from '../prisma/client';
import { CreditService } from '../services/credits/credit.service';
import { PaymentOrderStatus, FulfillmentStatus } from '@prisma/client';

describe('Payment & Checkout Workflow', () => {
  let userId = '';
  let adminId = '';

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email: `paytest_${Date.now()}@example.com`,
        username: `paytest_${Date.now()}`,
        passwordHash: 'dummy',
        firstName: 'Payer',
        lastName: 'Test',
      },
    });
    userId = user.id;
    await CreditService.initializeSignupWallet(prisma, userId);

    const admin = await prisma.user.create({
      data: {
        email: `payadmin_${Date.now()}@example.com`,
        username: `payadmin_${Date.now()}`,
        passwordHash: 'dummy',
        firstName: 'Admin',
        lastName: 'Tester',
        role: 'ADMIN',
      },
    });
    adminId = admin.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { id: { in: [userId, adminId] } },
    });
  });

  it('creates an order and snapshots package prices and credits', async () => {
    const order = await PaymentService.createOrder(userId, 'PLUS');
    expect(order.orderId).toBeDefined();
    expect(order.amountUzs).toBe(15000);
    expect(order.totalCredits).toBe(220);
    expect(order.status).toBe(PaymentOrderStatus.CREATED);
    expect(order.method).toBe('UNSELECTED');
  });

  it('enforces SINGLE ACTIVE ORDER LOCK: blocks creating second order until current is resolved or canceled', async () => {
    // Attempting to create a second order while first is still pending must fail!
    await expect(
      PaymentService.createOrder(userId, 'PRO')
    ).rejects.toThrow('faol buyurtma mavjud');
  });

  it('selects payment method (Click or Uzum) and activates 30-minute timer and QR assets', async () => {
    const active = await prisma.paymentOrder.findFirst({
      where: { userId, status: PaymentOrderStatus.CREATED },
    });
    expect(active).toBeDefined();

    // Select Uzum Bank
    const uzum = await PaymentService.selectPaymentMethod(userId, active!.id, 'UZUM');
    expect(uzum.method).toBe('UZUM');
    expect(uzum.qrAssetUrl).toBe('/assets/payments/uzum_qr.png');
    expect(uzum.deepLinkUrl).toContain('b.2u.uz');
    expect(uzum.paymentExpiresAt).toBeDefined();

    // Verify 30-minute expiration window
    const durationMinutes = (new Date(uzum.paymentExpiresAt).getTime() - Date.now()) / (60 * 1000);
    expect(durationMinutes).toBeGreaterThan(28);
    expect(durationMinutes).toBeLessThanOrEqual(30);

    // Switch to Click
    const click = await PaymentService.selectPaymentMethod(userId, active!.id, 'CLICK');
    expect(click.method).toBe('CLICK');
    expect(click.qrAssetUrl).toBe('/assets/payments/click_qr.png');
    expect(click.deepLinkUrl).toContain('my.click.uz');
  });

  it('allows canceling order with mandatory reason and restores eligibility to create new order', async () => {
    const active = await prisma.paymentOrder.findFirst({
      where: { userId, status: PaymentOrderStatus.AWAITING_PAYMENT },
    });
    expect(active).toBeDefined();

    // Cancel order
    const cancelRes = await PaymentService.cancelOrder(
      userId,
      active!.id,
      'Boshqa tarifni tanlamoqchiman'
    );
    expect(cancelRes.success).toBe(true);
    expect(cancelRes.status).toBe(PaymentOrderStatus.CANCELLED);

    // Now user can create a new order (e.g. PRO)
    const newOrder = await PaymentService.createOrder(userId, 'PRO');
    expect(newOrder.totalCredits).toBe(550);
    expect(newOrder.amountUzs).toBe(30000);
  });

  it('handles admin approval and atomically delivers package credits with ledger entry', async () => {
    const active = await prisma.paymentOrder.findFirst({
      where: { userId, status: PaymentOrderStatus.CREATED },
    });
    expect(active).toBeDefined();

    // User submits receipt (simulated record)
    await prisma.paymentOrder.update({
      where: { id: active!.id },
      data: { status: PaymentOrderStatus.UNDER_REVIEW },
    });

    const beforeWallet = await CreditService.getWallet(userId);
    expect(beforeWallet?.balanceCredits).toBe(100);

    // Admin approves
    await PaymentService.adminApprovePayment(adminId, active!.id, 'Tekshirildi va tasdiqlandi');

    const afterOrder = await prisma.paymentOrder.findUnique({
      where: { id: active!.id },
    });
    expect(afterOrder?.status).toBe(PaymentOrderStatus.PAYMENT_CONFIRMED);
    expect(afterOrder?.fulfillmentStatus).toBe(FulfillmentStatus.FULFILLED);

    // Check credits granted: 100 base + 550 (PRO: 500 base + 50 bonus) = 650
    const afterWallet = await CreditService.getWallet(userId);
    expect(afterWallet?.balanceCredits).toBe(650);
    expect(afterWallet?.paidCredits).toBe(500);
    expect(afterWallet?.bonusCredits).toBe(50);

    // User tier upgraded to PRO
    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.tier).toBe('PRO');

    // Duplicate approval attempt must be blocked
    await expect(
      PaymentService.adminApprovePayment(adminId, active!.id)
    ).rejects.toThrow('allaqachon to‘ldirilgan');
  });
});
