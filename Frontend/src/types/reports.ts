import type { LoanType } from './loan'

export type ReportDateRange = { from: string; to: string }

export type ReportSummary = {
  total_collected: number
  total_interest_earned: number
  daily_profit: number
  monthly_profit: number
  methodology_note: string
  total_outstanding_principal: number
  active_loans_count: number
  closed_loans_count: number
  defaulted_loans_count: number
  overdue_count: number
  by_loan_type?: Record<LoanType, { interest_earned?: number; total_interest_earned?: number; estimated_daily?: boolean; [key: string]: unknown }>
}

export type InterestPayment = {
  paid_at: string
  amount: number
  payment_type?: string
  customer_name?: string
  customer_display_code?: string
  customer_id?: string
  loan_display_code?: string
  loan_type: LoanType
  collected_by_name?: string
}

export type Pagination = { page: number; limit: number; total: number; total_pages?: number; pages?: number }
export type InterestPaymentsResponse = { payments: InterestPayment[]; pagination: Pagination }

export type DefaultedLoan = {
  loan_display_code: string
  customer_name?: string
  customer_id?: string
  principal: number
  total_paid_before_default: number
  capital_loss: number
  defaulted_at: string
  default_reason?: string
}

export type DefaultedResponse = { loans: DefaultedLoan[]; total_capital_loss: number }
export type AgentPerformance = { id: string; name: string; total_collected: number; payment_count: number; active_loans_managed: number }