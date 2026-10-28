import { Router } from 'express';
import { AdminController } from '../controllers/admin.controller';
import { authMiddleware, requireAdmin } from '../middleware/auth.middleware';

const router = Router();
router.use(authMiddleware, requireAdmin);

router.get('/dashboard', AdminController.getDashboard);
router.get('/users', AdminController.getUsers);
router.get('/users/:id', AdminController.getUser);
router.put('/users/:id', AdminController.updateUser);
router.delete('/users/:id', AdminController.deleteUser);
router.put('/users/:id/status', AdminController.updateUserStatus);
router.post('/users/:id/credits', AdminController.adjustCredits);

router.get('/payments', AdminController.getPayments);
router.get('/payments/:id', AdminController.getPayment);
router.post('/payments/:id/approve', AdminController.approvePayment);
router.post('/payments/:id/reject', AdminController.rejectPayment);
router.get('/receipts/:orderId', AdminController.streamReceipt);

router.get('/analytics/sales', AdminController.getSalesAnalytics);
router.get('/audit-logs', AdminController.getAuditLogs);

export default router;
