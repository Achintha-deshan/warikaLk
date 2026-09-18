import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import api, { ApiError } from "../lib/api";
import { ApiNotice, Field, Spinner } from "../components/AuthLayout";
import { getFieldError } from "../components/formUtils";
import ConfirmDialog from "../components/ConfirmDialog";
import { formatDate, formatMoney } from "../lib/format";
import { useAuth } from "../hooks/useAuth";
import type { LoanCalculation, LoanDetail, Payment } from "../types/loan";

const emptyCalculation: LoanCalculation = {};
const today = new Date().toLocaleDateString("en-CA");

function overdueText(level: string | undefined) {
  return level === "critical"
    ? "⚠ Critical overdue"
    : level === "warning"
      ? "• Payment overdue"
      : "— On track";
}
export default function LoanDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const isOwner = user?.role === "owner";
  const [detail, setDetail] = useState<LoanDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [showClose, setShowClose] = useState(false);
  const [defaulting, setDefaulting] = useState(false);
  const [showDefault, setShowDefault] = useState(false);
  const [defaultReason, setDefaultReason] = useState("");
  const [notice, setNotice] = useState("");
  const [errors, setErrors] = useState<Record<string, string[] | string>>({});
  const [defaultErrors, setDefaultErrors] = useState<Record<string, string[] | string>>({});
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(today);
  const [normalChecked, setNormalChecked] = useState(true);
  const [lateChecked, setLateChecked] = useState(false);
  const [principalChecked, setPrincipalChecked] = useState(false);
  const [normalAmount, setNormalAmount] = useState("");
  const [lateAmount, setLateAmount] = useState("");
  const [principalAmount, setPrincipalAmount] = useState("");
  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    api
      .get<LoanDetail>(`/loans/${id}`)
      .then(({ data }) => {
        const calculation = data.calculation ?? emptyCalculation;
        const normalizedDetail: LoanDetail = {
          ...data,
          calculation,
          payments: Array.isArray(data.payments) ? data.payments : [],
          overdue: data.overdue ?? { level: "none", daysOverdue: 0 },
        };
        setDetail(normalizedDetail);
        setAmount(calculation.dailyInstallment?.toString() || "");
        setNormalAmount(calculation.normalAmount?.toString() || "");
        setLateAmount(calculation.lateAmount?.toString() || "");
        setLateChecked(
          Boolean(calculation.lateAmount && calculation.lateAmount > 0),
        );
      })
      .catch((error: ApiError) => setNotice(error.message))
      .finally(() => setLoading(false));
  }, [id]);
  useEffect(() => {
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const recordPayment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!detail || !id) return;
    setSaving(true);
    setNotice("");
    setErrors({});
    const paid_at = new Date(`${paymentDate}T00:00:00.000Z`).toISOString();
    const body =
      detail.loan.loan_type === "daily"
        ? { amount: Number(amount), paid_at }
        : {
            ...(normalChecked && normalAmount
              ? { normal_cycle_amount: Number(normalAmount) }
              : {}),
            ...(lateChecked && lateAmount
              ? { late_charge_amount: Number(lateAmount) }
              : {}),
            ...(principalChecked && principalAmount
              ? { principal_settlement_amount: Number(principalAmount) }
              : {}),
            paid_at,
          };
    try {
      await api.post(`/loans/${id}/payments`, body);
      load();
    } catch (error) {
      const value = error as ApiError;
      setErrors(value.fieldErrors ?? {});
      setNotice(value.message);
    } finally {
      setSaving(false);
    }
  };
  const closeLoan = async () => {
    if (!id) return;
    setClosing(true);
    try {
      await api.patch(`/loans/${id}/close`);
      setShowClose(false);
      load();
    } catch (error) {
      setNotice((error as ApiError).message);
      setShowClose(false);
    } finally {
      setClosing(false);
    }
  };
  const markDefaulted = async () => {
    if (!id || !defaultReason.trim()) {
      setNotice("A reason is required to mark this loan defaulted.");
      return;
    }
    setDefaulting(true);
    setNotice("");
    setDefaultErrors({});
    try {
      await api.patch(`/loans/${id}/mark-defaulted`, {
        reason: defaultReason.trim(),
      });
      setShowDefault(false);
      setDefaultReason("");
      load();
    } catch (error) {
      const value = error as ApiError;
      setDefaultErrors(value.fieldErrors ?? {});
      setNotice(value.message);
    } finally {
      setDefaulting(false);
    }
  };
  if (loading)
    return (
      <section className="page-frame state-block">
        <Spinner />
        <p>Loading loan...</p>
      </section>
    );
  if (!detail)
    return (
      <section className="page-frame">
        <ApiNotice message={notice || "Loan could not be found."} />
        <Link className="text-button" to="/loans">
          ← Back to loans
        </Link>
      </section>
    );
  const { loan, calculation, payments, overdue } = detail;
  const canClose = Boolean(
    calculation.fullySettled ||
    (calculation.remainingAmount != null && calculation.remainingAmount <= 0),
  );
  const totalPaid =
    calculation.totalPaid ||
    calculation.amountPaid ||
    payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
  const progress =
    loan.loan_type === "daily" && calculation.totalAmountDue
      ? Math.min(100, (totalPaid / calculation.totalAmountDue) * 100)
      : 0;
  return (
    <section className="page-frame loan-detail-page">
      <Link className="back-link" to="/loans">
        ← Loans
      </Link>
      <div className="detail-heading">
        <div>
          <span className="loan-type-badge">
            {loan.loan_type === "daily" ? "Daily cash" : "Monthly interest"}
          </span>
          <span className="loan-display-code">
            {loan.display_code || loan.id}
          </span>
          <h1>{loan.customer_name || "Loan detail"}</h1>
          <p className="page-intro">
            <Link className="table-link" to={`/customers/${loan.customer_id}`}>
              {loan.customer_name || "View customer"}
            </Link>{" "}
            · Started {formatDate(loan.start_date)}
          </p>
        </div>
        <div className="loan-status-stack">
          <span
            className={`status-badge ${loan.status === "closed" ? "closed" : "active"}`}
          >
            {loan.status === "closed" ? "✓ Closed" : loan.status === "defaulted" ? "× Defaulted" : "Active"}
          </span>
          <span className={`overdue-label ${overdue.level}`}>
            {overdueText(overdue.level)}
            {overdue.daysOverdue ? ` · ${overdue.daysOverdue} days` : ""}
          </span>
        </div>
      </div>
      <div className="loan-meta">
        <div>
          <span>Principal</span>
          <strong>{formatMoney(loan.principal)}</strong>
        </div>
        <div>
          <span>Interest rate</span>
          <strong>{loan.interest_rate}%</strong>
        </div>
        <div>
          <span>Start date</span>
          <strong>{formatDate(loan.start_date)}</strong>
        </div>
        <div>
          <span>Loan code</span>
          <strong>{loan.display_code || loan.id.slice(0, 8)}</strong>
          <small title={loan.id}>UUID: {loan.id.slice(0, 8)}...</small>
        </div>
      </div>
      <ApiNotice message={notice} />
      {loan.status === "closed" && loan.loan_type === "daily" ? (
        <div className="fully-repaid">
          <span>✓</span>
          <div>
            <h2>Fully repaid — closed</h2>
            <p>
              This daily loan has been automatically closed after qualifying
              payment.
            </p>
          </div>
        </div>
      ) : (
        <div className="due-panel">
          <div>
            <span className="eyebrow">Current due</span>
            {loan.loan_type === "daily" ? (
              <>
                <div className="due-amount">
                  {formatMoney(calculation.dailyInstallment)}
                </div>
                <p>
                  Due today · {formatMoney(calculation.totalAmountDue)} total
                </p>
                <div className="progress-track">
                  <span style={{ width: `${progress}%` }} />
                </div>
                <small>{formatMoney(totalPaid)} paid so far</small>
              </>
            ) : (
              <>
                <div className="due-lines">
                  <p>
                    This cycle{" "}
                    <strong>{formatMoney(calculation.normalAmount)}</strong>
                  </p>
                  {(calculation.lateAmount || 0) > 0 && (
                    <p>
                      Late charge{" "}
                      <strong>{formatMoney(calculation.lateAmount)}</strong>
                    </p>
                  )}
                  <p>
                    Next due{" "}
                    <strong>{formatDate(calculation.nextDueDate)}</strong>
                  </p>
                </div>
              </>
            )}
          </div>
          {loan.loan_type === "monthly" && isOwner && (
            <button
              className="secondary-button"
              type="button"
              disabled={!canClose}
              title={
                canClose
                  ? "Close this fully settled loan"
                  : "The loan must be fully settled before it can be closed"
              }
              onClick={() => setShowClose(true)}
            >
              Close loan
            </button>
          )}
          {loan.status === "active" && isOwner && (
            <button className="secondary-button danger-outline" type="button" onClick={() => setShowDefault(true)}>
              Mark as defaulted
            </button>
          )}
        </div>
      )}
      {loan.status === "active" && (
        <form className="payment-panel" onSubmit={recordPayment} noValidate>
          <div>
            <span className="eyebrow">Record payment</span>
            <h2>
              {loan.loan_type === "daily"
                ? "Collect today’s amount."
                : "Choose what this visit covers."}
            </h2>
          </div>
          <Field
            label="Payment date"
            hint="Backdate only from the loan start date through today."
            error={getFieldError(errors, "paid_at")}
          >
            <input
              type="date"
              value={paymentDate}
              min={loan.start_date}
              max={today}
              onChange={(event) => setPaymentDate(event.target.value)}
            />
          </Field>
          {loan.loan_type === "daily" ? (
            <Field label="Payment amount" error={getFieldError(errors, "amount")}>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="decimal"
              />
            </Field>
          ) : (
            <div className="payment-ticks">
              <label>
                <input
                  type="checkbox"
                  checked={normalChecked}
                  onChange={(event) => setNormalChecked(event.target.checked)}
                />{" "}
                <span>
                  Pay normal cycle amount
                  <small>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={normalAmount}
                      disabled={!normalChecked}
                      onChange={(event) => setNormalAmount(event.target.value)}
                    />{" "}
                  </small>
                  {getFieldError(errors, "normal_cycle_amount") && (
                    <small className="field-error">{getFieldError(errors, "normal_cycle_amount")}</small>
                  )}
                </span>
              </label>
              {(calculation.lateAmount || 0) > 0 && (
                <label>
                  <input
                    type="checkbox"
                    checked={lateChecked}
                    onChange={(event) => setLateChecked(event.target.checked)}
                  />{" "}
                  <span>
                    Pay late charge
                    <small>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={lateAmount}
                        disabled={!lateChecked}
                        onChange={(event) => setLateAmount(event.target.value)}
                      />
                    </small>
                    {getFieldError(errors, "late_charge_amount") && (
                      <small className="field-error">{getFieldError(errors, "late_charge_amount")}</small>
                    )}
                  </span>
                </label>
              )}
              <label>
                <input
                  type="checkbox"
                  checked={principalChecked}
                  onChange={(event) =>
                    setPrincipalChecked(event.target.checked)
                  }
                />{" "}
                <span>
                  Pay towards principal
                  <small>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Optional"
                      value={principalAmount}
                      disabled={!principalChecked}
                      onChange={(event) =>
                        setPrincipalAmount(event.target.value)
                      }
                    />
                  </small>
                  {getFieldError(errors, "principal_settlement_amount") && (
                    <small className="field-error">{getFieldError(errors, "principal_settlement_amount")}</small>
                  )}
                </span>
              </label>
            </div>
          )}
          <button
            className="primary-button"
            type="submit"
            disabled={
              saving ||
              (loan.loan_type === "monthly" &&
                !normalChecked &&
                !lateChecked &&
                !principalChecked)
            }
          >
            {saving ? <Spinner /> : "Record payment"}
            <span aria-hidden="true">↗</span>
          </button>
        </form>
      )}
      <section className="payment-history">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Ledger</span>
            <h2>Payment history</h2>
          </div>
          <span>{payments.length} payments</span>
        </div>
        {payments.length === 0 ? (
          <p className="muted-copy">No payments recorded yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Amount</th>
                <th>Type</th>
                <th>Collected by</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment: Payment) => (
                <tr key={payment.id}>
                  <td>{formatDate(payment.paid_at)}</td>
                  <td>{formatMoney(payment.amount)}</td>
                  <td>{payment.payment_type || "Payment"}</td>
                  <td>{payment.collected_by || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {showClose && (
        <ConfirmDialog
          title="Close this loan?"
          body="Only fully settled loans can be closed. This action marks the agreement complete."
          confirmLabel="Close loan"
          onCancel={() => setShowClose(false)}
          onConfirm={closeLoan}
          loading={closing}
        />
      )}
      {showDefault && (
        <ConfirmDialog
          title="Mark this loan as defaulted?"
          body="This records an irreversible-feeling default and calculates capital loss. Type a reason before confirming."
          confirmLabel="Mark defaulted"
          onCancel={() => { setShowDefault(false); setDefaultReason(""); setDefaultErrors({}) }}
          onConfirm={markDefaulted}
          loading={defaulting}
        >
          <Field label="Reason" error={getFieldError(defaultErrors, "reason")}>
            <input value={defaultReason} onChange={(event) => setDefaultReason(event.target.value)} placeholder="Why is this loan defaulted?" autoFocus />
          </Field>
        </ConfirmDialog>
      )}
    </section>
  );
}
