import { Router } from 'express';
import authRoutes from './auth.routes';
import paymentRoutes from './payment.routes';
import writingRoutes from './writing.routes';
import essayRoutes from './essay.routes';
import speakingRoutes from './speaking.routes';
import creditsRoutes from './credits.routes';
import profileRoutes from './profile.routes';
import settingsRoutes from './settings.routes';
import notificationRoutes from './notification.routes';
import adminRoutes from './admin.routes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/payments', paymentRoutes);
router.use('/writing', writingRoutes);
router.use('/essays', essayRoutes);
router.use('/speaking', speakingRoutes);
router.use('/credits', creditsRoutes);
router.use('/profile', profileRoutes);
router.use('/settings', settingsRoutes);
router.use('/notifications', notificationRoutes);
router.use('/admin', adminRoutes);

// Health check endpoint
router.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'RunCodeAITeacher Backend API',
  });
});

export default router;
