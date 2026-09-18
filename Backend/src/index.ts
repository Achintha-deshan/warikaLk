import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import dotenv from 'dotenv';
import { pool } from './config/db';
import authRoutes from './routes/authRoutes';
import customerRoutes from './routes/customerRoutes';
import staffRoutes from './routes/staffRoutes';
import loanRoutes from './routes/loanRoutes';
import reportRoutes from './routes/reportRoutes';
import platformAuthRoutes from './routes/platformAuthRoutes';
import platformRoutes from './routes/platformRoutes';
import { seedPlatformAdmin } from './config/seedPlatformAdmin';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';

dotenv.config();

// Neither of these has a listener by default, so an uncaught exception or
// unhandled promise rejection would otherwise crash the whole process (Node
// 15+ terminates on unhandled rejection by default). Every controller in
// this codebase already catches its own errors, so this is a last-resort
// backstop for something genuinely unexpected — log it clearly, keep
// serving other requests, rather than take the entire app down over one bug.
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});

const app = express();
const PORT = process.env.PORT || 4000;

// Trust exactly one hop (Railway's single reverse proxy), not "true" — "true"
// would trust X-Forwarded-For from ANY hop, letting a client spoof that
// header directly and bypass express-rate-limit's per-IP limits entirely.
// "1" means Express only trusts the IP the proxy immediately in front of it
// reports, not whatever a client claims.
app.set('trust proxy', 1);

app.use(helmet());
app.use(compression());
app.use(cors({
  origin: process.env.FRONTEND_URL,
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'WarikaLk backend eka wade karanawa' });
});

app.get('/api/db-check', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ connected: true, time: result.rows[0].now });
  } catch (err) {
    console.error(err);
    res.status(500).json({ connected: false, error: 'Database connection failed' });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/loans', loanRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/platform/auth', platformAuthRoutes);
app.use('/api/platform', platformRoutes);

// Must be registered last: notFoundHandler catches any request that matched
// no route above, errorHandler (4 args — Express recognizes it as an error
// handler by arity) catches anything thrown/rejected that individual route
// handlers didn't already catch themselves.
app.use(notFoundHandler);
app.use(errorHandler);

async function start(): Promise<void> {
  await seedPlatformAdmin();
  app.listen(PORT, () => {
    console.log(`Server eka run wenawa → http://localhost:${PORT}`);
  });
}

start();