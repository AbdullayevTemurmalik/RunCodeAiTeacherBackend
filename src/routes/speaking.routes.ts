import { Router } from 'express';
import { SpeakingController } from '../controllers/speaking.controller';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();
router.use(authMiddleware);

router.get('/sessions', SpeakingController.getSessions);
router.get('/sessions/:id', SpeakingController.getSession);

export default router;
