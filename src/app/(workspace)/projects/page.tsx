"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, FolderOpen, Plus, Search } from "lucide-react";
import { useResource, type Project } from "@/lib/client";
import { formatDate } from "@/lib/i18n";
import {
  Button,
  Empty,
  Loading,
  Notice,
  PageHeader,
  Status,
} from "@/components/ui";
import { ProjectForm } from "@/components/project-form";
export default function ProjectsPage() {
  const { data, error, loading, refresh } =
    useResource<Project[]>("/api/projects");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("updated");
  const [status, setStatus] = useState("all");
  const projects = useMemo(
    () =>
      (data ?? [])
        .filter(
          (p) =>
            `${p.name} ${p.description ?? ""}`
              .toLowerCase()
              .includes(query.toLowerCase()) &&
            (status === "all" || p.status === status),
        )
        .sort((a, b) =>
          sort === "name"
            ? a.name.localeCompare(b.name)
            : sort === "created"
              ? Date.parse(b.createdAt) - Date.parse(a.createdAt)
              : Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
        ),
    [data, query, status, sort],
  );
  return (
    <>
      <PageHeader
        eyebrow="Procurement"
        title="Projects"
        description="Manage sourcing initiatives and the documents that support them."
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus size={14} />
            New project
          </Button>
        }
      />
      {error && (
        <Notice>
          {error.message}{" "}
          <button onClick={refresh} className="text-link">
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
              aria-label="Search projects"
              placeholder="Search projects…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <select
            className="select"
            aria-label="Filter project status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="archived">Archived</option>
          </select>
          <select
            className="select"
            aria-label="Sort projects"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="updated">Recently updated</option>
            <option value="created">Newest first</option>
            <option value="name">Name A–Z</option>
          </select>
        </div>
        {loading ? (
          <Loading label="Loading projects" />
        ) : !projects.length ? (
          <Empty
            icon={<FolderOpen size={23} />}
            title={
              query || status !== "all"
                ? "No matching projects"
                : "Create your first procurement project"
            }
            action={
              !query && status === "all" ? (
                <Button variant="secondary" onClick={() => setOpen(true)}>
                  <Plus size={13} />
                  Create project
                </Button>
              ) : undefined
            }
          >
            {query || status !== "all"
              ? "Try another search or status filter."
              : "Organize quotations, technical specifications, and supplier documents by purchasing initiative."}
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Project name</th>
                  <th scope="col">Status</th>
                  <th scope="col">Last updated</th>
                  <th scope="col">Created</th>
                  <th scope="col">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/projects/${p.id}`} className="row">
                        <div className="project-icon">
                          <FolderOpen size={16} />
                        </div>
                        <div>
                          <div className="table-title">{p.name}</div>
                          <div className="table-subtitle">
                            {p.description
                              ? p.description.slice(0, 75)
                              : "No description"}
                          </div>
                        </div>
                      </Link>
                    </td>
                    <td>
                      <Status status={p.status} />
                    </td>
                    <td className="muted nowrap">{formatDate(p.updatedAt)}</td>
                    <td className="muted nowrap">{formatDate(p.createdAt)}</td>
                    <td>
                      <Link
                        className="icon-button"
                        aria-label={`Open ${p.name}`}
                        href={`/projects/${p.id}`}
                      >
                        <ChevronRight size={15} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <ProjectForm open={open} onOpenChange={setOpen} onSaved={refresh} />
    </>
  );
}
