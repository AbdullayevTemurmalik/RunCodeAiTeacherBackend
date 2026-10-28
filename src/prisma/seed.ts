import { PrismaClient, Role, Tier, UserStatus, PaymentMethod } from '@prisma/client';
import bcrypt from 'bcrypt';
import { env } from '../config/env';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding initial data...');

  // 1. Credit Packages
  const packages = [
    {
      code: 'FREE',
      name: 'Boshlang\'ich (FREE)',
      baseCredits: 100,
      bonusCredits: 0,
      totalCredits: 100,
      priceUzs: 0,
      sortOrder: 1,
    },
    {
      code: 'PLUS',
      name: 'PLUS Tarif',
      baseCredits: env.PLUS_BASE_CREDITS,
      bonusCredits: env.PLUS_BONUS_CREDITS,
      totalCredits: env.PLUS_BASE_CREDITS + env.PLUS_BONUS_CREDITS,
      priceUzs: env.PLUS_PRICE_UZS,
      sortOrder: 2,
    },
    {
      code: 'PRO',
      name: 'PRO Tarif',
      baseCredits: env.PRO_BASE_CREDITS,
      bonusCredits: env.PRO_BONUS_CREDITS,
      totalCredits: env.PRO_BASE_CREDITS + env.PRO_BONUS_CREDITS,
      priceUzs: env.PRO_PRICE_UZS,
      sortOrder: 3,
    },
    {
      code: 'MAX',
      name: 'MAX Tarif',
      baseCredits: env.MAX_BASE_CREDITS,
      bonusCredits: env.MAX_BONUS_CREDITS,
      totalCredits: env.MAX_BASE_CREDITS + env.MAX_BONUS_CREDITS,
      priceUzs: env.MAX_PRICE_UZS,
      sortOrder: 4,
    },
  ];

  for (const pkg of packages) {
    await prisma.creditPackage.upsert({
      where: { code: pkg.code },
      update: pkg,
      create: pkg,
    });
  }
  console.log('Credit packages seeded.');

  // 2. Default Administrator
  const adminEmail = env.ADMIN_EMAIL || 'admin@runcode.uz';
  const adminUsername = env.ADMIN_USERNAME || 'temur';
  const adminPassword = env.ADMIN_PASSWORD || 'Temur20';
  const passwordHash = await bcrypt.hash(adminPassword, env.BCRYPT_COST_FACTOR);

  const existingAdmin = await prisma.user.findFirst({
    where: {
      OR: [
        { email: adminEmail },
        { username: adminUsername },
        { role: Role.ADMIN },
      ],
    },
  });

  if (existingAdmin) {
    await prisma.user.update({
      where: { id: existingAdmin.id },
      data: {
        email: adminEmail,
        username: adminUsername,
        passwordHash,
        role: Role.ADMIN,
        status: UserStatus.ACTIVE,
      },
    });
    console.log(`Admin user synchronized: username=${adminUsername}, email=${adminEmail}`);
  } else {
    const adminUser = await prisma.user.create({
      data: {
        email: adminEmail,
        username: adminUsername,
        passwordHash,
        firstName: 'Temurmalik',
        lastName: 'Admin',
        role: Role.ADMIN,
        tier: Tier.MAX,
        status: UserStatus.ACTIVE,
        language: 'uz',
        theme: 'dark',
      },
    });

    const adminUnits = BigInt(10000000); // 10,000 credits
    await prisma.creditWallet.create({
      data: {
        userId: adminUser.id,
        balanceUnits: adminUnits,
        freeUnits: adminUnits,
        paidUnits: BigInt(0),
        bonusUnits: BigInt(0),
        rewardUnits: BigInt(0),
        lifetimeEarnedUnits: adminUnits,
        lifetimeSpentUnits: BigInt(0),
      },
    });

    console.log(`Admin user created: username=${adminUsername}, email=${adminEmail}`);
  }

  // 3. Payment Provider Settings
  await prisma.paymentProviderSetting.upsert({
    where: { provider: 'CLICK' },
    update: {
      isEnabled: env.CLICK_PAYMENT_ENABLED,
      qrAssetUrl: env.CLICK_PAYMENT_QR_ASSET,
      deepLinkUrl: env.CLICK_PAYMENT_URL,
    },
    create: {
      provider: 'CLICK',
      isEnabled: env.CLICK_PAYMENT_ENABLED,
      qrAssetUrl: env.CLICK_PAYMENT_QR_ASSET,
      deepLinkUrl: env.CLICK_PAYMENT_URL,
    },
  });

  await prisma.paymentProviderSetting.upsert({
    where: { provider: 'UZUM' },
    update: {
      isEnabled: env.UZUM_PAYMENT_ENABLED,
      qrAssetUrl: env.UZUM_PAYMENT_QR_ASSET,
      deepLinkUrl: env.UZUM_PAYMENT_URL,
    },
    create: {
      provider: 'UZUM',
      isEnabled: env.UZUM_PAYMENT_ENABLED,
      qrAssetUrl: env.UZUM_PAYMENT_QR_ASSET,
      deepLinkUrl: env.UZUM_PAYMENT_URL,
    },
  });
  console.log('Payment provider settings seeded.');

  // 4. Sample Essay Tasks
  const sampleTasks = [
    {
      level: 'A2',
      category: 'Hobbies & Lifestyle',
      targetWordCount: 30,
      difficulty: 'Elementary',
      title: 'My Favorite Hobby',
      instructions: 'Write a short paragraph about your favorite leisure activity. You MUST use all 6 mandatory words.',
      requiredWords: ['enjoy', 'practice', 'interesting', 'improve', 'happy', 'free'],
    },
    {
      level: 'B1',
      category: 'Technology & Future',
      targetWordCount: 50,
      difficulty: 'Intermediate',
      title: 'How Technology Helps Us Learn',
      instructions: 'Describe the role of computers and mobile apps in modern language learning. Include every mandatory word.',
      requiredWords: ['learning', 'technology', 'skills', 'daily', 'future', 'convenient', 'practice'],
    },
    {
      level: 'B2',
      category: 'Education & Career',
      targetWordCount: 100,
      difficulty: 'Upper Intermediate',
      title: 'The Power of Speaking English Fluently',
      instructions: 'Explain how foreign language proficiency expands career and personal opportunities across the globe.',
      requiredWords: ['global', 'opportunity', 'communication', 'career', 'confidence', 'achieve', 'knowledge', 'international'],
    },
  ];

  for (const t of sampleTasks) {
    const existing = await prisma.essayTask.findFirst({
      where: { title: t.title },
    });
    if (!existing) {
      await prisma.essayTask.create({ data: t });
    }
  }
  console.log('Sample essay tasks seeded.');

  console.log('Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
