import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { env } from './config/env';
import apiRouter from './routes';
import { SpeakingSocketServer } from './services/ai/speaking.socket';
import { prisma } from './prisma/client';

// Support BigInt serialization in JSON responses globally
(BigInt.prototype as any).toJSON = function () {
  const n = Number(this);
  return Number.isSafeInteger(n) ? n : this.toString();
};

const app = express();
const server = http.createServer(app);

// CORS configuration for Frontend and Admin
const allowedOrigins = env.CORS_ALLOWED_ORIGINS.split(',').map((o) => o.trim());
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(null, true); // Allow during localhost development
      }
    },
    credentials: true,
  })
);

app.use(cookieParser(env.SESSION_SECRET));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static public assets for payment QR codes
const assetsDir = path.resolve(__dirname, 'assets/payments');
app.use('/assets/payments', express.static(assetsDir));

// Also serve Frontend public assets if available
const frontendAssetsDir = path.resolve(process.cwd(), 'Frontend/public/assets/payments');
app.use('/assets/payments', express.static(frontendAssetsDir));

// Mount Versioned API Routes
app.use('/api/v1', apiRouter);

// Initialize Speaking WebSocket Engine
SpeakingSocketServer.init(server);

// Centralized error handling middleware
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[API Error]:', err);
  const status = err.status || 500;
  const message = err.message || 'Serverda ichki xatolik yuz berdi';
  res.status(status).json({
    success: false,
    code: err.code || 'INTERNAL_ERROR',
    message,
  });
});

// Start Server
const PORT = env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`  RunCodeAITeacher Backend Server running on port ${PORT}`);
  console.log(`  Environment: ${env.NODE_ENV}`);
  console.log(`  API Base: http://localhost:${PORT}/api/v1`);
  console.log(`  WebSocket Speaking: ws://localhost:${PORT}/ws/speaking`);
  console.log(`=======================================================`);
});

// Graceful shutdown
async function gracefulShutdown(signal: string) {
  console.log(`[Server] Received ${signal}. Shutting down gracefully...`);
  server.close(async () => {
    await prisma.$disconnect();
    console.log('[Server] Database disconnected and server stopped.');
    process.exit(0);
  });
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export { app, server };
