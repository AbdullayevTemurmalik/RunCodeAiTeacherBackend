import { Router } from 'express';
import { CreditsController } from '../controllers/credits.controller';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();
router.use(authMiddleware);

router.get('/balance', CreditsController.getBalance);
router.get('/ledger', CreditsController.getLedger);
router.get('/packages', CreditsController.getPackages);

export default router;
