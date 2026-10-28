import { Router } from 'express';
import { NotificationController } from '../controllers/notification.controller';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();
router.use(authMiddleware);

router.get('/', NotificationController.getNotifications);
router.put('/read-all', NotificationController.markAllRead);
router.put('/:id/read', NotificationController.markAsRead);

export default router;
