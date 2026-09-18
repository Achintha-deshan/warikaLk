import { Router } from 'express';
import {
  getReportSummary,
  getInterestPayments,
  getDefaultedLoans,
  getCollectionsReport,
  getAgentPerformance,
  getMonthlyOverview,
  getDailyDue
} from '../controllers/reportController';
import { requireAuthAndSubscription, requireRole } from '../middleware/requireAuth';

const router = Router();

router.use(requireAuthAndSubscription);

router.get('/summary', getReportSummary);
router.get('/interest-payments', getInterestPayments);
router.get('/defaulted', requireRole('owner'), getDefaultedLoans);
router.get('/collections', getCollectionsReport);
router.get('/agent-performance', requireRole('owner'), getAgentPerformance);
router.get('/monthly-overview', getMonthlyOverview);
router.get('/daily-due', getDailyDue);

export default router;
