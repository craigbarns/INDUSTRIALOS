"use client";
import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  FileCheck2,
  Files,
  FolderOpen,
  Plus,
  ScanLine,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import {
  useResource,
  type Project,
  type ProcurementDocument,
} from "@/lib/client";
import { formatDate } from "@/lib/i18n";
import { useWorkspace } from "@/components/workspace";
import {
  Button,
  Empty,
  FileIcon,
  Loading,
  Notice,
  PageHeader,
  SectionTitle,
  Status,
} from "@/components/ui";
import { UploadDialog } from "@/components/upload-dialog";
import { ProjectForm } from "@/components/project-form";

interface Dashboard {
  metrics: {
    activeProjects: number;
    totalDocuments: number;
    analyzedDocuments: number;
    reviewRequired: number;
  };
  recentProjects: Project[];
  recentDocuments: ProcurementDocument[];
}
export default function DashboardPage() {
  const { workspace } = useWorkspace();
  const { data, error, loading, refresh } =
    useResource<Dashboard>("/api/dashboard");
  const [upload, setUpload] = useState(false);
  const [project, setProject] = useState(false);
  const cards = data
    ? [
        {
          label: "Active projects",
          value: data.metrics.activeProjects,
          caption: "Procurement projects in progress",
          icon: FolderOpen,
          href: "/projects",
        },
        {
          label: "Uploaded documents",
          value: data.metrics.totalDocuments,
          caption: "Private organization documents",
          icon: Files,
          href: "/documents",
        },
        {
          label: "Successfully analyzed",
          value: data.metrics.analyzedDocuments,
          caption: "OCR and extraction completed",
          icon: FileCheck2,
          href: "/documents?status=completed",
        },
        {
          label: "Requiring review",
          value: data.metrics.reviewRequired,
          caption: "Ready for your team’s review",
          icon: TriangleAlert,
          href: "/documents?status=review_required",
        },
      ]
    : [];
  return (
    <>
      <div className="dashboard-date">
        <CalendarDays size={12} />
        {new Intl.DateTimeFormat("en", {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric",
        }).format(new Date())}
      </div>
      <div className="dashboard-heading">
        <PageHeader
          title={`Welcome back, ${workspace.user.name.split(" ")[0]}.`}
          description="A clear view of your procurement work. All in one place."
          action={
            <Button onClick={() => setUpload(true)}>
              <ScanLine size={15} />
              Analyze Documents
            </Button>
          }
        />
      </div>
      {error && (
        <Notice>
          {error.message}{" "}
          <button className="text-link" onClick={refresh}>
            Try again
          </button>
        </Notice>
      )}
      {loading ? (
        <Loading label="Loading procurement activity" />
      ) : (
        data && (
          <>
            <div className="metric-grid">
              {cards.map((card) => (
                <Link key={card.label} href={card.href} className="metric-card">
                  <div className="metric-label">
                    {card.label}
                    <card.icon size={15} />
                  </div>
                  <div className="metric-number">
                    {card.value.toLocaleString("en")}
                  </div>
                  <div className="metric-caption">{card.caption}</div>
                </Link>
              ))}
            </div>
            <div className="dashboard-grid">
              <section className="section-card">
                <SectionTitle
                  title="Recent documents"
                  action={
                    <Link href="/documents" className="text-link row">
                      View all
                      <ArrowUpRight size={12} />
                    </Link>
                  }
                />
                {data.recentDocuments.length ? (
                  data.recentDocuments.map((doc) => (
                    <Link
                      href={`/documents/${doc.id}`}
                      className="list-row"
                      key={doc.id}
                    >
                      <FileIcon mimeType={doc.mimeType} />
                      <div className="grow">
                        <div className="list-title truncate">
                          {doc.fileName}
                        </div>
                        <div className="list-subtitle">
                          Uploaded {formatDate(doc.createdAt)}
                        </div>
                      </div>
                      <Status
                        status={doc.status}
                        approved={Boolean(doc.approvedAt)}
                      />
                    </Link>
                  ))
                ) : (
                  <Empty
                    title="Your intelligence starts here"
                    action={
                      <Button
                        variant="secondary"
                        onClick={() => setUpload(true)}
                      >
                        <Plus size={13} />
                        Upload your first document
                      </Button>
                    }
                  >
                    Add a supplier quotation to extract products, prices, and
                    specifications with source evidence.
                  </Empty>
                )}
              </section>
              <section className="section-card">
                <SectionTitle
                  title="Procurement projects"
                  action={
                    <button
                      className="icon-button"
                      aria-label="Create project"
                      onClick={() => setProject(true)}
                    >
                      <Plus size={16} />
                    </button>
                  }
                />
                {data.recentProjects.length ? (
                  <>
                    {data.recentProjects.map((p) => (
                      <Link
                        href={`/projects/${p.id}`}
                        className="list-row"
                        key={p.id}
                      >
                        <div className="project-icon">
                          <FolderOpen size={16} />
                        </div>
                        <div className="grow">
                          <div className="list-title truncate">{p.name}</div>
                          <div className="list-subtitle">
                            Updated {formatDate(p.updatedAt)}
                          </div>
                        </div>
                        <Status status={p.status} />
                      </Link>
                    ))}
                    <Link
                      href="/projects"
                      className="list-row text-link"
                      style={{ justifyContent: "center", fontSize: 10 }}
                    >
                      View all projects
                      <ArrowRight size={12} />
                    </Link>
                  </>
                ) : (
                  <Empty
                    icon={<FolderOpen size={23} />}
                    title="A place for every project"
                    action={
                      <Button
                        variant="secondary"
                        onClick={() => setProject(true)}
                      >
                        <Plus size={13} />
                        Create a project
                      </Button>
                    }
                  >
                    Group documents by sourcing initiative and keep your team’s
                    work organized.
                  </Empty>
                )}
              </section>
            </div>
            <div className="quiet-card">
              <ShieldCheck size={23} />
              <div className="grow">
                <h3>Reliable intelligence starts with source evidence.</h3>
                <p>
                  Review every extracted field alongside the original document.
                  Correct, verify, and approve before making a decision.
                </p>
              </div>
              <Link href="/documents" className="button button-secondary">
                Open documents
                <ArrowUpRight size={12} />
              </Link>
            </div>
            <div className="footer-note">
              <span className="dot-separator">
                <span />
                Connected to your organization’s workspace
              </span>
              <span>Industrial OS · Procurement intelligence</span>
            </div>
          </>
        )
      )}
      <UploadDialog open={upload} onOpenChange={setUpload} />
      <ProjectForm open={project} onOpenChange={setProject} onSaved={refresh} />
    </>
  );
}
