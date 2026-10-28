import { Router } from 'express';
import { WritingController } from '../controllers/writing.controller';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();
router.use(authMiddleware);

router.post('/submit', WritingController.submitWriting);
router.get('/submissions', WritingController.getSubmissions);
router.get('/submissions/:id', WritingController.getSubmission);

export default router;
