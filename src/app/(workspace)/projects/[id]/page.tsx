"use client";
import { use, useState } from "react";
import Link from "next/link";
import { Archive, ArrowLeft, CalendarDays, Pencil, Plus } from "lucide-react";
import {
  api,
  message,
  useResource,
  type Project,
  type ProcurementDocument,
} from "@/lib/client";
import { formatDate } from "@/lib/i18n";
import {
  Button,
  Empty,
  Loading,
  Modal,
  Notice,
  PageHeader,
  SectionTitle,
  Status,
} from "@/components/ui";
import { ProjectForm } from "@/components/project-form";
import { UploadDialog } from "@/components/upload-dialog";
import { DocumentTable } from "@/components/document-table";
import { QuotationComparison } from "@/components/quotation-comparison";
export default function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <ProjectContent key={id} id={id} />;
}
function ProjectContent({ id }: { id: string }) {
  const { data, error, loading, refresh } = useResource<{
    project: Project;
    documents: ProcurementDocument[];
  }>(`/api/projects/${id}`);
  const [edit, setEdit] = useState(false);
  const [upload, setUpload] = useState(false);
  const [archive, setArchive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  async function archiveProject() {
    setBusy(true);
    setActionError("");
    try {
      await api(`/api/projects/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "archived" }),
      });
      setArchive(false);
      refresh();
    } catch (error) {
      setActionError(message(error));
    } finally {
      setBusy(false);
    }
  }
  if (loading) return <Loading label="Loading project" />;
  if (error || !data)
    return <Notice>{error?.message ?? "Project unavailable."}</Notice>;
  return (
    <>
      <Link href="/projects" className="back-link">
        <ArrowLeft size={13} />
        All projects
      </Link>
      <PageHeader
        eyebrow="Procurement project"
        title={data.project.name}
        description={
          data.project.description ??
          "Add documents to begin building intelligence for this project."
        }
        action={
          <>
            <Button variant="secondary" onClick={() => setEdit(true)}>
              <Pencil size={13} />
              Edit project
            </Button>
            <Button onClick={() => setUpload(true)}>
              <Plus size={14} />
              Add document
            </Button>
          </>
        }
      />
      <div className="detail-meta">
        <Status status={data.project.status} />
        <span>
          <CalendarDays size={12} />
          Created {formatDate(data.project.createdAt)}
        </span>
        <span>Updated {formatDate(data.project.updatedAt)}</span>
        {data.project.status !== "archived" && (
          <button className="text-link row" onClick={() => setArchive(true)}>
            <Archive size={12} />
            Archive project
          </button>
        )}
      </div>
      <div className="section-stack">
        <QuotationComparison projectId={id} />
        <section className="section-card">
          <SectionTitle
            title="Project documents"
            count={data.documents.length}
          />
          {data.documents.length ? (
            <DocumentTable documents={data.documents} />
          ) : (
            <Empty
              title="No documents in this project"
              action={
                <Button variant="secondary" onClick={() => setUpload(true)}>
                  <Plus size={13} />
                  Upload document
                </Button>
              }
            >
              Add supplier quotations and technical documents to analyze them in
              context.
            </Empty>
          )}
        </section>
      </div>
      <ProjectForm
        open={edit}
        onOpenChange={setEdit}
        project={data.project}
        onSaved={refresh}
      />
      <UploadDialog open={upload} onOpenChange={setUpload} projectId={id} />
      <Modal
        open={archive}
        onOpenChange={setArchive}
        title="Archive this project?"
        description="The project and its documents will remain accessible. You can reactivate it by editing its status."
      >
        {actionError && <Notice>{actionError}</Notice>}
        <div className="form-actions">
          <Button variant="secondary" onClick={() => setArchive(false)}>
            Cancel
          </Button>
          <Button loading={busy} onClick={archiveProject}>
            Archive project
          </Button>
        </div>
      </Modal>
    </>
  );
}
