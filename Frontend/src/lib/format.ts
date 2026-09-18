export function formatMoney(value: number | string | null | undefined) {
  const amount = Number(value ?? 0)
  return `Rs. ${Number.isFinite(amount) ? amount.toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}`
}

export function formatDate(value: string | Date | null | undefined) {
  if (!value) return 'Not set'
  return new Date(value).toLocaleDateString('en-LK', { year: 'numeric', month: 'short', day: 'numeric' })
}

export function addMonths(date: string, months: number) {
  const next = new Date(`${date}T00:00:00`)
  next.setMonth(next.getMonth() + months)
  return next.toLocaleDateString('en-CA')
}
