"use client";
import { useState, type FormEvent } from "react";
import { api, message, type Project } from "@/lib/client";
import { Button, Modal, Notice } from "@/components/ui";

export function ProjectForm({
  open,
  onOpenChange,
  project,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project?: Project;
  onSaved: (project: Project) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await api<Project>(
        project ? `/api/projects/${project.id}` : "/api/projects",
        {
          method: project ? "PATCH" : "POST",
          body: JSON.stringify({
            name: form.get("name"),
            description: String(form.get("description") ?? "").trim() || null,
            ...(project ? { status: form.get("status") } : {}),
          }),
        },
      );
      onSaved(result);
      onOpenChange(false);
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={project ? "Edit project" : "Create a procurement project"}
      description="Keep supplier documents and procurement intelligence together."
    >
      <form className="form-stack" onSubmit={save}>
        {error && <Notice>{error}</Notice>}
        <div className="field">
          <label htmlFor="project-name">Project name</label>
          <input
            id="project-name"
            name="name"
            className="input"
            required
            maxLength={200}
            placeholder="e.g. Food-grade packaging sourcing"
            defaultValue={project?.name}
          />
        </div>
        <div className="field">
          <label htmlFor="project-description">
            Description <span className="muted">(optional)</span>
          </label>
          <textarea
            id="project-description"
            name="description"
            className="textarea"
            maxLength={5000}
            placeholder="Describe the scope and purchasing requirements."
            defaultValue={project?.description ?? ""}
          />
        </div>
        {project && (
          <div className="field">
            <label htmlFor="project-status">Status</label>
            <select
              id="project-status"
              name="status"
              className="select"
              defaultValue={project.status}
            >
              <option value="active">Active</option>
              <option value="completed">Completed</option>
              <option value="archived">Archived</option>
            </select>
          </div>
        )}
        <div className="form-actions">
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            {project ? "Save changes" : "Create project"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
