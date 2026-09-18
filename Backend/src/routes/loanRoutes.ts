import { Router } from 'express';
import { createLoan, listLoans, getLoan, recordPayment, closeLoan, markLoanDefaulted } from '../controllers/loanController';
import { requireAuthAndSubscription, requireRole } from '../middleware/requireAuth';

const router = Router();

router.use(requireAuthAndSubscription);

router.post('/', createLoan);
router.get('/', listLoans);
router.get('/:id', getLoan);
router.post('/:id/payments', recordPayment);
router.patch('/:id/close', requireRole('owner'), closeLoan);
router.patch('/:id/mark-defaulted', requireRole('owner'), markLoanDefaulted);

export default router;
