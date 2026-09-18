// Pure calculation engine for both loan types — no DB access anywhere in
// this file. Every function takes plain data in and returns plain data out,
// so it's callable identically from create/list/detail/record-payment
// handlers, and testable in isolation without a database.

export type LoanType = 'daily' | 'monthly';
export type CycleMode = 'fixed_30' | 'calendar_month';
export type OverdueSeverity = 'ok' | 'warning' | 'critical';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}

// --- Date helpers --------------------------------------------------------
//
// start_date is a plain DATE column (no time, no timezone) in Postgres.
// node-pg's default parser for DATE constructs a JS Date using LOCAL time
// components (new Date(year, month, day)), which means the same DB value
// can resolve to a different calendar day depending on the app server's
// timezone offset from UTC — a real risk for a financial app. To sidestep
// that entirely, every caller in this codebase selects start_date as
// `start_date::text` and passes it here as a plain 'YYYY-MM-DD' string,
// which this file parses deterministically into UTC-midnight Date objects.
// paid_at (TIMESTAMPTZ) doesn't have this problem — it's an unambiguous
// absolute instant — but its time-of-day component is still stripped below
// (see toUtcMidnight) so "days late" is a calendar-day count, not a
// fractional-day one.

function parseIsoDate(isoDate: string): Date {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function toIsoDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toUtcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

// Adds `months` calendar months to `date`, clamping the result to the
// target month's actual last day. Critically, the clamp is re-derived from
// the ORIGINAL day-of-month every time, not carried forward from a previous
// clamp — so:
//   Jan 31, 2024 + 1 month = Feb 29, 2024   (2024 is a leap year: Feb has 29)
//   Jan 31, 2024 + 2 months = Mar 31, 2024  (back to day 31 — March has 31
//                                             days again, NOT stuck at 28/29
//                                             from the February clamp)
//   Jan 31, 2024 + 3 months = Apr 30, 2024  (April only has 30)
//   Jan 31, 2023 + 1 month = Feb 28, 2023   (2023 is not a leap year)
// This matters because a naive `new Date(y, m + n, d)` in JS "overflows" —
// Jan 31 + 1 month would silently become Mar 3 (31 days rolled past Feb's
// 28/29), which is exactly the wrong behavior for a monthly billing anchor.
export function addMonthsClamped(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  const totalMonths = month + months;
  const targetYear = year + Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12;

  // Day 0 of (targetMonth + 1) is the last calendar day of targetMonth.
  // New Date(Date.UTC(y, m, 0)) is a documented JS idiom for "last day of
  // the previous month" — it's how this correctly knows Feb has 28 vs 29
  // days without any manual leap-year check.
  const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, lastDayOfTargetMonth);

  return new Date(Date.UTC(targetYear, targetMonth, clampedDay));
}

function getCycleAnchor(startDate: Date, cycleMode: CycleMode, cycleNumber: number): Date {
  if (cycleNumber === 0) return startDate;
  return cycleMode === 'fixed_30'
    ? new Date(startDate.getTime() + cycleNumber * 30 * MS_PER_DAY)
    : addMonthsClamped(startDate, cycleNumber);
}

// --- Overdue severity (shared by both loan types) -------------------------

export function getOverdueSeverity(daysOverdue: number, warningDays: number, criticalDays: number): OverdueSeverity {
  if (daysOverdue >= criticalDays) return 'critical';
  if (daysOverdue >= warningDays) return 'warning';
  return 'ok';
}

// --- Daily cash loans ------------------------------------------------------

export interface DailyLoanSchedule {
  totalInterest: number;
  totalAmountDue: number;
  dailyInstallment: number;
}

// interestRate is a flat rate over the WHOLE term (e.g. 20 meaning 20% of
// principal, total, for however many totalDays the loan runs) — not a
// periodic/compounding rate. This matches how daily-cash "quick loan"
// products are conventionally quoted in this market (a single flat fee
// baked into a fixed daily collection amount), as distinct from the monthly
// loan's genuinely periodic rate. Worth confirming this is the intended
// convention, since "interest_rate" reads ambiguously without that context.
export function calculateDailyLoanSchedule(
  principal: number,
  interestRate: number,
  totalDays: number
): DailyLoanSchedule {
  const totalInterest = roundToCents(principal * (interestRate / 100));
  const totalAmountDue = roundToCents(principal + totalInterest);
  // Nominal per-day guideline only. totalDays * dailyInstallment will
  // generally NOT exactly equal totalAmountDue after rounding (a few cents
  // either way over the full term) — this is inherent to daily-installment
  // lending and not a bug. Loan closure (isDailyLoanFullyRepaid) compares
  // the actual sum of payments against totalAmountDue directly, never
  // installment count * this figure, so the rounding drift here has no
  // effect on correctness — it's a display/collection-target number only.
  const dailyInstallment = roundToCents(totalAmountDue / totalDays);
  return { totalInterest, totalAmountDue, dailyInstallment };
}

export interface DailyLoanProgress {
  daysSinceStart: number;
  installmentsPaid: number;
  daysBehind: number;
  isOnTrack: boolean;
}

// "On track" is a payment-COUNT check, not an amount check, per the stated
// business rule: on track iff daysSinceStart <= installmentsPaid. A
// customer who pays double one day and skips the next still shows as
// "behind" for the skipped day, even though they're covered on amount —
// that's the literal rule as specified, flagging it here since it's a
// blunt heuristic worth confirming is intentional.
export function calculateDailyLoanProgress(
  startDateIso: string,
  asOfDate: Date,
  installmentsPaid: number
): DailyLoanProgress {
  const startDate = parseIsoDate(startDateIso);
  const today = toUtcMidnight(asOfDate);
  const daysSinceStart = Math.max(0, daysBetween(startDate, today));
  const daysBehind = Math.max(0, daysSinceStart - installmentsPaid);
  return { daysSinceStart, installmentsPaid, daysBehind, isOnTrack: daysBehind === 0 };
}

export function isDailyLoanFullyRepaid(totalAmountDue: number, totalPaid: number): boolean {
  return totalPaid >= totalAmountDue;
}

// --- Monthly interest loans -------------------------------------------------

export interface MonthlyLoanDue {
  nextDueDate: string;
  normalAmount: number;
  lateAmount: number;
  daysIntoLateCycle: number;
}

// Computes what's currently owed on a monthly-interest loan as of `asOfDate`.
//
// Core design point (this is the part the earlier review flagged): the
// schedule of anchor dates is derived ONLY from startDate + cycleMode, never
// from payment history — a late payment changes how much interest has
// accrued, never WHEN the next checkpoint falls. So this function first
// finds "the next fixed anchor after the last payment" (or after startDate,
// if there's no payment yet), independent of asOfDate, and only then asks
// "has asOfDate passed that anchor, and by how much".
//
// Worked example (calendar_month, principal=10000, interestRate=10,
// startDate=2024-01-31, no payments yet, asOfDate=2024-03-10):
//   anchor(1) = addMonthsClamped(Jan 31, 1) = Feb 29, 2024 (leap year)
//   periodStart = startDate = Jan 31 (no payments yet)
//   nextDueDate = smallest anchor > periodStart = anchor(1) = Feb 29
//   cycleLengthDays = daysBetween(Jan 31, Feb 29) = 29
//   normalAmount = 10000 * 0.10 = 1000 (flat — see below)
//   dailyInterestAmount = 1000 / 29 ≈ 34.48/day
//   daysIntoLateCycle = daysBetween(Feb 29, Mar 10) = 10
//   lateAmount = 34.48 * 10 ≈ 344.83
// If instead a normal_cycle+late_charge payment had been made on Mar 10,
// the NEXT call (say asOfDate=Mar 25) recomputes periodStart=Mar 10, and
// nextDueDate becomes anchor(2) = addMonthsClamped(Jan 31, 2) = Mar 31 (NOT
// Apr 9 = Mar10+30 — the schedule didn't move because the payment was
// "late" relative to the original Feb 29 anchor; it just advanced which
// fixed anchor is now the relevant one). daysIntoLateCycle is then 0, since
// Mar 25 hasn't reached Mar 31 yet.
//
// normalAmount is always principal * interestRate/100 flat, regardless of
// which specific cycle's length applies — a monthly rate is, by definition,
// one month's interest, whether that particular month-cycle happened to
// span 28, 29, 30, or 31 days. The variable cycle length only affects the
// DAILY rate used to compute lateAmount for days past the anchor, which
// deliberately uses whichever cycle window "now" currently falls into.
//
// Known limitation: "last payment" for this calculation means the most
// recent normal_cycle or late_charge payment — principal_settlement
// payments never reset this clock, per the explicit business rule that
// principal settlement doesn't affect interest cycling. This also means
// there's no prorated "partial cycle" interest concept: paying resets the
// accrual point to that payment's date, but nothing is owed for the sliver
// of time between two payments within what's still the same fixed cycle
// window (correct — that's the SAME cycle, not a new partial one).
export function calculateMonthlyLoanDue(
  principal: number,
  interestRate: number,
  cycleMode: CycleMode,
  startDateIso: string,
  lastPaymentDate: Date | null,
  asOfDate: Date
): MonthlyLoanDue {
  const startDate = parseIsoDate(startDateIso);
  const rawPeriodStart = lastPaymentDate ? toUtcMidnight(lastPaymentDate) : startDate;
  // Defensive clamp: a payment dated before the loan's start_date shouldn't
  // be possible through normal use, but guarding it here means this
  // function can never divide by a zero-length cycle regardless of what
  // it's given.
  const periodStart = rawPeriodStart.getTime() < startDate.getTime() ? startDate : rawPeriodStart;
  const today = toUtcMidnight(asOfDate);

  let cycleNumber = 0;
  let anchor = startDate;
  const MAX_CYCLES = 1200; // ~100 years of monthly cycles — a runaway guard, not a real limit
  while (anchor.getTime() <= periodStart.getTime() && cycleNumber < MAX_CYCLES) {
    cycleNumber += 1;
    anchor = getCycleAnchor(startDate, cycleMode, cycleNumber);
  }
  const previousAnchor = cycleNumber === 0 ? startDate : getCycleAnchor(startDate, cycleMode, cycleNumber - 1);
  const nextDueDate = anchor;

  const cycleLengthDays = cycleMode === 'fixed_30' ? 30 : daysBetween(previousAnchor, nextDueDate);

  const rawNormalAmount = principal * (interestRate / 100);
  const dailyInterestAmount = rawNormalAmount / cycleLengthDays;
  const daysIntoLateCycle = Math.max(0, daysBetween(nextDueDate, today));
  const rawLateAmount = dailyInterestAmount * daysIntoLateCycle;

  return {
    nextDueDate: toIsoDate(nextDueDate),
    normalAmount: roundToCents(rawNormalAmount),
    lateAmount: roundToCents(rawLateAmount),
    daysIntoLateCycle
  };
}

// --- Composition: one function, called from create/list/detail/payment ----

export interface LoanCalcInput {
  loan_type: LoanType;
  principal: number;
  interest_rate: number;
  total_days: number | null;
  cycle_mode: CycleMode | null;
  start_date: string;
}

export interface LoanPaymentStats {
  installmentsPaid: number;
  dailyTotalPaid: number;
  lastInterestPaymentAt: Date | null;
  principalPaid: number;
}

export interface OverdueThresholds {
  warningDays: number;
  criticalDays: number;
}

export interface DailyLoanState {
  type: 'daily';
  schedule: DailyLoanSchedule;
  progress: DailyLoanProgress;
  isFullyRepaid: boolean;
  overdueSeverity: OverdueSeverity;
  // ESTIMATE, not exact — see calculateDailyLoanSchedule's own note on why a
  // daily_installment payment has no stored principal/interest split. This
  // applies the loan's fixed total-interest ratio to lifetime collections to
  // back into "how much of what's been paid was probably principal" —
  // reasonable for a balance-sheet figure, but a modeling assumption, not a
  // ledger fact. See reportController.ts for where this actually gets used
  // and labeled as such to the client.
  estimatedOutstandingPrincipal: number;
}

export interface MonthlyLoanState {
  type: 'monthly';
  due: MonthlyLoanDue;
  outstandingPrincipal: number;
  overdueSeverity: OverdueSeverity;
}

export type LoanState = DailyLoanState | MonthlyLoanState;

// The single reusable entry point — createLoan, listLoans, getLoan, and
// recordPayment all call this instead of duplicating the daily-vs-monthly
// branch and the schedule/due calculations inline.
export function computeLoanState(
  loan: LoanCalcInput,
  stats: LoanPaymentStats,
  thresholds: OverdueThresholds,
  asOfDate: Date
): LoanState {
  if (loan.loan_type === 'daily') {
    const schedule = calculateDailyLoanSchedule(loan.principal, loan.interest_rate, loan.total_days as number);
    const progress = calculateDailyLoanProgress(loan.start_date, asOfDate, stats.installmentsPaid);
    const isFullyRepaid = isDailyLoanFullyRepaid(schedule.totalAmountDue, stats.dailyTotalPaid);
    const principalRatio = loan.principal / schedule.totalAmountDue;
    const estimatedOutstandingPrincipal = roundToCents(
      Math.max(0, loan.principal - stats.dailyTotalPaid * principalRatio)
    );
    return {
      type: 'daily',
      schedule,
      progress,
      isFullyRepaid,
      overdueSeverity: getOverdueSeverity(progress.daysBehind, thresholds.warningDays, thresholds.criticalDays),
      estimatedOutstandingPrincipal
    };
  }

  const due = calculateMonthlyLoanDue(
    loan.principal,
    loan.interest_rate,
    loan.cycle_mode as CycleMode,
    loan.start_date,
    stats.lastInterestPaymentAt,
    asOfDate
  );
  const outstandingPrincipal = roundToCents(loan.principal - stats.principalPaid);
  return {
    type: 'monthly',
    due,
    outstandingPrincipal,
    overdueSeverity: getOverdueSeverity(due.daysIntoLateCycle, thresholds.warningDays, thresholds.criticalDays)
  };
}
