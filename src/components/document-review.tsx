"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  History,
  LoaderCircle,
  RotateCcw,
  Save,
  ScanLine,
  ShieldCheck,
  Trash2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  ApiError,
  api,
  message,
  useResource,
  type ProcurementDocument,
  type Project,
} from "@/lib/client";
import { formatDate } from "@/lib/i18n";
import {
  Button,
  Empty,
  Loading,
  Modal,
  Notice,
  PageHeader,
  Status,
  formatBytes,
} from "@/components/ui";
import { useWorkspace } from "@/components/workspace";

interface Field {
  path: string;
  value: string | null;
  originalText: string | null;
  pageNumber: number | null;
  documentId: string;
  status: "extracted" | "missing" | "ambiguous" | "corrected";
}
interface Correction {
  path: string;
  value: string | null;
  status: "corrected" | "ambiguous";
}
interface Audit {
  id: string;
  action: string;
  createdAt: string;
  actorName?: string;
  changes?: {
    path: string;
    before: { value: string | null };
    after: { value: string | null };
  }[];
  metadata?: {
    changes?: {
      path: string;
      before: { value: string | null };
      after: { value: string | null };
    }[];
  };
}
interface Extraction {
  data: unknown;
  originalData: unknown;
  fields: Field[];
  version: number;
  approvedAt: string | null;
  corrections: Audit[];
  pages: { pageNumber: number; markdown: string }[];
  issues?: string[];
  approvalIssues?: string[];
}
const sectionLabels: Record<string, string> = {
  documentType: "Document classification",
  supplier: "Supplier",
  quotation: "Quotation",
  products: "Products & specifications",
  pricing: "Pricing",
  logistics: "Logistics",
  compliance: "Compliance",
};
function fieldLabel(path: string) {
  return path
    .split(".")
    .at(-1)!
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}
function getOriginal(root: unknown, path: string): string | null {
  let value = root;
  for (const part of path.split(".")) {
    if (!value || typeof value !== "object") return null;
    value = (value as Record<string, unknown>)[part];
  }
  return value && typeof value === "object" && "value" in value
    ? String((value as { value: unknown }).value ?? "") || null
    : null;
}

export function DocumentReview({ id }: { id: string }) {
  const document = useResource<ProcurementDocument>(
    `/api/documents/${id}`,
    5000,
  );
  const available =
    document.data &&
    ["completed", "review_required"].includes(document.data.status);
  const extraction = useResource<Extraction>(
    available ? `/api/documents/${id}/extraction` : null,
  );
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(100);
  const [tab, setTab] = useState("fields");
  const [draft, setDraft] = useState<Record<string, Correction>>({});
  const [actionError, setActionError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [approveOpen, setApproveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const projects = useResource<Project[]>("/api/projects");
  const { workspace } = useWorkspace();
  const router = useRouter();
  const doc = document.data;
  const result = extraction.data;
  const changes = Object.values(draft);
  const pageCount = result?.pages.length ?? 0;
  const groups = useMemo(() => {
    const groups: Record<string, Field[]> = {};
    for (const field of result?.fields ?? []) {
      const key = field.path.startsWith("products.")
        ? field.path.split(".").slice(0, 2).join(".")
        : field.path.split(".")[0]!;
      (groups[key] ??= []).push(field);
    }
    return Object.entries(groups);
  }, [result]);
  const ambiguous =
    result?.fields.filter(
      (f) => (draft[f.path]?.status ?? f.status) === "ambiguous",
    ).length ?? 0;
  useEffect(() => {
    if (!changes.length) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [changes.length]);
  async function analyze() {
    setBusy("analyze");
    setActionError("");
    setSuccess("");
    try {
      await api(`/api/documents/${id}/analyze`, { method: "POST", body: "{}" });
      document.refresh();
    } catch (error) {
      setActionError(message(error));
    } finally {
      setBusy(null);
    }
  }
  async function save() {
    if (!result) return;
    setBusy("save");
    setActionError("");
    setSuccess("");
    try {
      const updated = await api<Extraction>(`/api/documents/${id}/extraction`, {
        method: "PATCH",
        body: JSON.stringify({ version: result.version, corrections: changes }),
      });
      if (updated?.fields) extraction.setData(updated);
      else extraction.refresh();
      setDraft({});
      document.refresh();
      setSuccess("Your corrections have been saved to the audit trail.");
    } catch (error) {
      setActionError(message(error));
      setConflict(error instanceof ApiError && error.status === 409);
    } finally {
      setBusy(null);
    }
  }
  async function approve() {
    if (!result) return;
    setBusy("approve");
    setActionError("");
    try {
      await api(`/api/documents/${id}/approve`, {
        method: "POST",
        body: JSON.stringify({ version: result.version }),
      });
      setApproveOpen(false);
      document.refresh();
      extraction.refresh();
      setSuccess(
        "Analysis approved. Your team’s verified information is saved.",
      );
    } catch (error) {
      setActionError(message(error));
      setConflict(error instanceof ApiError && error.status === 409);
      setApproveOpen(false);
    } finally {
      setBusy(null);
    }
  }
  async function move(projectId: string | null) {
    setBusy("move");
    setActionError("");
    setSuccess("");
    try {
      const moved = await api<ProcurementDocument>(`/api/documents/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ projectId }),
      });
      if (moved) document.setData(moved);
      else document.refresh();
      const name = projects.data?.find((p) => p.id === projectId)?.name;
      setSuccess(name ? `Document moved to ${name}.` : "Document removed from its project.");
    } catch (error) {
      setActionError(message(error));
    } finally {
      setBusy(null);
    }
  }
  async function remove() {
    if (!doc) return;
    setBusy("delete");
    setDeleteError("");
    try {
      await api(`/api/documents/${id}`, { method: "DELETE" });
      setDraft({});
      router.replace(
        doc.projectId ? `/projects/${doc.projectId}` : "/documents",
      );
    } catch (error) {
      setDeleteError(message(error));
      setBusy(null);
    }
  }
  function edit(field: Field, value: string, uncertain?: boolean) {
    const nextStatus =
      uncertain === undefined
        ? (draft[field.path]?.status ?? "corrected")
        : uncertain
          ? "ambiguous"
          : "corrected";
    setDraft((previous) => {
      const next = { ...previous };
      if ((value || null) === field.value && nextStatus === field.status)
        delete next[field.path];
      else
        next[field.path] = {
          path: field.path,
          value: value.trim() ? value : null,
          status: nextStatus,
        };
      return next;
    });
    setSuccess("");
  }
  if (document.loading) return <Loading label="Opening private document" />;
  if (document.error || !doc)
    return (
      <>
        <Link href="/documents" className="back-link">
          <ArrowLeft size={13} />
          All documents
        </Link>
        <Notice>{document.error?.message ?? "Document unavailable."}</Notice>
      </>
    );
  const processing = ["queued", "processing"].includes(doc.status);
  // The server enforces the same rule; this only hides an action that would be refused.
  const canDelete =
    doc.uploadedBy === workspace.user.id ||
    workspace.role.split(",").some((r) => r === "owner" || r === "admin");
  return (
    <>
      <Link
        href={doc.projectId ? `/projects/${doc.projectId}` : "/documents"}
        className="back-link"
      >
        <ArrowLeft size={13} />
        {doc.projectId ? "Back to project" : "All documents"}
      </Link>
      <div className="document-heading">
        <PageHeader
          title={doc.fileName}
          description={`${doc.mimeType === "application/pdf" ? "PDF document" : "Image document"} · ${formatBytes(doc.size)} · Uploaded ${formatDate(doc.createdAt)}`}
          action={
            <>
              <Status
                status={doc.status}
                approved={Boolean(doc.approvedAt ?? result?.approvedAt)}
              />
              <select
                className="select select-compact"
                aria-label="Procurement project"
                value={doc.projectId ?? ""}
                onChange={(event) => void move(event.target.value || null)}
                disabled={busy !== null || projects.loading}
              >
                <option value="">No project</option>
                {projects.data
                  ?.filter((p) => p.status !== "archived" || p.id === doc.projectId)
                  .map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
              <a
                className="button button-secondary"
                href={`/api/documents/${id}/content`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ArrowUpRight size={13} />
                Open original
              </a>
              {canDelete && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setDeleteError("");
                    setDeleteOpen(true);
                  }}
                  aria-label="Delete document"
                >
                  <Trash2 size={13} />
                  Delete
                </Button>
              )}
            </>
          }
        />
      </div>
      {actionError && (
        <div style={{ marginBottom: 15 }}>
          <Notice>
            {actionError}
            {conflict && (
              <div style={{ marginTop: 8 }}>
                <button
                  className="text-link"
                  onClick={() => {
                    setDraft({});
                    setConflict(false);
                    setActionError("");
                    extraction.refresh();
                    document.refresh();
                  }}
                >
                  Reload latest analysis and discard unsaved changes
                </button>
              </div>
            )}
          </Notice>
        </div>
      )}
      {success && (
        <div style={{ marginBottom: 15 }}>
          <Notice kind="success">{success}</Notice>
        </div>
      )}
      <div className="review-layout">
        <section className="document-viewer" aria-label="Original document">
          <div className="viewer-toolbar">
            <div className="row">
              <button
                className="icon-button"
                aria-label="Previous page"
                disabled={page <= 1 || doc.mimeType !== "application/pdf"}
                onClick={() => setPage(Math.max(1, page - 1))}
              >
                <ChevronLeft size={14} />
              </button>
              <label htmlFor="viewer-page" className="sr-only">
                Document page
              </label>
              <input
                id="viewer-page"
                type="number"
                min={1}
                max={pageCount || undefined}
                value={page}
                disabled={doc.mimeType !== "application/pdf"}
                onChange={(e) =>
                  setPage(
                    Math.max(
                      1,
                      Math.min(pageCount || 10000, Number(e.target.value) || 1),
                    ),
                  )
                }
              />
              <span className="muted">
                {pageCount ? `of ${pageCount}` : "page"}
              </span>
              <button
                className="icon-button"
                aria-label="Next page"
                disabled={
                  (pageCount > 0 && page >= pageCount) ||
                  doc.mimeType !== "application/pdf"
                }
                onClick={() => setPage(page + 1)}
              >
                <ChevronRight size={14} />
              </button>
            </div>
            <div className="row">
              <button
                className="icon-button"
                aria-label="Zoom out"
                disabled={zoom <= 50}
                onClick={() => setZoom(Math.max(50, zoom - 25))}
              >
                <ZoomOut size={14} />
              </button>
              <span style={{ minWidth: 34, textAlign: "center" }}>{zoom}%</span>
              <button
                className="icon-button"
                aria-label="Zoom in"
                disabled={zoom >= 200}
                onClick={() => setZoom(Math.min(200, zoom + 25))}
              >
                <ZoomIn size={14} />
              </button>
            </div>
          </div>
          <div className="viewer-body">
            {doc.mimeType === "application/pdf" ? (
              <iframe
                key={`${page}-${zoom}`}
                title={`Original document: ${doc.fileName}, page ${page}`}
                src={`/api/documents/${id}/content#page=${page}&zoom=${zoom}&toolbar=0&navpanes=0`}
                width="100%"
                height="100%"
              />
            ) : (
              <Image
                unoptimized
                width={1000}
                height={1000}
                src={`/api/documents/${id}/content`}
                alt={`Original document: ${doc.fileName}`}
                style={{ width: `${zoom}%` }}
              />
            )}
          </div>
          <div className="viewer-footer">
            <span className="row" style={{ gap: 5 }}>
              <ShieldCheck size={11} />
              Authorized access only
            </span>
            <a
              href={`/api/documents/${id}/content`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-link"
              style={{ fontSize: 9 }}
            >
              Open full document
            </a>
          </div>
        </section>
        <div className="review-panel">
          {!available ? (
            <section className="section-card processing-card">
              {processing ? (
                <LoaderCircle className="spin" size={28} />
              ) : (
                <ScanLine size={28} className="muted" />
              )}
              <h2>
                {processing
                  ? doc.status === "queued"
                    ? "Analysis is queued"
                    : "Analyzing your document"
                  : doc.status === "failed"
                    ? "Analysis needs another attempt"
                    : "Ready for document intelligence"}
              </h2>
              <p>
                {processing
                  ? "The background worker is extracting text and structuring procurement information. You can leave this page and return later."
                  : doc.status === "failed"
                    ? "The document could not be fully analyzed. You can retry processing; your original file remains securely stored."
                    : "Analyze this document to identify supplier details, products, commercial terms, and technical specifications with page-level source evidence."}
              </p>
              {doc.errorCode && (
                <Notice>
                  Processing issue:{" "}
                  {doc.errorCode.replaceAll("_", " ").toLowerCase()}. Check
                  processing configuration or try again.
                </Notice>
              )}
              {processing ? (
                <div className="pipeline">
                  <span>Private document</span>→
                  <span className="current">OCR & extraction</span>→
                  <span>Review</span>
                </div>
              ) : (
                <>
                  <Button onClick={analyze} loading={busy === "analyze"}>
                    {doc.status === "failed" ? (
                      <RotateCcw size={14} />
                    ) : (
                      <ScanLine size={14} />
                    )}
                    {doc.status === "failed"
                      ? "Retry analysis"
                      : "Analyze document"}
                  </Button>
                  <p className="review-disclaimer">
                    Analysis sends document contents to Mistral. An
                    administrator must first enable processing in{" "}
                    <Link href="/settings/organization" className="text-link">
                      organization settings
                    </Link>
                    .
                  </p>
                </>
              )}
            </section>
          ) : extraction.loading ? (
            <Loading label="Loading extracted intelligence" />
          ) : extraction.error ? (
            <Notice>
              {extraction.error.message}{" "}
              <button className="text-link" onClick={extraction.refresh}>
                Try again
              </button>
            </Notice>
          ) : (
            result && (
              <>
                <section className="section-card">
                  <div className="review-summary">
                    <div className="row-between">
                      <h2>Procurement intelligence</h2>
                      <span className="count">v{result.version}</span>
                    </div>
                    <p>
                      {result.approvedAt
                        ? `Approved ${formatDate(result.approvedAt)}. Further corrections require approval again.`
                        : "Verify extracted values against the source before approving this analysis."}
                    </p>
                    {ambiguous > 0 && (
                      <div
                        className="small"
                        style={{ color: "#a67614", marginTop: 10 }}
                      >
                        {ambiguous} uncertain{" "}
                        {ambiguous === 1 ? "field requires" : "fields require"}{" "}
                        review before approval.
                      </div>
                    )}
                    {Boolean(result.approvalIssues?.length) && (
                      <details className="small" style={{ marginTop: 10 }}>
                        <summary
                          style={{ cursor: "pointer", color: "#a67614" }}
                        >
                          Items to resolve before approval
                        </summary>
                        <ul
                          style={{
                            marginTop: 8,
                            paddingLeft: 17,
                            color: "var(--muted)",
                            fontSize: 10,
                          }}
                        >
                          {result.approvalIssues?.map((issue) => {
                            const [path, ...reason] = issue.split(":");
                            const product = path?.match(/^products\.(\d+)\./);
                            return (
                              <li key={issue}>
                                {product
                                  ? `Product ${Number(product[1]) + 1} · `
                                  : ""}
                                {fieldLabel(path ?? "Field")}:{" "}
                                {reason.join(":")}
                              </li>
                            );
                          })}
                        </ul>
                      </details>
                    )}
                  </div>
                  <div
                    className="review-tabs"
                    role="tablist"
                    aria-label="Document analysis views"
                  >
                    {[
                      { id: "fields", title: "Extracted data" },
                      { id: "ocr", title: "OCR text" },
                      { id: "audit", title: "Audit trail" },
                    ].map((t) => (
                      <button
                        key={t.id}
                        role="tab"
                        id={`tab-${t.id}`}
                        aria-selected={tab === t.id}
                        aria-controls={`panel-${t.id}`}
                        onClick={() => setTab(t.id)}
                        className={tab === t.id ? "active" : ""}
                      >
                        {t.title}
                      </button>
                    ))}
                  </div>
                  {tab === "fields" && (
                    <div
                      role="tabpanel"
                      id="panel-fields"
                      aria-labelledby="tab-fields"
                    >
                      {groups.map(([key, fields]) => (
                        <details className="extraction-section" key={key} open>
                          <summary>
                            {key.startsWith("products.")
                              ? `Product ${Number(key.split(".")[1]) + 1}`
                              : (sectionLabels[key] ?? fieldLabel(key))}
                            <span className="count">
                              {fields.filter((f) => f.value !== null).length}/
                              {fields.length}
                            </span>
                          </summary>
                          <div className="evidence-fields">
                            {fields.map((field) => {
                              const current = draft[field.path];
                              const original = getOriginal(
                                result.originalData,
                                field.path,
                              );
                              const inputId = `field-${field.path}`;
                              return (
                                <div
                                  className="evidence-field"
                                  key={field.path}
                                >
                                  <div className="evidence-label">
                                    <label htmlFor={inputId}>
                                      <strong>
                                        {field.path.includes(".priceBreaks.")
                                          ? `Price tier ${Number(field.path.split(".")[3]) + 1} · `
                                          : ""}
                                        {fieldLabel(field.path)}
                                      </strong>
                                    </label>
                                    <Status
                                      status={current?.status ?? field.status}
                                    />
                                  </div>
                                  <input
                                    id={inputId}
                                    className={`input ${current ? "changed" : ""}`}
                                    value={
                                      current
                                        ? (current.value ?? "")
                                        : (field.value ?? "")
                                    }
                                    placeholder="Not found in document"
                                    maxLength={8000}
                                    onChange={(event) =>
                                      edit(field, event.target.value)
                                    }
                                    disabled={busy !== null}
                                  />
                                  {field.originalText ? (
                                    <div className="source-quote">
                                      “{field.originalText}”
                                    </div>
                                  ) : (
                                    <div className="evidence-source">
                                      No source text available for this field.
                                    </div>
                                  )}
                                  <div className="evidence-source">
                                    <span>
                                      {field.status === "corrected" || current
                                        ? `AI extracted: ${original ?? "not found"}`
                                        : "From original document"}
                                    </span>
                                    {field.pageNumber && (
                                      <button
                                        className="source-button"
                                        onClick={() =>
                                          setPage(field.pageNumber!)
                                        }
                                      >
                                        View page {field.pageNumber} ↗
                                      </button>
                                    )}
                                  </div>
                                  <label className="field-flags">
                                    <input
                                      type="checkbox"
                                      checked={
                                        (current?.status ?? field.status) ===
                                        "ambiguous"
                                      }
                                      onChange={(event) =>
                                        edit(
                                          field,
                                          current
                                            ? (current.value ?? "")
                                            : (field.value ?? ""),
                                          event.target.checked,
                                        )
                                      }
                                      disabled={busy !== null}
                                    />
                                    Flag as uncertain
                                  </label>
                                </div>
                              );
                            })}
                          </div>
                        </details>
                      ))}
                      {!groups.length && (
                        <Empty title="No extracted fields">
                          The analysis did not return structured procurement
                          information.
                        </Empty>
                      )}
                    </div>
                  )}
                  {tab === "ocr" && (
                    <div
                      role="tabpanel"
                      id="panel-ocr"
                      aria-labelledby="tab-ocr"
                    >
                      {result.pages.length ? (
                        result.pages.map((p) => (
                          <article className="ocr-page" key={p.pageNumber}>
                            <div className="row-between">
                              <h3>Page {p.pageNumber}</h3>
                              <button
                                className="text-link"
                                onClick={() => setPage(p.pageNumber)}
                              >
                                View source
                              </button>
                            </div>
                            <pre>
                              {p.markdown || "No readable text on this page."}
                            </pre>
                          </article>
                        ))
                      ) : (
                        <Empty title="No OCR pages">
                          No page text is available for this analysis.
                        </Empty>
                      )}
                    </div>
                  )}
                  {tab === "audit" && (
                    <div
                      role="tabpanel"
                      id="panel-audit"
                      aria-labelledby="tab-audit"
                    >
                      {result.corrections.length ? (
                        result.corrections.map((entry) => (
                          <article key={entry.id} className="audit-entry">
                            <div className="row-between">
                              <strong>
                                {entry.action
                                  .replaceAll("_", " ")
                                  .replaceAll(".", " ")}
                              </strong>
                              <span className="muted" style={{ fontSize: 9 }}>
                                {formatDate(entry.createdAt)}
                              </span>
                            </div>
                            {entry.actorName && <p>By {entry.actorName}</p>}
                            {(entry.changes ?? entry.metadata?.changes)?.map(
                              (change, index) => (
                                <p key={index}>
                                  <strong>{fieldLabel(change.path)}</strong>
                                  <br />
                                  {change.before.value ?? "Missing"} →{" "}
                                  {change.after.value ?? "Cleared"}
                                </p>
                              ),
                            )}
                          </article>
                        ))
                      ) : (
                        <Empty
                          icon={<History size={23} />}
                          title="No user changes yet"
                        >
                          Corrections and approvals are recorded here with their
                          author and time.
                        </Empty>
                      )}
                    </div>
                  )}
                  <div className="review-actions">
                    <span>
                      {changes.length
                        ? `${changes.length} unsaved ${changes.length === 1 ? "change" : "changes"}`
                        : "All changes saved"}
                    </span>
                    <div className="row">
                      <Button
                        variant="secondary"
                        onClick={save}
                        loading={busy === "save"}
                        disabled={!changes.length || busy !== null}
                      >
                        <Save size={12} />
                        Save corrections
                      </Button>
                      <Button
                        onClick={() => setApproveOpen(true)}
                        disabled={
                          changes.length > 0 ||
                          ambiguous > 0 ||
                          Boolean(result.approvalIssues?.length) ||
                          busy !== null ||
                          Boolean(result.approvedAt)
                        }
                      >
                        <Check size={13} />
                        {result.approvedAt ? "Approved" : "Approve"}
                      </Button>
                    </div>
                  </div>
                </section>
                <p className="review-disclaimer">
                  AI interpretation can contain errors. Missing information
                  stays empty. Source text and original AI extraction are
                  preserved when you make corrections. Prices are stored as
                  exact decimal strings; verify currency, units, and price
                  basis.
                </p>
              </>
            )
          )}
        </div>
      </div>
      <Modal
        open={approveOpen}
        onOpenChange={setApproveOpen}
        title="Approve this analysis?"
        description="Confirm that you have reviewed the extracted values against the original document. Approval will be recorded in the audit trail."
      >
        <Notice kind="info">
          Approval confirms your review. Missing values remain explicitly
          missing; no supplier data or compliance claims are inferred.
        </Notice>
        <div className="form-actions">
          <Button variant="secondary" onClick={() => setApproveOpen(false)}>
            Continue reviewing
          </Button>
          <Button loading={busy === "approve"} onClick={approve}>
            <Check size={14} />
            Approve analysis
          </Button>
        </div>
      </Modal>
      <Modal
        open={deleteOpen}
        onOpenChange={(open) => busy !== "delete" && setDeleteOpen(open)}
        title="Delete this document?"
        description="The original file, its analysis, pages and corrections will be permanently removed. This cannot be undone."
      >
        <Notice kind="info">
          {doc.fileName} will disappear from supplier and analytics views. The
          audit history keeps a record of the deletion, but not the document
          content.
        </Notice>
        {deleteError && <Notice>{deleteError}</Notice>}
        <div className="form-actions">
          <Button
            variant="secondary"
            disabled={busy === "delete"}
            onClick={() => setDeleteOpen(false)}
          >
            Cancel
          </Button>
          <Button variant="danger" loading={busy === "delete"} onClick={remove}>
            <Trash2 size={14} />
            Delete permanently
          </Button>
        </div>
      </Modal>
    </>
  );
}
