"use client";
import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { UploadCloud, X } from "lucide-react";
import {
  api,
  message,
  useResource,
  type ProcurementDocument,
  type Project,
} from "@/lib/client";
import { Button, FileIcon, Modal, Notice, formatBytes } from "@/components/ui";

export function UploadDialog({
  open,
  onOpenChange,
  projectId,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  projectId?: string;
}) {
  const { data: projects } = useResource<Project[]>(
    open ? "/api/projects" : null,
  );
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  function selectFile(next?: File) {
    setError("");
    if (!next) return;
    if (next.size > 20 * 1024 * 1024)
      return setError("Files must be 20 MB or smaller.");
    if (
      !["application/pdf", "image/png", "image/jpeg"].includes(next.type) ||
      !/\.(pdf|png|jpe?g)$/i.test(next.name)
    )
      return setError("Choose a PDF, PNG, or JPEG document.");
    setFile(next);
  }
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return setError("Choose a document to upload.");
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    form.set("file", file);
    form.delete("file-picker");
    if (!form.get("projectId")) form.delete("projectId");
    try {
      const document = await api<ProcurementDocument>("/api/documents/upload", {
        method: "POST",
        body: form,
      });
      onOpenChange(false);
      setFile(null);
      router.push(`/documents/${document.id}`);
      router.refresh();
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open={open}
      onOpenChange={(value) => {
        if (!busy) {
          onOpenChange(value);
          setError("");
        }
      }}
      title="Upload an industrial document"
      description="Securely upload a supplier quotation, technical sheet, or specification."
    >
      <form className="form-stack" onSubmit={upload}>
        {error && <Notice>{error}</Notice>}
        {file ? (
          <div className="selected-file">
            <FileIcon mimeType={file.type} />
            <div className="grow">
              <strong className="truncate">{file.name}</strong>
              <p>{formatBytes(file.size)} · Ready to upload</p>
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label="Remove selected file"
              onClick={() => {
                setFile(null);
                if (fileRef.current) fileRef.current.value = "";
              }}
            >
              <X size={16} />
            </button>
          </div>
        ) : (
          <div
            className={`drop-zone ${dragging ? "dragging" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              if (event.dataTransfer.files.length > 1)
                setError("Upload one document at a time.");
              else selectFile(event.dataTransfer.files[0]);
            }}
          >
            <UploadCloud size={28} />
            <strong>Drop your document here, or browse</strong>
            <p>PDF, PNG, JPG · Maximum 20 MB</p>
            <input
              name="file-picker"
              ref={fileRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
              aria-label="Choose document"
              onChange={(event) => selectFile(event.target.files?.[0])}
            />
          </div>
        )}
        <div className="field">
          <label htmlFor="upload-project">
            Procurement project <span className="muted">(optional)</span>
          </label>
          <select
            name="projectId"
            id="upload-project"
            className="select"
            defaultValue={projectId ?? ""}
          >
            <option value="">No project</option>
            {projects
              ?.filter((p) => p.status !== "archived")
              .map((p) => (
                <option value={p.id} key={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </div>
        <Notice kind="info">
          The original file is private. You can start AI analysis from the
          document review page after upload. Processing permissions are managed
          in{" "}
          <Link className="text-link" href="/settings/organization">
            organization settings
          </Link>
          .
        </Notice>
        <div className="form-actions">
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={!file}>
            <UploadCloud size={14} />
            Upload document
          </Button>
        </div>
      </form>
    </Modal>
  );
}
