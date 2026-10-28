import { Request, Response, NextFunction } from 'express';
import { prisma } from '../prisma/client';
import { hashSessionToken } from '../utils/crypto';
import { Role, UserStatus } from '@prisma/client';

export interface AuthenticatedUser {
  id: string;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  role: Role;
  tier: string;
  status: UserStatus;
  language: string;
  theme: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
  sessionToken?: string;
  sessionId?: string;
}

export async function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.runcode_session || req.headers.authorization?.replace(/^Bearer\s+/i, '');

  if (!token) {
    res.status(401).json({
      success: false,
      code: 'UNAUTHORIZED',
      message: 'Iltimos, avval tizimga kiring',
    });
    return;
  }

  const tokenHash = hashSessionToken(token);

  try {
    const session = await prisma.userSession.findUnique({
      where: { tokenHash },
      include: {
        user: true,
      },
    });

    if (!session) {
      res.clearCookie('runcode_session');
      res.status(401).json({
        success: false,
        code: 'INVALID_SESSION',
        message: 'Sessiya topilmadi. Qaytadan kiring.',
      });
      return;
    }

    // Check if session was revoked (e.g. login from second device)
    if (!session.isActive || (session.revokedAt !== null)) {
      res.clearCookie('runcode_session');
      res.status(401).json({
        success: false,
        code: 'SESSION_REVOKED',
        message: 'Akkauntingizga boshqa qurilmadan kirildi. Xavfsizlik qoidalariga ko‘ra avvalgi sessiya yakunlandi.',
      });
      return;
    }

    // Check expiration
    if (session.expiresAt < new Date()) {
      res.clearCookie('runcode_session');
      res.status(401).json({
        success: false,
        code: 'SESSION_EXPIRED',
        message: 'Sessiya muddati tugadi. Iltimos, qayta kiring.',
      });
      return;
    }

    // Check user status
    if (session.user.status === UserStatus.SUSPENDED) {
      res.clearCookie('runcode_session');
      res.status(403).json({
        success: false,
        code: 'USER_SUSPENDED',
        message: 'Hisobingiz ma’muriyat tomonidan vaqtincha muzlatilgan.',
      });
      return;
    }

    req.user = {
      id: session.user.id,
      email: session.user.email,
      username: session.user.username,
      firstName: session.user.firstName,
      lastName: session.user.lastName,
      role: session.user.role,
      tier: session.user.tier,
      status: session.user.status,
      language: session.user.language,
      theme: session.user.theme,
    };
    req.sessionToken = token;
    req.sessionId = session.id;

    next();
  } catch (error) {
    console.error('[Auth Middleware] Error verifying session:', error);
    res.status(500).json({ success: false, message: 'Serverda xatolik yuz berdi' });
  }
}

/**
 * Require ADMIN role
 */
export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== Role.ADMIN) {
    res.status(403).json({
      success: false,
      code: 'FORBIDDEN',
      message: 'Ushbu amalni bajarish uchun administrator huquqi talab etiladi',
    });
    return;
  }
  next();
}
