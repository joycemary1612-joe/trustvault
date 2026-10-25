import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { HttpError } from './errors.js';
import { loadSession, requireCsrfHeader } from './session.js';
import authRoutes from './routes/auth.js';
import documentRoutes from './routes/documents.js';
import adminRoutes from './routes/admin.js';
import userRoutes from './routes/users.js';

const clientDist = fileURLToPath(new URL('../../client/dist', import.meta.url));

export function createApp(db) {
  const app = express();
  app.set('trust proxy', 1); // Render puts one proxy in front of us; req.ip is the real client.
  app.disable('x-powered-by');

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
  }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  const api = express.Router();
  api.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  api.use(requireCsrfHeader);
  api.use(loadSession(db));
  api.get('/health', (_req, res) => res.json({ ok: true }));
  api.use('/auth', authRoutes(db));
  api.use('/documents', documentRoutes(db));
  api.use('/users', userRoutes(db));
  api.use('/admin', adminRoutes(db));
  api.use((_req, _res, next) => next(new HttpError(404, 'Not found.')));
  app.use('/api', api);

  // Serve the built React app, with client-side routing fallback.
  if (existsSync(clientDist)) {
    app.use(express.static(clientDist, { index: false }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile('index.html', { root: clientDist }));
  }

  // Errors: a clear message for expected ones, nothing internal for the rest.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body is too large.' });
    console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, err);
    res.status(500).json({ error: 'Something went wrong on our side.' });
  });

  return app;
}
