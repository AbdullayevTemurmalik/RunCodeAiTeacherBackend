import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();

router.post('/check-username', AuthController.checkUsername);
router.post('/send-otp', AuthController.sendOtp);
router.post('/verify-otp', AuthController.verifyOtp);
router.post('/register', AuthController.register);
router.post('/login', AuthController.login);
router.post('/logout', authMiddleware, AuthController.logout);
router.post('/forgot-password', AuthController.forgotPassword);
router.post('/verify-recovery-otp', AuthController.verifyRecoveryOtp);
router.post('/reset-password', AuthController.resetPassword);
router.get('/me', authMiddleware, AuthController.getMe);

export default router;
