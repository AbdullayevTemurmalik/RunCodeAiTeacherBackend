import { Router } from 'express';
import { PaymentController } from '../controllers/payment.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { env } from '../config/env';

const router = Router();

// Ensure receipts directory exists
const receiptsDir = path.resolve(process.cwd(), env.RECEIPT_PRIVATE_DIRECTORY);
if (!fs.existsSync(receiptsDir)) {
  fs.mkdirSync(receiptsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, receiptsDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, unique);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: env.PAYMENT_RECEIPT_MAX_SIZE_MB * 1024 * 1024 },
});

router.use(authMiddleware);

router.post('/orders', PaymentController.createOrder);
router.get('/active-order', PaymentController.getActiveOrder);
router.get('/orders/:id', PaymentController.getOrder);
router.post('/orders/:id/method', PaymentController.selectMethod);
router.post('/orders/:id/cancel', PaymentController.cancelOrder);
router.post('/orders/:id/receipt', upload.single('receipt'), PaymentController.uploadReceipt);
router.get('/history', PaymentController.getHistory);

export default router;
