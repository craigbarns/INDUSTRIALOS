"use client";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { type ProcurementDocument, type Project } from "@/lib/client";
import { formatDate } from "@/lib/i18n";
import { FileIcon, Status, formatBytes } from "@/components/ui";

export function DocumentTable({
  documents,
  projects,
  onMove,
  movingId,
}: {
  documents: ProcurementDocument[];
  /** With onMove, each row gets a project picker for filing documents from the list. */
  projects?: Project[];
  onMove?: (document: ProcurementDocument, projectId: string | null) => void;
  movingId?: string | null;
}) {
  const filing = Boolean(projects && onMove);
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Document name</th>
            {filing && <th scope="col">Project</th>}
            <th scope="col">Status</th>
            <th scope="col">Uploaded</th>
            <th scope="col">Size</th>
            <th scope="col">
              <span className="sr-only">Open</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {documents.map((document) => (
            <tr key={document.id}>
              <td>
                <Link href={`/documents/${document.id}`} className="row">
                  <FileIcon mimeType={document.mimeType} />
                  <div>
                    <div className="table-title">{document.fileName}</div>
                    <div className="table-subtitle">
                      {document.mimeType === "application/pdf"
                        ? "PDF document"
                        : "Image document"}
                    </div>
                  </div>
                </Link>
              </td>
              {filing && (
                <td>
                  <select
                    className="select select-compact"
                    aria-label={`Project for ${document.fileName}`}
                    value={document.projectId ?? ""}
                    onChange={(event) =>
                      onMove!(document, event.target.value || null)
                    }
                    disabled={movingId === document.id}
                  >
                    <option value="">No project</option>
                    {projects!
                      .filter(
                        (p) =>
                          p.status !== "archived" ||
                          p.id === document.projectId,
                      )
                      .map((p) => (
                        <option value={p.id} key={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                </td>
              )}
              <td>
                <Status
                  status={document.status}
                  approved={Boolean(document.approvedAt)}
                />
              </td>
              <td className="muted nowrap">{formatDate(document.createdAt)}</td>
              <td className="muted nowrap">{formatBytes(document.size)}</td>
              <td>
                <Link
                  href={`/documents/${document.id}`}
                  className="icon-button"
                  aria-label={`Open ${document.fileName}`}
                >
                  <ChevronRight size={15} />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
