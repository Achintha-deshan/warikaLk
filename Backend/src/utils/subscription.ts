export type TenantSubscriptionStatus = 'trial' | 'active' | 'expired';

// 'active' takes priority over 'trial' when both would technically apply
// (e.g. paid early, while still inside the trial window) — it's the more
// informative label for a platform admin deciding who still needs to pay.
export function computeTenantStatus(
  now: Date,
  trialEndsAt: Date | null,
  paidUntil: Date | null
): TenantSubscriptionStatus {
  if (paidUntil !== null && now.getTime() < paidUntil.getTime()) {
    return 'active';
  }
  if (trialEndsAt !== null && now.getTime() < trialEndsAt.getTime()) {
    return 'trial';
  }
  return 'expired';
}

export function isSubscriptionActive(now: Date, trialEndsAt: Date | null, paidUntil: Date | null): boolean {
  return computeTenantStatus(now, trialEndsAt, paidUntil) !== 'expired';
}
