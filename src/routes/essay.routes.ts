import { Router } from 'express';
import { EssayController } from '../controllers/essay.controller';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();
router.use(authMiddleware);

router.get('/tasks', EssayController.getTasks);
router.get('/tasks/:id', EssayController.getTask);
router.post('/generate-topic', EssayController.generateTopic);
router.post('/tasks/generate', EssayController.generateTopic);
router.post('/validate-words', EssayController.validateWords);
router.post('/tasks/:id/validate', EssayController.validateWords);
router.put('/tasks/:id/draft', EssayController.saveDraft);
router.get('/tasks/:id/draft', EssayController.getDraft);
router.post('/submit', EssayController.submitEssay);
router.post('/tasks/:id/submit', (req, res, next) => {
  req.body.taskId = req.params.id;
  EssayController.submitEssay(req, res);
});
router.get('/submissions', EssayController.getSubmissions);
router.get('/submissions/:id', EssayController.getSubmission);
router.get('/history', EssayController.getSubmissions);

export default router;
