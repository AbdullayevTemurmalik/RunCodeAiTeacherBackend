import { Router } from 'express';
import { WritingController } from '../controllers/writing.controller';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();
router.use(authMiddleware);

router.post('/live-check', WritingController.liveCheck);
router.post('/drafts', WritingController.saveDraft);
router.post('/submit', WritingController.submitWriting);
router.post('/submissions', WritingController.submitWriting);
router.get('/submissions', WritingController.getSubmissions);
router.get('/submissions/:id', WritingController.getSubmission);
router.get('/history', WritingController.getSubmissions);

export default router;
