import { Router } from 'express';
import { createStaff, listStaff, deactivateStaff, reactivateStaff } from '../controllers/staffController';
import { requireAuthAndSubscription, requireRole } from '../middleware/requireAuth';

const router = Router();

router.use(requireAuthAndSubscription, requireRole('owner'));

router.post('/', createStaff);
router.get('/', listStaff);
router.patch('/:id/deactivate', deactivateStaff);
router.patch('/:id/reactivate', reactivateStaff);

export default router;
