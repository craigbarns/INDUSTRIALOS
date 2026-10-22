"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  ArrowUpRight,
  Download,
  FileText,
  LoaderCircle,
  X,
  AlertCircle,
} from "lucide-react";
import type { ReactNode } from "react";
export { Button } from "@/components/ui/button";
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="modal-overlay" />
        <DialogPrimitive.Content className="modal-content">
          <div className="modal-heading">
            <div>
              <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
              {description && (
                <DialogPrimitive.Description>
                  {description}
                </DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close
              className="icon-button"
              aria-label="Close dialog"
            >
              <X size={18} />
            </DialogPrimitive.Close>
          </div>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
export function Notice({
  children,
  kind = "error",
}: {
  children: ReactNode;
  kind?: "error" | "info" | "success";
}) {
  return (
    <div
      className={`notice notice-${kind}`}
      role={kind === "error" ? "alert" : "status"}
    >
      <AlertCircle size={17} />
      <div>{children}</div>
    </div>
  );
}
export function Loading({ label = "Loading workspace" }: { label?: string }) {
  return (
    <div className="loading-state" role="status">
      <LoaderCircle className="spin" size={22} />
      <span>{label}…</span>
    </div>
  );
}
export function Empty({
  title,
  children,
  action,
  icon,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon ?? <FileText size={23} />}</div>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Status({
  status,
  approved,
}: {
  status: string;
  approved?: boolean;
}) {
  const label = approved ? "Approved" : status.replaceAll("_", " ");
  return (
    <span className={`status status-${approved ? "approved" : status}`}>
      <span />
      {label}
    </span>
  );
}
export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action && <div className="page-actions">{action}</div>}
    </div>
  );
}
export function SectionTitle({
  title,
  count,
  action,
}: {
  title: string;
  count?: number;
  action?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <h2>
        {title}
        {count !== undefined && <span className="count">{count}</span>}
      </h2>
      {action}
    </div>
  );
}
/** A same-origin download; the API answers ?format=csv with a private attachment. */
export function ExportLink({
  href,
  label = "Export CSV",
}: {
  href: string;
  label?: string;
}) {
  return (
    <a className="button button-secondary" href={href} download>
      <Download size={13} aria-hidden="true" />
      {label}
    </a>
  );
}
export function ArrowLink() {
  return <ArrowUpRight size={15} aria-hidden="true" />;
}
export function FileIcon({ mimeType }: { mimeType: string }) {
  return (
    <div
      className={`file-icon ${mimeType === "application/pdf" ? "file-pdf" : "file-image"}`}
    >
      <FileText size={18} />
      <span>{mimeType === "application/pdf" ? "PDF" : "IMG"}</span>
    </div>
  );
}
export function formatBytes(size: number) {
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
