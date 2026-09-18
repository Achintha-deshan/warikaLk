import { Router } from 'express';
import {
  createCustomer,
  listCustomers,
  getCustomer,
  updateCustomer,
  deleteCustomer
} from '../controllers/customerController';
import { requireAuthAndSubscription, requireRole } from '../middleware/requireAuth';

const router = Router();

router.use(requireAuthAndSubscription);

router.post('/', createCustomer);
router.get('/', listCustomers);
router.get('/:id', getCustomer);
router.put('/:id', updateCustomer);
router.delete('/:id', requireRole('owner'), deleteCustomer);

export default router;
