-- Tenants (Business accounts)
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name TEXT NOT NULL,
  daily_cash_enabled BOOLEAN DEFAULT true,
  monthly_interest_enabled BOOLEAN DEFAULT true,
  overdue_warning_days INT DEFAULT 7,
  overdue_critical_days INT DEFAULT 14,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Users (Owner + Staff)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'staff')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Customers (Borrowers)
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Loans (Daily cash + Monthly interest, both types)
CREATE TABLE loans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  created_by UUID REFERENCES users(id),
  loan_type TEXT NOT NULL CHECK (loan_type IN ('daily', 'monthly')),
  principal NUMERIC(12,2) NOT NULL,
  interest_rate NUMERIC(5,2) NOT NULL,
  total_days INT,                    -- daily loans witharai
  cycle_mode TEXT CHECK (cycle_mode IN ('fixed_30', 'calendar_month')), -- monthly loans witharai
  start_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed', 'defaulted')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Payments (collections against a loan)
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id UUID NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL,
  payment_type TEXT CHECK (payment_type IN ('normal_cycle', 'late_charge', 'daily_installment', 'principal_settlement')),
  collected_by UUID REFERENCES users(id),
  paid_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes (query performance)
CREATE INDEX idx_users_tenant ON users(tenant_id);
CREATE INDEX idx_customers_tenant ON customers(tenant_id);
CREATE INDEX idx_loans_tenant ON loans(tenant_id);
CREATE INDEX idx_loans_customer ON loans(customer_id);
CREATE INDEX idx_payments_loan ON payments(loan_id);