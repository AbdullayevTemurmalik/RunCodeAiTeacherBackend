import { Router } from 'express';
import { TypingController } from '../controllers/typing.controller';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();
router.use(authMiddleware);

router.post('/tests', TypingController.createTest);
router.post('/start', TypingController.createTest);
router.post('/tests/:id/complete', TypingController.completeTest);
router.post('/complete/:id', TypingController.completeTest);
router.get('/history', TypingController.getHistory);
router.get('/stats', TypingController.getStats);
router.get('/personal-bests', TypingController.getPersonalBests);
router.get('/bests', TypingController.getPersonalBests);

export default router;
