"use client";
import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { api, message, useResource, type ProcurementDocument, type Project } from "@/lib/client";
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
  const { data, error, loading, refresh, setData } = useResource<ProcurementDocument[]>(
    "/api/documents",
    8000,
  );
  const projects = useResource<Project[]>("/api/projects");
  const [project, setProject] = useState(params.get("project") ?? "all");
  const [movingId, setMovingId] = useState<string | null>(null);
  const [moveError, setMoveError] = useState("");
  const projectName = (id: string | null) =>
    projects.data?.find((p) => p.id === id)?.name ?? "";
  async function move(document: ProcurementDocument, projectId: string | null) {
    setMovingId(document.id);
    setMoveError("");
    try {
      const moved = await api<ProcurementDocument>(`/api/documents/${document.id}`, {
        method: "PATCH",
        body: JSON.stringify({ projectId }),
      });
      setData((data ?? []).map((d) => (d.id === document.id ? (moved ?? { ...d, projectId }) : d)));
    } catch (error) {
      setMoveError(message(error));
      refresh();
    } finally {
      setMovingId(null);
    }
  }
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
            (status === "all" || d.status === status) &&
            (project === "all" ||
              (project === "none" ? !d.projectId : d.projectId === project)),
        )
        .sort((a, b) =>
          sort === "name"
            ? a.fileName.localeCompare(b.fileName)
            : sort === "project"
              ? // Unfiled documents first, then projects A–Z, newest first within each.
                (a.projectId ? 1 : 0) - (b.projectId ? 1 : 0) ||
                projectName(a.projectId).localeCompare(projectName(b.projectId)) ||
                Date.parse(b.createdAt) - Date.parse(a.createdAt)
              : Date.parse(b.createdAt) - Date.parse(a.createdAt),
        ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, query, status, sort, project, projects.data],
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
            aria-label="Filter by project"
            value={project}
            onChange={(e) => setProject(e.target.value)}
          >
            <option value="all">All projects</option>
            <option value="none">No project</option>
            {projects.data?.map((p) => (
              <option value={p.id} key={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            className="select"
            aria-label="Sort documents"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="newest">Newest first</option>
            <option value="name">Name A–Z</option>
            <option value="project">By project</option>
          </select>
        </div>
        {moveError && <Notice>{moveError}</Notice>}
        {loading ? (
          <Loading label="Loading documents" />
        ) : documents.length ? (
          <DocumentTable
            documents={documents}
            projects={projects.data ?? undefined}
            onMove={move}
            movingId={movingId}
          />
        ) : (
          <Empty
            title={
              query || status !== "all" || project !== "all"
                ? "No matching documents"
                : "Your first document is the starting point"
            }
            action={
              !query && status === "all" && project === "all" ? (
                <Button variant="secondary" onClick={() => setOpen(true)}>
                  <Plus size={13} />
                  Upload document
                </Button>
              ) : undefined
            }
          >
            {query || status !== "all" || project !== "all"
              ? "Try another search, status or project."
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
