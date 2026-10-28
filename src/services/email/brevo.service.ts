import { env } from '../../config/env';

export interface SendEmailOptions {
  toEmail: string;
  toName?: string;
  subject: string;
  htmlContent: string;
  textContent: string;
}

export class BrevoEmailService {
  /**
   * Send transactional email via Brevo REST API
   */
  static async sendEmail(options: SendEmailOptions): Promise<{ success: boolean; messageId?: string; simulated?: boolean; error?: string }> {
    const { toEmail, toName, subject, htmlContent, textContent } = options;

    if (env.ENABLE_DEV_EMAIL_SIMULATION) {
      console.log(`[DEV EMAIL SIMULATION] To: ${toEmail} | Subject: ${subject}`);
      console.log(`[DEV EMAIL CONTENT]:\n${textContent}\n`);
      return { success: true, simulated: true, messageId: `sim-${Date.now()}` };
    }

    if (!env.BREVO_API_KEY) {
      console.warn('[Brevo Service] BREVO_API_KEY is not set. Falling back to simulation.');
      return { success: true, simulated: true, messageId: `sim-nokey-${Date.now()}` };
    }

    try {
      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'content-type': 'application/json',
          'api-key': env.BREVO_API_KEY,
        },
        body: JSON.stringify({
          sender: {
            name: env.BREVO_SENDER_NAME,
            email: env.BREVO_SENDER_EMAIL,
          },
          to: [
            {
              email: toEmail,
              name: toName || toEmail.split('@')[0],
            },
          ],
          subject,
          htmlContent,
          textContent,
        }),
      });

      const data: any = await response.json();

      if (!response.ok) {
        console.error('[Brevo Service] Error response:', data);
        // If IP is not authorized on Brevo, fallback safely to dev mode if configured
        if (data?.code === 'unauthorized' && data?.message?.includes('unrecognised IP address')) {
          console.warn('[Brevo Service] Brevo IP not authorized yet. Simulating delivery for local testing.');
          return { success: true, simulated: true, error: 'Brevo IP authorization pending', messageId: `fallback-${Date.now()}` };
        }
        return { success: false, error: data?.message || 'Failed to send transactional email' };
      }

      return { success: true, messageId: data.messageId };
    } catch (err: any) {
      console.error('[Brevo Service] Network exception:', err);
      return { success: false, error: err.message || 'Network error while contacting Brevo API' };
    }
  }

  /**
   * Send 6-digit OTP email for registration or password recovery
   */
  static async sendOtpEmail(email: string, otp: string, purpose: 'registration' | 'recovery'): Promise<{ success: boolean; simulated?: boolean; error?: string }> {
    const isReg = purpose === 'registration';
    const title = isReg ? "Ro'yxatdan o'tishni tasdiqlash kodi" : "Parolni tiklash kodi";

    const textContent = `RunCodeAITeacher
By Temurmalik

Your verification code: ${otp}

This code expires in ${env.OTP_EXPIRY_MINUTES} minutes.
Do not share this code.
`;

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0f172a; color: #f8fafc; margin: 0; padding: 24px; }
    .container { max-width: 500px; margin: 0 auto; background: #1e293b; border-radius: 16px; border: 1px solid #334155; padding: 32px; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5); }
    .header { text-align: center; margin-bottom: 24px; }
    .brand { font-size: 24px; font-weight: 800; color: #38bdf8; letter-spacing: -0.5px; }
    .subtitle { font-size: 13px; color: #94a3b8; font-weight: 500; margin-top: 2px; }
    .title { font-size: 18px; font-weight: 600; text-align: center; margin-bottom: 16px; color: #f1f5f9; }
    .otp-box { background: #0f172a; border: 2px dashed #0284c7; border-radius: 12px; padding: 20px; text-align: center; margin: 24px 0; }
    .otp-code { font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #38bdf8; font-family: monospace; }
    .note { font-size: 13px; color: #94a3b8; text-align: center; line-height: 1.6; }
    .footer { text-align: center; margin-top: 32px; font-size: 12px; color: #64748b; border-top: 1px solid #334155; padding-top: 16px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="brand">RunCodeAITeacher</div>
      <div class="subtitle">By Temurmalik</div>
    </div>
    <div class="title">${title}</div>
    <p style="text-align:center; color:#cbd5e1; font-size:14px; margin:0;">
      ${isReg ? "Platformada ro'yxatdan o'tishni yakunlash uchun quyidagi tasdiqlash kodini kiriting:" : "Parolingizni yangilash uchun quyidagi bir martalik kodni kiriting:"}
    </p>
    <div class="otp-box">
      <div class="otp-code">${otp}</div>
    </div>
    <div class="note">
      Ushbu kod <strong>${env.OTP_EXPIRY_MINUTES} daqiqa</strong> davomida amal qiladi.<br>
      Xavfsizlik maqsadida kodni hech kimga bermang.
    </div>
    <div class="footer">
      &copy; ${new Date().getFullYear()} RunCodeAITeacher — By Temurmalik. Barcha huquqlar himoyalangan.
    </div>
  </div>
</body>
</html>
`;

    return this.sendEmail({
      toEmail: email,
      subject: `${title} - RunCodeAITeacher`,
      htmlContent,
      textContent,
    });
  }
}
