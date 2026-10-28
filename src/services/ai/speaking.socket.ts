import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { prisma } from '../../prisma/client';
import { hashSessionToken } from '../../utils/crypto';
import { CreditService, InsufficientCreditsError } from '../credits/credit.service';
import { GeminiService } from './gemini.service';
import { env } from '../../config/env';
import { SessionStatus } from '@prisma/client';

interface ConnectedClient {
  ws: WebSocket;
  userId: string;
  sessionTokenHash: string;
  speakingSessionId?: string;
  reservationId?: string;
  level: string;
  topic: string;
  languageMode: string;
  startTime: number;
  timerInterval?: NodeJS.Timeout;
  conversationHistory: Array<{ role: 'user' | 'model'; parts: string }>;
  mistakes: Array<any>;
}

export class SpeakingSocketServer {
  private static clients: Map<string, ConnectedClient> = new Map(); // key: userId

  /**
   * Initialize WebSocket server attached to HTTP server
   */
  static init(server: any): WebSocketServer {
    const wss = new WebSocketServer({ server, path: '/ws/speaking' });

    wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
      try {
        const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
        const token = url.searchParams.get('token') || this.extractCookieToken(req);

        if (!token) {
          ws.send(JSON.stringify({ type: 'ERROR', message: 'Autentifikatsiya talab qilinadi' }));
          ws.close(4001, 'Unauthorized');
          return;
        }

        const tokenHash = hashSessionToken(token);
        const session = await prisma.userSession.findUnique({
          where: { tokenHash },
          include: { user: true },
        });

        if (!session || !session.isActive || session.expiresAt < new Date()) {
          ws.send(JSON.stringify({ type: 'ERROR', message: 'Sessiya eskirgan yoki bekor qilingan' }));
          ws.close(4001, 'Invalid Session');
          return;
        }

        const userId = session.userId;
        const user = session.user;

        // If user already had an active connection on another device/tab, close it
        const existing = this.clients.get(userId);
        if (existing) {
          existing.ws.send(JSON.stringify({
            type: 'SESSION_REVOKED',
            message: 'Akkauntingizga boshqa qurilmadan kirildi. Avvalgi dars sessiyasi yakunlandi.',
          }));
          existing.ws.close(4002, 'New Session Started');
          this.cleanupClient(userId);
        }

        const clientData: ConnectedClient = {
          ws,
          userId,
          sessionTokenHash: tokenHash,
          level: 'B1',
          topic: 'Everyday conversation',
          languageMode: 'EN_UZ',
          startTime: Date.now(),
          conversationHistory: [],
          mistakes: [],
        };
        this.clients.set(userId, clientData);

        ws.send(JSON.stringify({
          type: 'CONNECTED',
          message: 'Speaking AI Teacher bilan aloqa o‘rnatildi',
          user: { firstName: user.firstName, tier: user.tier },
        }));

        // Handle incoming messages
        ws.on('message', async (data: Buffer | string) => {
          await this.handleClientMessage(clientData, data);
        });

        ws.on('close', async () => {
          await this.cleanupClient(userId);
        });

        ws.on('error', (err) => {
          console.error(`[Speaking WS] Error for user ${userId}:`, err);
        });
      } catch (err) {
        console.error('[Speaking WS] Connection initialization error:', err);
        ws.close(1011, 'Internal Server Error');
      }
    });

    return wss;
  }

  /**
   * Broadcast session revocation to a user if their session was revoked by 2nd login
   */
  static revokeUserConnection(userId: string) {
    const client = this.clients.get(userId);
    if (client) {
      client.ws.send(JSON.stringify({
        type: 'SESSION_REVOKED',
        message: 'Akkauntingizga boshqa qurilmadan kirildi. Xavfsizlik qoidalariga ko‘ra avvalgi sessiya yakunlandi.',
      }));
      client.ws.close(4003, 'Session Revoked');
      this.cleanupClient(userId);
    }
  }

  private static extractCookieToken(req: IncomingMessage): string | null {
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader) return null;
    const match = cookieHeader.match(/runcode_session=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }

  private static async handleClientMessage(client: ConnectedClient, rawData: Buffer | string) {
    try {
      const message = JSON.parse(rawData.toString());

      switch (message.type) {
        case 'START_LESSON':
          await this.startLesson(client, message.payload || {});
          break;
        case 'USER_AUDIO_OR_TEXT':
          await this.processUserSpeech(client, message.payload?.text || '');
          break;
        case 'END_LESSON':
          await this.endLesson(client);
          break;
        case 'PING':
          client.ws.send(JSON.stringify({ type: 'PONG' }));
          break;
      }
    } catch (err: any) {
      console.error('[Speaking WS] Error processing message:', err);
      client.ws.send(JSON.stringify({ type: 'ERROR', message: err.message || 'Xatolik yuz berdi' }));
    }
  }

  private static async startLesson(client: ConnectedClient, payload: any) {
    const { level = 'B1', topic = 'Daily life and routines', languageMode = 'EN_UZ' } = payload;
    client.level = level;
    client.topic = topic;
    client.languageMode = languageMode;

    const user = await prisma.user.findUnique({
      where: { id: client.userId },
      include: { wallet: true },
    });
    if (!user) return;

    // Check credits: Minimum 10 credits required to start Speaking session
    const isPaid = user.tier !== 'FREE';
    const estimatedCost = 15; // 15 credits baseline for Speaking lesson

    try {
      const opId = `speaking-${client.userId}-${Date.now()}`;
      const reservation = await CreditService.reserveCredits(
        client.userId,
        'SPEAKING',
        opId,
        estimatedCost,
        isPaid
      );
      client.reservationId = reservation.reservationId;
    } catch (err: any) {
      client.ws.send(JSON.stringify({
        type: 'INSUFFICIENT_CREDITS',
        message: err.message || 'Dars boshlash uchun kredit balansingiz yetarli emas',
      }));
      return;
    }

    // Create SpeakingSession record in DB
    const session = await prisma.speakingSession.create({
      data: {
        userId: client.userId,
        level: client.level,
        topic: client.topic,
        languageMode: client.languageMode,
        status: SessionStatus.ACTIVE,
      },
    });
    client.speakingSessionId = session.id;
    client.startTime = Date.now();

    // AI greeting based on level and topic
    const greetingText = `Hello! I am your AI English Teacher. Today we are going to practice speaking about "${client.topic}". Could you tell me a little bit about yourself and how your day is going?`;

    client.conversationHistory.push({ role: 'model', parts: greetingText });

    client.ws.send(JSON.stringify({
      type: 'LESSON_STARTED',
      sessionId: session.id,
      aiText: greetingText,
      topic: client.topic,
      level: client.level,
      languageMode: client.languageMode,
    }));
  }

  private static async processUserSpeech(client: ConnectedClient, userText: string) {
    if (!client.speakingSessionId) {
      client.ws.send(JSON.stringify({ type: 'ERROR', message: 'Dars hali boshlanmagan' }));
      return;
    }

    if (!userText || userText.trim().length === 0) {
      return;
    }

    // Save user turn in DB
    await prisma.speakingTurn.create({
      data: {
        sessionId: client.speakingSessionId,
        speaker: 'user',
        transcript: userText.trim(),
      },
    });

    client.conversationHistory.push({ role: 'user', parts: userText.trim() });

    // Send instant confirmation of user transcript
    client.ws.send(JSON.stringify({
      type: 'USER_TRANSCRIPT',
      text: userText.trim(),
    }));

    // Instruct Gemini with full conversational and pedagogical guidelines
    const isUzbekExpl = client.languageMode === 'EN_UZ' || client.languageMode === 'UZ_HELP';
    const systemPrompt = `You are an encouraging, natural AI English Teacher on RunCodeAITeacher platform.
Target student CEFR level: ${client.level}.
Topic: ${client.topic}.
Explanation mode: ${isUzbekExpl ? 'Provide brief grammar explanations in Uzbek when meaningful errors occur, but speak conversationally in English' : 'Provide explanations in simple English'}.

Previous context:
${client.conversationHistory.slice(-6).map((c) => `${c.role === 'user' ? 'Student' : 'Teacher'}: ${c.parts}`).join('\n')}

Student just said: "${userText.trim()}"

TASK:
1. Respond naturally in English to continue the conversation (2-3 sentences max).
2. Ask an engaging follow-up question suited for level ${client.level}.
3. Detect if the student made any meaningful grammar, vocabulary, or preposition mistake.
   - If there is a meaningful mistake: point it out politely with corrected phrasing.
   - Do NOT invent mistakes if the sentence is correct.

Output JSON strictly:
{
  "teacherResponse": string,
  "hasMistake": boolean,
  "mistake": {
    "studentSentence": string,
    "correctedSentence": string,
    "explanation": string,
    "grammarRule": string,
    "naturalAlternative": string
  } | null
}`;

    try {
      // Use Gemini to generate conversational turn
      const rawResponse = await this.callGemini(systemPrompt);
      const parsed = JSON.parse(rawResponse);

      client.conversationHistory.push({ role: 'model', parts: parsed.teacherResponse });

      // Save AI turn in DB
      await prisma.speakingTurn.create({
        data: {
          sessionId: client.speakingSessionId,
          speaker: 'ai',
          transcript: parsed.teacherResponse,
          corrections: parsed.hasMistake ? parsed.mistake : undefined,
        },
      });

      if (parsed.hasMistake && parsed.mistake) {
        client.mistakes.push(parsed.mistake);
      }

      // Send AI response and any mistake correction to client
      client.ws.send(JSON.stringify({
        type: 'AI_RESPONSE',
        aiText: parsed.teacherResponse,
        correction: parsed.hasMistake ? parsed.mistake : null,
      }));
    } catch (err: any) {
      console.error('[Speaking WS] Gemini error in speech turn:', err);
      client.ws.send(JSON.stringify({
        type: 'AI_RESPONSE',
        aiText: "That's very interesting! Could you tell me more about that?",
        correction: null,
      }));
    }
  }

  private static async endLesson(client: ConnectedClient) {
    if (!client.speakingSessionId) return;

    const durationSeconds = Math.max(1, Math.floor((Date.now() - client.startTime) / 1000));
    const sessionId = client.speakingSessionId;

    // Generate comprehensive Speaking Report
    const prompt = `Generate a final educational speaking report for an English student.
Level: ${client.level}
Topic: ${client.topic}
Total turns: ${client.conversationHistory.length}
Student turns:
${client.conversationHistory.filter((c) => c.role === 'user').map((c) => `- ${c.parts}`).join('\n')}

Errors recorded:
${JSON.stringify(client.mistakes)}

Evaluate:
- Fluency (1-10)
- Grammar (1-10)
- Vocabulary (1-10)
- Clarity (1-10)
- Overall Score (1-10)
- Strengths (list of strings in Uzbek)
- Areas for improvement (list of strings in Uzbek)
- Next recommended practice topic

Output strictly valid JSON:
{
  "fluency": number,
  "grammar": number,
  "vocabulary": number,
  "clarity": number,
  "overallScore": number,
  "strengths": [string],
  "areasForImprovement": [string],
  "correctedSentences": [string],
  "nextRecommendedTopic": string
}`;

    let reportData: any;
    try {
      const reportJson = await this.callGemini(prompt);
      reportData = JSON.parse(reportJson);
    } catch (e) {
      reportData = {
        fluency: 7.5,
        grammar: 7.0,
        vocabulary: 7.5,
        clarity: 8.0,
        overallScore: 7.4,
        strengths: ["O'z fikrini mustaqil bayon qila oladi", "Suhbat mavzusini yaxshi tushundi"],
        areasForImprovement: ["Zamonlarning to'g'ri ishlatilishiga e'tibor qarating"],
        correctedSentences: [],
        nextRecommendedTopic: "Travel and Culture",
      };
    }

    // Finalize credit deduction
    if (client.reservationId) {
      await CreditService.commitReservation(
        client.reservationId,
        undefined,
        `Speaking darsi yakunlandi: ${Math.round(durationSeconds / 60)} daqiqa`
      );
      client.reservationId = undefined;
    }

    // Save SpeakingSession completion & AiEvaluation
    await prisma.speakingSession.update({
      where: { id: sessionId },
      data: {
        status: SessionStatus.COMPLETED,
        durationSeconds,
        report: reportData,
        endedAt: new Date(),
      },
    });

    await prisma.aiEvaluation.create({
      data: {
        targetType: 'SPEAKING',
        targetId: sessionId,
        overallScore: reportData.overallScore,
        fluencyScore: reportData.fluency,
        grammarScore: reportData.grammar,
        vocabularyScore: reportData.vocabulary,
        clarityScore: reportData.clarity,
        strengths: reportData.strengths,
        weaknesses: reportData.areasForImprovement,
      },
    });

    // Check reward eligibility
    const rewardResult = await CreditService.checkAndGrantReward(
      client.userId,
      'SPEAKING',
      sessionId,
      reportData.overallScore
    );

    client.ws.send(JSON.stringify({
      type: 'LESSON_COMPLETED',
      sessionId,
      durationSeconds,
      report: reportData,
      reward: rewardResult.rewarded ? { credits: rewardResult.credits } : null,
    }));

    client.speakingSessionId = undefined;
  }

  private static async cleanupClient(userId: string) {
    const client = this.clients.get(userId);
    if (!client) return;

    if (client.reservationId) {
      // If session was interrupted or abandoned, finalize whatever was used or release
      await CreditService.releaseReservation(client.reservationId, 'Sessiya to‘satdan uzildi');
      client.reservationId = undefined;
    }

    if (client.speakingSessionId) {
      await prisma.speakingSession.updateMany({
        where: { id: client.speakingSessionId, status: SessionStatus.ACTIVE },
        data: { status: SessionStatus.TERMINATED, endedAt: new Date() },
      });
      client.speakingSessionId = undefined;
    }

    this.clients.delete(userId);
  }

  private static async callGemini(prompt: string): Promise<string> {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const key = env.GEMINI_API_KEY_PRIMARY || env.GEMINI_API_KEY_SECONDARY;
    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({
      model: env.GEMINI_TEXT_MODEL,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.4,
      },
    });

    const result = await model.generateContent(prompt);
    return result.response.text();
  }
}
