import { Request, Response } from 'express';
import { z } from 'zod';
import { stringify } from 'csv-stringify/sync';
import { pool } from '../config/db';
import {
  computeLoanState,
  calculateDailyLoanSchedule,
  roundToCents,
  toIsoDate,
  type LoanType
} from '../services/loanCalculations';
import {
  getOverdueThresholds,
  toCalcInput,
  toPaymentStats,
  LOAN_COLUMNS,
  PAYMENT_STATS_LATERAL,
  type LoanRow,
  type PaymentStatsRow
} from './loanController';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const DateRangeSchema = z.object({
  from: z.string().regex(DATE_REGEX).optional(),
  to: z.string().regex(DATE_REGEX).optional()
});

// Every report endpoint accepts the same from/to shape and the same
// defaulting rule (from = start of current month, to = today), so this is
// the one place that logic lives. Both bounds are treated as INCLUSIVE
// calendar dates — `to` gets converted to an exclusive upper bound
// internally (the day after) so every query can use a plain
// `paid_at >= from AND paid_at < to` half-open interval.
//
// Known limitation shared with loanCalculations.ts: "today"/"current month"
// are computed in UTC, not Asia/Colombo (Sri Lanka is UTC+5:30). For a few
// hours after Sri Lankan local midnight, UTC is still on the previous
// calendar day, which could misattribute a payment made very early morning
// local time to the wrong day/month in this report. Same known tradeoff
// already accepted in the loans calculation engine — not re-solved here.
function resolveDateRange(fromStr: string | undefined, toStr: string | undefined) {
  const now = new Date();
  const todayIso = toIsoDate(now);
  const startOfMonthIso = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;

  const fromIso = fromStr ?? startOfMonthIso;
  const toIso = toStr ?? todayIso;

  const from = new Date(`${fromIso}T00:00:00.000Z`);
  const toExclusive = new Date(new Date(`${toIso}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000);

  return { from, toExclusive, fromIso, toIso, todayIso, startOfMonthIso };
}

interface InterestEarnedBreakdown {
  exact: number;
  estimated_daily: number;
  combined: number;
}

// Monthly loans: normal_cycle + late_charge payments ARE interest, exactly —
// no estimation needed. Daily loans: a daily_installment payment blends
// principal+interest with no stored split, so this applies each loan's own
// fixed total-interest ratio (totalInterest / totalAmountDue, constant for
// that loan's whole life) to however much of that loan was collected within
// the window. That's a reasonable proportional estimate, not a ledger fact —
// see the reportSummary handler for how this gets labeled to the client, and
// migration/API notes for the recommended schema fix (storing the split at
// payment-recording time instead of reconstructing it after the fact).
async function computeInterestEarned(tenantId: string, from: Date, toExclusive: Date): Promise<InterestEarnedBreakdown> {
  const exactResult = await pool.query<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0) AS total
       FROM payments
      WHERE tenant_id = $1 AND payment_type IN ('normal_cycle', 'late_charge')
        AND paid_at >= $2 AND paid_at < $3`,
    [tenantId, from, toExclusive]
  );
  const exact = Number(exactResult.rows[0].total);

  const dailyResult = await pool.query<{
    principal: string;
    interest_rate: string;
    total_days: number;
    period_collected: string;
  }>(
    `SELECT l.principal, l.interest_rate, l.total_days, SUM(p.amount) AS period_collected
       FROM payments p
       JOIN loans l ON l.id = p.loan_id AND l.tenant_id = p.tenant_id
      WHERE p.tenant_id = $1 AND p.payment_type = 'daily_installment'
        AND p.paid_at >= $2 AND p.paid_at < $3
      GROUP BY l.id, l.principal, l.interest_rate, l.total_days`,
    [tenantId, from, toExclusive]
  );

  let estimatedDaily = 0;
  for (const row of dailyResult.rows) {
    const schedule = calculateDailyLoanSchedule(Number(row.principal), Number(row.interest_rate), row.total_days);
    const ratio = schedule.totalInterest / schedule.totalAmountDue;
    estimatedDaily += Number(row.period_collected) * ratio;
  }
  estimatedDaily = roundToCents(estimatedDaily);

  return { exact, estimated_daily: estimatedDaily, combined: roundToCents(exact + estimatedDaily) };
}

export async function getReportSummary(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const parsed = DateRangeSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const tenantId = req.user.tenantId;
  const { from, toExclusive, fromIso, toIso, todayIso, startOfMonthIso } = resolveDateRange(
    parsed.data.from,
    parsed.data.to
  );

  try {
    const totalCollectedResult = await pool.query<{ total: string }>(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE tenant_id = $1 AND paid_at >= $2 AND paid_at < $3`,
      [tenantId, from, toExclusive]
    );
    const totalCollected = Number(totalCollectedResult.rows[0].total);

    const collectedByTypeResult = await pool.query<{ loan_type: LoanType; total: string }>(
      `SELECT l.loan_type, COALESCE(SUM(p.amount), 0) AS total
         FROM payments p
         JOIN loans l ON l.id = p.loan_id AND l.tenant_id = p.tenant_id
        WHERE p.tenant_id = $1 AND p.paid_at >= $2 AND p.paid_at < $3
        GROUP BY l.loan_type`,
      [tenantId, from, toExclusive]
    );
    const collectedByType: Record<LoanType, number> = { daily: 0, monthly: 0 };
    for (const row of collectedByTypeResult.rows) {
      collectedByType[row.loan_type] = Number(row.total);
    }

    // The requested range, plus the two fixed convenience ranges — same
    // underlying calculation, different windows.
    const [rangeInterest, todayInterest, monthInterest] = await Promise.all([
      computeInterestEarned(tenantId, from, toExclusive),
      computeInterestEarned(
        tenantId,
        new Date(`${todayIso}T00:00:00.000Z`),
        new Date(new Date(`${todayIso}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000)
      ),
      computeInterestEarned(tenantId, new Date(`${startOfMonthIso}T00:00:00.000Z`), toExclusive)
    ]);

    // Status counts are a current snapshot, not scoped to the requested
    // range — "how many active loans right now" doesn't have a meaningful
    // "from/to", unlike the payment-flow figures above.
    const statusCountsResult = await pool.query<{ status: string; loan_type: LoanType; count: string }>(
      `SELECT status, loan_type, COUNT(*) AS count FROM loans WHERE tenant_id = $1 GROUP BY status, loan_type`,
      [tenantId]
    );
    let activeLoansCount = 0;
    let closedLoansCount = 0;
    let defaultedLoansCount = 0;
    const activeCountByType: Record<LoanType, number> = { daily: 0, monthly: 0 };
    for (const row of statusCountsResult.rows) {
      const count = Number(row.count);
      if (row.status === 'active') {
        activeLoansCount += count;
        activeCountByType[row.loan_type] = count;
      } else if (row.status === 'closed') {
        closedLoansCount += count;
      } else if (row.status === 'defaulted') {
        defaultedLoansCount += count;
      }
    }

    // Active loans + their lifetime payment stats, computed once and reused
    // for both overdue_count and total_outstanding_principal — reuses the
    // exact same computeLoanState/getOverdueSeverity pipeline loanController
    // already uses for listLoans/getLoan, rather than reimplementing the
    // overdue rule here.
    const activeLoansResult = await pool.query<LoanRow & PaymentStatsRow>(
      `SELECT ${LOAN_COLUMNS},
              COALESCE(pa.installments_paid, 0) AS installments_paid,
              COALESCE(pa.daily_total_paid, 0) AS daily_total_paid,
              pa.last_interest_payment_at,
              COALESCE(pa.principal_paid, 0) AS principal_paid
         FROM loans l
         LEFT JOIN LATERAL (${PAYMENT_STATS_LATERAL}) pa ON true
        WHERE l.tenant_id = $1 AND l.status = 'active'`,
      [tenantId]
    );

    const thresholds = await getOverdueThresholds(tenantId);
    const now = new Date();
    let overdueCount = 0;
    let outstandingPrincipalMonthlyExact = 0;
    let outstandingPrincipalDailyEstimated = 0;

    for (const row of activeLoansResult.rows) {
      const state = computeLoanState(toCalcInput(row), toPaymentStats(row), thresholds, now);
      if (state.overdueSeverity !== 'ok') {
        overdueCount += 1;
      }
      if (state.type === 'monthly') {
        outstandingPrincipalMonthlyExact += state.outstandingPrincipal;
      } else {
        outstandingPrincipalDailyEstimated += state.estimatedOutstandingPrincipal;
      }
    }
    outstandingPrincipalMonthlyExact = roundToCents(outstandingPrincipalMonthlyExact);
    outstandingPrincipalDailyEstimated = roundToCents(outstandingPrincipalDailyEstimated);

    res.status(200).json({
      range: { from: fromIso, to: toIso },
      total_collected: roundToCents(totalCollected),
      total_interest_earned: rangeInterest,
      daily_profit: todayInterest,
      monthly_profit: monthInterest,
      total_outstanding_principal: {
        monthly_exact: outstandingPrincipalMonthlyExact,
        daily_estimated: outstandingPrincipalDailyEstimated,
        combined: roundToCents(outstandingPrincipalMonthlyExact + outstandingPrincipalDailyEstimated),
        note: 'monthly_exact is exact (principal minus principal_settlement payments). daily_estimated applies each daily loan\'s fixed principal/total-due ratio to what has been collected so far — an estimate, not a ledger fact, since daily_installment payments have no stored principal/interest split.'
      },
      active_loans_count: activeLoansCount,
      closed_loans_count: closedLoansCount,
      defaulted_loans_count: defaultedLoansCount,
      overdue_count: overdueCount,
      by_loan_type: {
        daily: {
          total_collected: roundToCents(collectedByType.daily),
          total_interest_earned_estimated: rangeInterest.estimated_daily,
          active_loans_count: activeCountByType.daily
        },
        monthly: {
          total_collected: roundToCents(collectedByType.monthly),
          total_interest_earned_exact: rangeInterest.exact,
          active_loans_count: activeCountByType.monthly
        }
      },
      methodology_note:
        'For monthly loans, interest earned is exact (normal_cycle + late_charge payments are interest by definition). For daily loans, a single daily_installment payment blends principal and interest with no stored split — "estimated_daily" figures apply each loan\'s fixed total-interest ratio to what was actually collected, which is a reasonable approximation but not verified against a ledger. The only EXACT daily-loan interest figure is knowable at loan closure (total collected over the loan\'s life minus principal). Recommendation: add payments.principal_portion/interest_portion columns, populated at recording time, to make this exact going forward without relying on retroactive estimation.'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to build report summary' });
  }
}

const InterestPaymentsQuerySchema = DateRangeSchema.extend({
  loan_type: z.enum(['daily', 'monthly']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
});

export async function getInterestPayments(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const parsed = InterestPaymentsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const tenantId = req.user.tenantId;
  const { from, toExclusive, fromIso, toIso } = resolveDateRange(parsed.data.from, parsed.data.to);
  const page = parsed.data.page ?? 1;
  const limit = parsed.data.limit ?? 20;
  const offset = (page - 1) * limit;
  const loanType = parsed.data.loan_type ?? null;

  try {
    const result = await pool.query<{
      id: string;
      paid_at: Date;
      amount: string;
      payment_type: string;
      customer_name: string;
      customer_display_code: string;
      loan_display_code: string;
      loan_type: LoanType;
      collected_by_name: string | null;
      total_count: string;
    }>(
      `SELECT p.id, p.paid_at, p.amount, p.payment_type,
              c.name AS customer_name, c.display_code AS customer_display_code,
              l.display_code AS loan_display_code, l.loan_type,
              u.name AS collected_by_name,
              count(*) OVER() AS total_count
         FROM payments p
         JOIN loans l ON l.id = p.loan_id AND l.tenant_id = p.tenant_id
         JOIN customers c ON c.id = l.customer_id AND c.tenant_id = l.tenant_id
         LEFT JOIN users u ON u.id = p.collected_by
        WHERE p.tenant_id = $1
          AND p.payment_type IN ('normal_cycle', 'late_charge', 'daily_installment')
          AND p.paid_at >= $2 AND p.paid_at < $3
          AND ($4::text IS NULL OR l.loan_type = $4)
        ORDER BY p.paid_at DESC
        LIMIT $5 OFFSET $6`,
      [tenantId, from, toExclusive, loanType, limit, offset]
    );

    const total = result.rows[0] ? Number(result.rows[0].total_count) : 0;
    const payments = result.rows.map(({ total_count, amount, ...rest }) => ({ ...rest, amount: Number(amount) }));

    res.status(200).json({ range: { from: fromIso, to: toIso }, payments, pagination: { page, limit, total } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch interest payments' });
  }
}

const DefaultedLoansQuerySchema = DateRangeSchema.extend({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
});

// Monthly: principal_recovered (principal_settlement payments only) is
// exact — those payments exist specifically to reduce principal. Daily:
// there's no principal_settlement type at all, so this applies the same
// fixed principal/total-due ratio used everywhere else in this module to
// estimate how much of total collections was principal vs already-realized
// interest. Shared by both the paginated page and the unpaginated total
// below so the two figures are computed identically, never by two
// independently-drifting formulas.
function computeCapitalLoss(row: {
  loan_type: LoanType;
  principal: string;
  interest_rate: string;
  total_days: number | null;
  total_cash_collected: string;
  principal_recovered: string;
}): { principal_recovered: number; principal_recovered_is_estimated: boolean; capital_loss: number } {
  const principal = Number(row.principal);
  const totalCashCollected = Number(row.total_cash_collected);

  let principalRecovered = Number(row.principal_recovered);
  let isEstimated = false;
  if (row.loan_type === 'daily') {
    const schedule = calculateDailyLoanSchedule(principal, Number(row.interest_rate), row.total_days ?? 1);
    const principalRatio = principal / schedule.totalAmountDue;
    principalRecovered = roundToCents(totalCashCollected * principalRatio);
    isEstimated = true;
  }

  // Capital loss is specifically lost PRINCIPAL, not lost potential interest
  // (interest never collected was never realized income, so it isn't a
  // loss) and not reduced by interest ALREADY collected (that income was
  // already recognized in whatever period it was actually paid — it has no
  // bearing on whether the principal itself came back).
  const capitalLoss = roundToCents(Math.max(0, principal - principalRecovered));

  return {
    principal_recovered: principalRecovered,
    principal_recovered_is_estimated: isEstimated,
    capital_loss: capitalLoss
  };
}

export async function getDefaultedLoans(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const parsed = DefaultedLoansQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const tenantId = req.user.tenantId;
  const { from, toExclusive, fromIso, toIso } = resolveDateRange(parsed.data.from, parsed.data.to);
  const page = parsed.data.page ?? 1;
  const limit = parsed.data.limit ?? 20;
  const offset = (page - 1) * limit;

  try {
    // Filtered by defaulted_at, not start_date — see migration 009 notes on
    // why: a loan can start in one period and only be recognized as
    // defaulted in a much later one, and the capital loss belongs in the
    // period it was recognized, not backdated to loan origination.
    // LATERAL, not a plain LEFT JOIN to a bare GROUP BY subquery — the
    // latter (originally here) aggregated every payment row in the ENTIRE
    // system on every call, the exact same unfiltered-aggregate pattern
    // measured and fixed in loanController.ts's PAYMENT_STATS_LATERAL
    // (12.3ms unfiltered vs 0.66ms LATERAL on a 30k-row synthetic payments
    // table — see that comment for the full measurement). LATERAL
    // correlates directly to l.id, so each is evaluated once per defaulted
    // loan via idx_payments_loan rather than scanning every tenant's data.
    const result = await pool.query<{
      id: string;
      loan_display_code: string;
      loan_type: LoanType;
      customer_name: string;
      principal: string;
      interest_rate: string;
      total_days: number | null;
      defaulted_at: Date;
      default_reason: string | null;
      total_cash_collected: string;
      principal_recovered: string;
      total_count: string;
    }>(
      `SELECT l.id, l.display_code AS loan_display_code, l.loan_type, l.principal, l.interest_rate, l.total_days,
              l.defaulted_at, l.default_reason,
              c.name AS customer_name,
              COALESCE(all_payments.total, 0) AS total_cash_collected,
              COALESCE(principal_payments.total, 0) AS principal_recovered,
              count(*) OVER() AS total_count
         FROM loans l
         JOIN customers c ON c.id = l.customer_id AND c.tenant_id = l.tenant_id
         LEFT JOIN LATERAL (
           SELECT SUM(amount) AS total FROM payments p WHERE p.loan_id = l.id
         ) all_payments ON true
         LEFT JOIN LATERAL (
           SELECT SUM(amount) AS total FROM payments p WHERE p.loan_id = l.id AND p.payment_type = 'principal_settlement'
         ) principal_payments ON true
        WHERE l.tenant_id = $1 AND l.status = 'defaulted'
          AND l.defaulted_at >= $2 AND l.defaulted_at < $3
        ORDER BY l.defaulted_at DESC
        LIMIT $4 OFFSET $5`,
      [tenantId, from, toExclusive, limit, offset]
    );

    const total = result.rows[0] ? Number(result.rows[0].total_count) : 0;
    const loans = result.rows.map((row) => ({
      loan_id: row.id,
      loan_display_code: row.loan_display_code,
      loan_type: row.loan_type,
      customer_name: row.customer_name,
      principal: Number(row.principal),
      total_cash_collected: roundToCents(Number(row.total_cash_collected)),
      ...computeCapitalLoss(row),
      defaulted_at: row.defaulted_at,
      default_reason: row.default_reason
    }));

    // total_capital_loss must reflect EVERY matching defaulted loan in the
    // date range, not just the current page — pagination above intentionally
    // limits `loans`, so this needs its own unpaginated query rather than
    // summing result.rows (which was the bug here before this fix: adding
    // LIMIT/OFFSET to the main query silently made the total page-scoped).
    const allMatchingResult = await pool.query<{
      loan_type: LoanType;
      principal: string;
      interest_rate: string;
      total_days: number | null;
      total_cash_collected: string;
      principal_recovered: string;
    }>(
      `SELECT l.loan_type, l.principal, l.interest_rate, l.total_days,
              COALESCE(all_payments.total, 0) AS total_cash_collected,
              COALESCE(principal_payments.total, 0) AS principal_recovered
         FROM loans l
         LEFT JOIN LATERAL (
           SELECT SUM(amount) AS total FROM payments p WHERE p.loan_id = l.id
         ) all_payments ON true
         LEFT JOIN LATERAL (
           SELECT SUM(amount) AS total FROM payments p WHERE p.loan_id = l.id AND p.payment_type = 'principal_settlement'
         ) principal_payments ON true
        WHERE l.tenant_id = $1 AND l.status = 'defaulted'
          AND l.defaulted_at >= $2 AND l.defaulted_at < $3`,
      [tenantId, from, toExclusive]
    );
    const totalCapitalLoss = roundToCents(
      allMatchingResult.rows.reduce((sum, row) => sum + computeCapitalLoss(row).capital_loss, 0)
    );

    res.status(200).json({
      range: { from: fromIso, to: toIso },
      loans,
      pagination: { page, limit, total },
      total_capital_loss: totalCapitalLoss,
      note: 'capital_loss reflects lost principal only, never uncollected interest (which was never realized income). This is reported separately and is never netted against total_collected/total_interest_earned in the summary report.'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch defaulted loans' });
  }
}

const CollectionsQuerySchema = DateRangeSchema.extend({
  loan_type: z.enum(['daily', 'monthly']).optional(),
  collected_by: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  format: z.enum(['json', 'csv']).optional()
});

// CSV export dumps everything matching the filter in one response rather
// than paginating, so it needs its own, much higher ceiling than the JSON
// page size — and unlike JSON pagination, silently truncating a CSV export
// would be a real footgun (the owner would have no way to know the file is
// incomplete). Rejecting outright and asking to narrow the range is safer.
const MAX_CSV_ROWS = 5000;

export async function getCollectionsReport(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const parsed = CollectionsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const tenantId = req.user.tenantId;
  const { from, toExclusive, fromIso, toIso } = resolveDateRange(parsed.data.from, parsed.data.to);
  const loanType = parsed.data.loan_type ?? null;
  const collectedBy = parsed.data.collected_by ?? null;
  const format = parsed.data.format ?? 'json';

  try {
    if (format === 'csv') {
      const countResult = await pool.query<{ count: string }>(
        `SELECT COUNT(*) AS count
           FROM payments p
           JOIN loans l ON l.id = p.loan_id AND l.tenant_id = p.tenant_id
          WHERE p.tenant_id = $1 AND p.paid_at >= $2 AND p.paid_at < $3
            AND ($4::text IS NULL OR l.loan_type = $4)
            AND ($5::uuid IS NULL OR p.collected_by = $5)`,
        [tenantId, from, toExclusive, loanType, collectedBy]
      );
      const total = Number(countResult.rows[0].count);
      if (total > MAX_CSV_ROWS) {
        res.status(400).json({
          error: `This export would contain ${total} rows, which exceeds the limit of ${MAX_CSV_ROWS}. Narrow the date range and try again.`,
          rowCount: total,
          maxRows: MAX_CSV_ROWS
        });
        return;
      }

      const result = await pool.query<{
        paid_at: Date;
        customer_name: string;
        customer_display_code: string;
        loan_display_code: string;
        loan_type: LoanType;
        payment_type: string;
        amount: string;
        collected_by_name: string | null;
      }>(
        `SELECT p.paid_at, c.name AS customer_name, c.display_code AS customer_display_code,
                l.display_code AS loan_display_code, l.loan_type, p.payment_type, p.amount,
                u.name AS collected_by_name
           FROM payments p
           JOIN loans l ON l.id = p.loan_id AND l.tenant_id = p.tenant_id
           JOIN customers c ON c.id = l.customer_id AND c.tenant_id = l.tenant_id
           LEFT JOIN users u ON u.id = p.collected_by
          WHERE p.tenant_id = $1 AND p.paid_at >= $2 AND p.paid_at < $3
            AND ($4::text IS NULL OR l.loan_type = $4)
            AND ($5::uuid IS NULL OR p.collected_by = $5)
          ORDER BY p.paid_at ASC`,
        [tenantId, from, toExclusive, loanType, collectedBy]
      );

      const rows = result.rows.map((r) => [
        r.paid_at.toISOString(),
        r.customer_name,
        r.customer_display_code,
        r.loan_display_code,
        r.loan_type,
        r.payment_type,
        r.amount,
        r.collected_by_name ?? ''
      ]);

      // csv-stringify handles comma/quote/newline escaping per RFC 4180 —
      // not hand-rolled.
      const csv = stringify(rows, {
        header: true,
        columns: [
          'date',
          'customer_name',
          'customer_display_code',
          'loan_display_code',
          'loan_type',
          'payment_type',
          'amount',
          'collected_by_name'
        ]
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="collections_${fromIso}_to_${toIso}.csv"`);
      res.status(200).send(csv);
      return;
    }

    const page = parsed.data.page ?? 1;
    const limit = parsed.data.limit ?? 20;
    const offset = (page - 1) * limit;

    const result = await pool.query<{
      paid_at: Date;
      customer_name: string;
      customer_display_code: string;
      loan_display_code: string;
      loan_type: LoanType;
      payment_type: string;
      amount: string;
      collected_by_name: string | null;
      total_count: string;
    }>(
      `SELECT p.paid_at, c.name AS customer_name, c.display_code AS customer_display_code,
              l.display_code AS loan_display_code, l.loan_type, p.payment_type, p.amount,
              u.name AS collected_by_name,
              count(*) OVER() AS total_count
         FROM payments p
         JOIN loans l ON l.id = p.loan_id AND l.tenant_id = p.tenant_id
         JOIN customers c ON c.id = l.customer_id AND c.tenant_id = l.tenant_id
         LEFT JOIN users u ON u.id = p.collected_by
        WHERE p.tenant_id = $1 AND p.paid_at >= $2 AND p.paid_at < $3
          AND ($4::text IS NULL OR l.loan_type = $4)
          AND ($5::uuid IS NULL OR p.collected_by = $5)
        ORDER BY p.paid_at DESC
        LIMIT $6 OFFSET $7`,
      [tenantId, from, toExclusive, loanType, collectedBy, limit, offset]
    );

    const total = result.rows[0] ? Number(result.rows[0].total_count) : 0;
    const payments = result.rows.map(({ total_count, amount, ...rest }) => ({ ...rest, amount: Number(amount) }));

    res.status(200).json({ range: { from: fromIso, to: toIso }, payments, pagination: { page, limit, total } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch collections report' });
  }
}

export async function getAgentPerformance(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const parsed = DateRangeSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const tenantId = req.user.tenantId;
  const { from, toExclusive, fromIso, toIso } = resolveDateRange(parsed.data.from, parsed.data.to);

  try {
    // active_loans_managed is a current snapshot (how many active loans this
    // staff member currently has created), not scoped to from/to — a
    // status-based count doesn't have a meaningful period the way a payment
    // flow does. total_collected/payment_count ARE scoped to the range.
    const result = await pool.query<{
      id: string;
      name: string;
      total_collected: string;
      payment_count: string;
      active_loans_managed: string;
    }>(
      `SELECT u.id, u.name,
              COALESCE(pa.total_collected, 0) AS total_collected,
              COALESCE(pa.payment_count, 0) AS payment_count,
              COALESCE(al.active_loans_managed, 0) AS active_loans_managed
         FROM users u
         LEFT JOIN (
           SELECT collected_by, SUM(amount) AS total_collected, COUNT(*) AS payment_count
             FROM payments
            WHERE tenant_id = $1 AND paid_at >= $2 AND paid_at < $3
            GROUP BY collected_by
         ) pa ON pa.collected_by = u.id
         LEFT JOIN (
           SELECT created_by, COUNT(*) AS active_loans_managed
             FROM loans
            WHERE tenant_id = $1 AND status = 'active'
            GROUP BY created_by
         ) al ON al.created_by = u.id
        WHERE u.tenant_id = $1 AND u.role = 'staff'
        ORDER BY u.name ASC`,
      [tenantId, from, toExclusive]
    );

    const staff = result.rows.map((row) => ({
      staff_id: row.id,
      name: row.name,
      total_collected: roundToCents(Number(row.total_collected)),
      payment_count: Number(row.payment_count),
      active_loans_managed: Number(row.active_loans_managed)
    }));

    res.status(200).json({ range: { from: fromIso, to: toIso }, staff });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch agent performance report' });
  }
}
