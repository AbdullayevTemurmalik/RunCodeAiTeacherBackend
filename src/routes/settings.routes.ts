import { Router } from 'express';
import { SettingsController } from '../controllers/settings.controller';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();
router.use(authMiddleware);

router.get('/', SettingsController.getSettings);
router.put('/', SettingsController.updateSettings);

export default router;
