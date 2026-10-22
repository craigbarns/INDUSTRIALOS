"use client";
import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { useResource, type ProcurementDocument } from "@/lib/client";
import { Button, Empty, Loading, Notice, PageHeader } from "@/components/ui";
import { UploadDialog } from "@/components/upload-dialog";
import { DocumentTable } from "@/components/document-table";
export default function DocumentsPage() {
  return (
    <Suspense fallback={<Loading label="Loading documents" />}>
      <DocumentsContent />
    </Suspense>
  );
}
function DocumentsContent() {
  const params = useSearchParams();
  const { data, error, loading, refresh } = useResource<ProcurementDocument[]>(
    "/api/documents",
    8000,
  );
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [statusOverride, setStatus] = useState<string | null>(null);
  const status = statusOverride ?? params.get("status") ?? "all";
  const [sort, setSort] = useState("newest");
  const documents = useMemo(
    () =>
      (data ?? [])
        .filter(
          (d) =>
            d.fileName.toLowerCase().includes(query.toLowerCase()) &&
            (status === "all" || d.status === status),
        )
        .sort((a, b) =>
          sort === "name"
            ? a.fileName.localeCompare(b.fileName)
            : Date.parse(b.createdAt) - Date.parse(a.createdAt),
        ),
    [data, query, status, sort],
  );
  return (
    <>
      <PageHeader
        eyebrow="Intelligence"
        title="Documents"
        description="From supplier documents to structured procurement intelligence."
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus size={14} />
            Upload document
          </Button>
        }
      />
      {error && (
        <Notice>
          {error.message}{" "}
          <button className="text-link" onClick={refresh}>
            Try again
          </button>
        </Notice>
      )}
      <section className="section-card">
        <div className="toolbar">
          <div className="search-field">
            <Search size={14} />
            <input
              className="input"
              aria-label="Search documents"
              placeholder="Search documents…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <select
            className="select"
            aria-label="Filter document status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="uploaded">Uploaded</option>
            <option value="queued">Queued</option>
            <option value="processing">Processing</option>
            <option value="completed">Completed</option>
            <option value="review_required">Review required</option>
            <option value="failed">Failed</option>
          </select>
          <select
            className="select"
            aria-label="Sort documents"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="newest">Newest first</option>
            <option value="name">Name A–Z</option>
          </select>
        </div>
        {loading ? (
          <Loading label="Loading documents" />
        ) : documents.length ? (
          <DocumentTable documents={documents} />
        ) : (
          <Empty
            title={
              query || status !== "all"
                ? "No matching documents"
                : "Your first document is the starting point"
            }
            action={
              !query && status === "all" ? (
                <Button variant="secondary" onClick={() => setOpen(true)}>
                  <Plus size={13} />
                  Upload document
                </Button>
              ) : undefined
            }
          >
            {query || status !== "all"
              ? "Try another search or processing status."
              : "Upload a supplier quotation or technical specification. PDF, PNG, and JPEG files up to 20 MB are supported."}
          </Empty>
        )}
      </section>
      <div className="footer-note">
        <span>{data?.length ?? 0} documents in your organization</span>
        <span>Private storage · Evidence-based analysis</span>
      </div>
      <UploadDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
