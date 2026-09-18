import { Router } from 'express';
import { listAllTenants, markTenantPaid } from '../controllers/platformController';
import { requirePlatformAdmin } from '../middleware/requirePlatformAdmin';

const router = Router();

router.use(requirePlatformAdmin);

router.get('/tenants', listAllTenants);
router.patch('/tenants/:id/mark-paid', markTenantPaid);

export default router;
