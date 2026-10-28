import { Router } from 'express';
import { ProfileController } from '../controllers/profile.controller';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();
router.use(authMiddleware);

router.get('/', ProfileController.getProfile);
router.put('/', ProfileController.updateProfile);

export default router;
