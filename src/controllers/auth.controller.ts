import { Request, Response } from 'express';
import { AuthService } from '../services/auth/auth.service';
import { env } from '../config/env';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { CreditService } from '../services/credits/credit.service';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: env.SESSION_MAX_AGE_HOURS * 60 * 60 * 1000,
};

export class AuthController {
  static async checkUsername(req: Request, res: Response) {
    try {
      const { username } = req.body;
      if (!username) {
        return res.status(400).json({ success: false, message: 'Username kiritilmadi' });
      }
      const result = await AuthService.validateUsername(username);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  static async sendOtp(req: Request, res: Response) {
    try {
      const { email } = req.body;
      if (!email) {
        return res.status(400).json({ success: false, message: 'Email manzili kiritilmadi' });
      }
      const result = await AuthService.sendRegistrationOtp(email);
      if (!result.success) {
        return res.status(400).json(result);
      }
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  static async verifyOtp(req: Request, res: Response) {
    try {
      const { email, otp } = req.body;
      if (!email || !otp) {
        return res.status(400).json({ success: false, message: 'Email va tasdiqlash kodi kiritilmadi' });
      }
      const result = await AuthService.verifyRegistrationOtp(email, otp);
      if (!result.success) {
        return res.status(400).json(result);
      }
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  static async register(req: Request, res: Response) {
    try {
      const { firstName, lastName, age, username, email, password, otp } = req.body;

      // Verify OTP again on registration completion to prevent bypass
      const otpVerify = await AuthService.verifyRegistrationOtp(email, otp);
      if (!otpVerify.success) {
        return res.status(400).json({ success: false, message: 'Email tasdiqlanmagan yoki kod noto‘g‘ri' });
      }

      const ipAddress = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress;
      const userAgent = req.headers['user-agent'];

      const result = await AuthService.completeRegistration(
        { firstName, lastName, age: age ? Number(age) : undefined, username, email, password, otp },
        ipAddress,
        userAgent
      );

      res.cookie('runcode_session', result.sessionToken, COOKIE_OPTIONS);
      res.status(201).json({
        success: true,
        user: result.user,
        sessionToken: result.sessionToken,
        message: 'Muvaffaqiyatli ro‘yxatdan o‘tdingiz! Sizga 100 ta bepul kredit taqdim etildi.',
      });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }

  static async login(req: Request, res: Response) {
    try {
      const { identifier, password } = req.body;
      if (!identifier || !password) {
        return res.status(400).json({ success: false, message: 'Login va parol kiritilishi shart' });
      }

      const ipAddress = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress;
      const userAgent = req.headers['user-agent'];

      const result = await AuthService.login(identifier, password, ipAddress, userAgent);

      res.cookie('runcode_session', result.sessionToken, COOKIE_OPTIONS);
      res.json({
        success: true,
        user: result.user,
        sessionToken: result.sessionToken,
        priorSessionRevoked: result.priorSessionRevoked,
      });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }

  static async logout(req: AuthenticatedRequest, res: Response) {
    try {
      if (req.sessionToken) {
        await AuthService.logout(req.sessionToken);
      }
      res.clearCookie('runcode_session');
      res.json({ success: true, message: 'Tizimdan chiqildi' });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  static async forgotPassword(req: Request, res: Response) {
    try {
      const { email } = req.body;
      if (!email) {
        return res.status(400).json({ success: false, message: 'Email manzili kiritilmadi' });
      }
      const result = await AuthService.sendPasswordRecoveryOtp(email);
      res.json({
        success: true,
        message: 'Agar ushbu email ro‘yxatdan o‘tgan bo‘lsa, tasdiqlash kodi yuborildi.',
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  static async verifyRecoveryOtp(req: Request, res: Response) {
    try {
      const { email, otp } = req.body;
      if (!email || !otp) {
        return res.status(400).json({ success: false, message: 'Email va kod kiritilmadi' });
      }
      const result = await AuthService.verifyPasswordRecoveryOtp(email, otp);
      if (!result.success) {
        return res.status(400).json(result);
      }
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  static async resetPassword(req: Request, res: Response) {
    try {
      const { resetToken, newPassword } = req.body;
      if (!resetToken || !newPassword) {
        return res.status(400).json({ success: false, message: 'Tiklash kodi va yangi parol kiritilmadi' });
      }
      const result = await AuthService.resetPassword(resetToken, newPassword);
      if (!result.success) {
        return res.status(400).json(result);
      }
      res.json({ success: true, message: 'Parolingiz muvaffaqiyatli yangilandi. Yangi parol bilan kiring.' });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  static async getMe(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, message: 'Autentifikatsiya qilinmagan' });
      }
      const wallet = await CreditService.getWallet(req.user.id);
      res.json({
        success: true,
        user: {
          ...req.user,
          wallet,
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
}
