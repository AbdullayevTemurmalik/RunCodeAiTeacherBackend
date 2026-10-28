import { Router } from 'express';
import { EssayController } from '../controllers/essay.controller';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();
router.use(authMiddleware);

router.get('/tasks', EssayController.getTasks);
router.post('/generate-topic', EssayController.generateTopic);
router.post('/validate-words', EssayController.validateWords);
router.post('/submit', EssayController.submitEssay);
router.get('/submissions', EssayController.getSubmissions);
router.get('/submissions/:id', EssayController.getSubmission);

export default router;
