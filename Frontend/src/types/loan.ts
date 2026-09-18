export type LoanType = 'daily' | 'monthly'
export type LoanStatus = 'active' | 'closed' | 'defaulted'
export type CycleMode = 'fixed_30' | 'calendar_month'

export type LoanCalculation = {
  totalInterest?: number
  totalAmountDue?: number
  dailyInstallment?: number
  nextDueDate?: string
  normalAmount?: number
  lateAmount?: number
  daysIntoLateCycle?: number
  amountPaid?: number
  totalPaid?: number
  remainingAmount?: number
  daysPaid?: number
  fullySettled?: boolean
}

export type Loan = {
  id: string
  tenant_id: string
  customer_id: string
  display_code?: string
  customer_name?: string
  customer_display_code?: string
  loan_type: LoanType
  principal: number
  interest_rate: number
  total_days?: number | null
  cycle_mode?: CycleMode | null
  start_date: string
  status: LoanStatus
  created_at: string
  calculation?: LoanCalculation
  overdue?: { level: 'none' | 'warning' | 'critical'; daysOverdue: number }
}

export type Payment = { id: string; amount: number; payment_type?: string; collected_by?: string; paid_at: string }
export type LoanDetail = { loan: Loan; calculation: LoanCalculation; payments: Payment[]; overdue: { level: 'none' | 'warning' | 'critical'; daysOverdue: number } }
