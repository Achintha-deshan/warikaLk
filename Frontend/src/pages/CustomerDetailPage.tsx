import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import api, { ApiError } from "../lib/api";
import { ApiNotice, Field, Spinner } from "../components/AuthLayout";
import { getFieldError } from "../components/formUtils";
import ConfirmDialog from "../components/ConfirmDialog";
import { useAuth } from "../hooks/useAuth";
import LocationPicker, {
  LocationMapPreview,
} from "../components/LocationPicker";
import { formatDate, formatMoney } from "../lib/format";
import type { Customer } from "../types/data";
import type { Loan } from "../types/loan";

type EditForm = {
  name: string;
  phone: string;
  address: string;
  latitude: string;
  longitude: string;
};
const toForm = (customer: Customer): EditForm => ({
  name: customer.name,
  phone: customer.phone || "",
  address: customer.address || "",
  latitude: customer.latitude?.toString() || "",
  longitude: customer.longitude?.toString() || "",
});

export default function CustomerDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isOwner = user?.role === "owner";
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [form, setForm] = useState<EditForm | null>(null);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [notice, setNotice] = useState("");
  const [errors, setErrors] = useState<Record<string, string[] | string>>({});
  useEffect(() => {
    let active = true;
    if (!id) return;
    const timer = window.setTimeout(() => {
      Promise.all([
        api.get<{ customer: Customer }>(`/customers/${id}`),
        api.get<{ loans: Loan[] }>("/loans", {
          params: { customer_id: id, page: 1, limit: 20 },
        }),
      ])
        .then(([customerResponse, loanResponse]) => {
          if (active) {
            setCustomer(customerResponse.data.customer);
            setForm(toForm(customerResponse.data.customer));
            setLoans(loanResponse.data.loans);
          }
        })
        .catch((error: ApiError) => {
          if (active) setNotice(error.message);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [id]);
  const update = (key: keyof EditForm, value: string) =>
    setForm((current) => (current ? { ...current, [key]: value } : current));
  const updateLocation = (
    latitude: number | undefined,
    longitude: number | undefined,
  ) =>
    setForm((current) =>
      current
        ? {
            ...current,
            latitude: latitude?.toString() || "",
            longitude: longitude?.toString() || "",
          }
        : current,
    );
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!id || !form) return;
    setSaving(true);
    setNotice("");
    setErrors({});
    try {
      const { data } = await api.put<{ customer: Customer }>(
        `/customers/${id}`,
        {
          name: form.name,
          phone: form.phone,
          address: form.address,
          latitude: form.latitude ? Number(form.latitude) : undefined,
          longitude: form.longitude ? Number(form.longitude) : undefined,
        },
      );
      setCustomer(data.customer);
      setForm(toForm(data.customer));
      setEditing(false);
      setNotice("Customer details updated.");
    } catch (error) {
      const value = error as ApiError;
      setErrors(value.fieldErrors ?? {});
      setNotice(value.message);
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    if (!id || deleteConfirmation !== customer?.name) return;
    setDeleting(true);
    setNotice("");
    try {
      await api.delete(`/customers/${id}`);
      navigate("/customers", {
        replace: true,
        state: {
          successMessage: `${customer.name} saha eyage records siyalla ain kara`,
        },
      });
    } catch (error) {
      setNotice((error as ApiError).message);
      setDeleting(false);
      setShowDelete(false);
    }
  };
  if (loading)
    return (
      <section className="page-frame state-block">
        <Spinner />
        <p>Loading customer...</p>
      </section>
    );
  if (!customer || !form)
    return (
      <section className="page-frame">
        <ApiNotice message={notice || "Customer could not be found."} />
        <Link className="text-button" to="/customers">
          ← Back to customers
        </Link>
      </section>
    );
  const loanCount = customer.loan_count ?? customer.loans_count ?? loans.length;
  const paymentCount = customer.payment_count ?? customer.payments_count ?? 0;
  return (
    <section className="page-frame detail-page">
      <Link className="back-link" to="/customers">
        ← Customers
      </Link>
      <div className="detail-heading">
        <div>
          <span className="display-code">{customer.display_code}</span>
          <h1>{customer.name}</h1>
          <p className="page-intro">Customer record and collection details.</p>
        </div>
        <div className="detail-actions">
          <button
            className="secondary-button"
            type="button"
            onClick={() => {
              setEditing((value) => !value);
              setNotice("");
              setErrors({});
            }}
          >
            {editing ? "Cancel edit" : "Edit customer"}
          </button>
          {isOwner && (
            <button
              className="text-button delete-link"
              type="button"
              onClick={() => {
                setDeleteConfirmation("");
                setShowDelete(true);
              }}
            >
              Delete customer
            </button>
          )}
        </div>
      </div>
      <ApiNotice message={notice} />
      {editing ? (
        <form className="detail-form data-form" onSubmit={save} noValidate>
          <div className="form-grid">
            <Field label="Name" error={getFieldError(errors, "name")}>
              <input
                value={form.name}
                onChange={(event) => update("name", event.target.value)}
              />
            </Field>
            <Field label="Phone" error={getFieldError(errors, "phone")}>
              <input
                value={form.phone}
                onChange={(event) => update("phone", event.target.value)}
                inputMode="tel"
              />
            </Field>
          </div>
          <Field label="Address" error={getFieldError(errors, "address")}>
            <input
              value={form.address}
              onChange={(event) => update("address", event.target.value)}
            />
          </Field>
          <div>
            <p className="location-label">Location</p>
            <LocationPicker
              initialLatitude={customer.latitude}
              initialLongitude={customer.longitude}
              onChange={updateLocation}
            />
          </div>
          <button className="primary-button" disabled={saving} type="submit">
            {saving ? <Spinner /> : "Save changes"}
            <span aria-hidden="true">↗</span>
          </button>
        </form>
      ) : (
        <div className="detail-grid">
          <div className="detail-item">
            <span>Phone</span>
            <strong>{customer.phone || "Not provided"}</strong>
          </div>
          <div className="detail-item">
            <span>Address</span>
            <strong>{customer.address || "Not provided"}</strong>
          </div>
          <div className="detail-item">
            <span>Coordinates</span>
            <strong>
              {customer.latitude != null && customer.longitude != null
                ? `${customer.latitude}, ${customer.longitude}`
                : "Not provided"}
            </strong>
          </div>
          <div className="detail-item">
            <span>Added</span>
            <strong>{formatDate(customer.created_at)}</strong>
          </div>
        </div>
      )}
      {customer.latitude != null && customer.longitude != null ? (
        <section className="saved-location">
          <div>
            <p className="location-label">Saved location</p>
            <LocationMapPreview
              latitude={customer.latitude}
              longitude={customer.longitude}
            />
          </div>
          <a
            className="secondary-button directions-link"
            href={`https://maps.google.com/maps?q=${customer.latitude},${customer.longitude}`}
            target="_blank"
            rel="noreferrer"
          >
            Get directions <span aria-hidden="true">↗</span>
          </a>
        </section>
      ) : (
        <div className="no-location">
          <p className="location-label">Location</p>
          <strong>No location set</strong>
          <button
            className="text-button"
            type="button"
            onClick={() => setEditing(true)}
          >
            Add location
          </button>
        </div>
      )}
      <section className="customer-loans">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Agreements</span>
            <h2>Loans</h2>
          </div>
          <Link
            className="secondary-button"
            to={`/loans/new?customer_id=${customer.id}`}
          >
            New loan <span>+</span>
          </Link>
        </div>
        {loans.length === 0 ? (
          <p className="muted-copy">No loans for this customer yet.</p>
        ) : (
          <div className="customer-loan-list">
            {loans.map((loan) => (
              <Link
                className="customer-loan-row"
                to={`/loans/${loan.id}`}
                key={loan.id}
              >
                <span className="loan-type-badge">
                  {loan.loan_type === "daily" ? "Daily" : "Monthly"}
                </span>
                <strong>{formatMoney(loan.principal)}</strong>
                <span>{loan.status === "closed" ? "✓ Closed" : "Active"}</span>
                <span>↗</span>
              </Link>
            ))}
          </div>
        )}
      </section>
      {showDelete && (
        <ConfirmDialog
          title="Delete this customer permanently?"
          body={`${customer.name} ge loans ${loanCount}ka, payments ${paymentCount}ka WITHATAMA permanent widiyata delete wenawa. Meka aye undo karanna baa.`}
          confirmLabel="Delete permanently"
          confirmDisabled={deleteConfirmation !== customer.name}
          onCancel={() => setShowDelete(false)}
          onConfirm={remove}
          loading={deleting}
        >
          <label className="delete-confirm-field">
            Delete karanna &apos;{customer.name}&apos; type karanna
            <input
              value={deleteConfirmation}
              onChange={(event) => setDeleteConfirmation(event.target.value)}
              autoFocus
              autoComplete="off"
            />
          </label>
        </ConfirmDialog>
      )}
    </section>
  );
}
