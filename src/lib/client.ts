"use client";

import { useCallback, useEffect, useState } from "react";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
  ) {
    super(message);
  }
}
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  const response = await fetch(url, {
    ...init,
    headers,
    credentials: "same-origin",
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => null)) as {
    data?: T;
    error?: { message?: string; code?: string };
  } | null;
  if (!response.ok)
    throw new ApiError(
      payload?.error?.message ??
        "The request could not be completed. Please try again.",
      response.status,
      payload?.error?.code ?? "REQUEST_FAILED",
    );
  return payload?.data as T;
}
export function message(error: unknown) {
  return error instanceof Error
    ? error.message
    : "An unexpected error occurred. Please try again.";
}
export function useResource<T>(url: string | null, polling = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    const controller = new AbortController();
    const load = async () => {
      try {
        const result = await api<T>(url, { signal: controller.signal });
        if (alive) {
          setData(result);
          setError(null);
        }
      } catch (error) {
        if (alive && !controller.signal.aborted)
          setError(error instanceof Error ? error : new Error(message(error)));
      } finally {
        if (alive) setLoading(false);
      }
    };
    void load();
    const interval = polling
      ? setInterval(() => {
          if (document.visibilityState === "visible") void load();
        }, polling)
      : undefined;
    return () => {
      alive = false;
      controller.abort();
      clearInterval(interval);
    };
  }, [url, revision, polling]);
  return {
    data,
    error,
    loading: url === null ? false : loading,
    refresh,
    setData,
  };
}
export interface Project {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "completed" | "archived";
  createdAt: string;
  updatedAt: string;
}
export type DocumentStatus =
  | "uploaded"
  | "queued"
  | "processing"
  | "completed"
  | "review_required"
  | "failed";
export interface ProcurementDocument {
  id: string;
  projectId: string | null;
  fileName: string;
  mimeType: string;
  size: number;
  status: DocumentStatus;
  createdAt: string;
  updatedAt: string;
  errorCode?: string | null;
  approvedAt?: string | null;
  uploadedBy?: string | null;
}
export interface Supplier {
  id: string;
  name: string;
  aliases: string[];
  country: string | null;
  email: string | null;
  website: string | null;
  quotationCount: number;
  approvedCount: number;
  productCount: number;
  currencies: string[];
  projects: { id: string; name: string }[];
  lastActivityAt: string;
}
export interface SupplierQuotation {
  documentId: string;
  fileName: string;
  documentStatus: DocumentStatus;
  approved: boolean;
  createdAt: string;
  projectId: string | null;
  projectName: string | null;
  quotationNumber: string | null;
  quotationDate: string | null;
  validityDate: string | null;
  currency: string | null;
  totalAmount: string | null;
  incoterm: string | null;
  productCount: number;
}
export interface SupplierProduct {
  documentId: string;
  quotationNumber: string | null;
  quotationDate: string | null;
  approved: boolean;
  reference: string | null;
  description: string | null;
  material: string | null;
  unitPrice: string | null;
  currency: string | null;
  priceBasis: string | null;
  minimumOrderQuantity: string | null;
  quantityUnit: string | null;
  leadTime: string | null;
}
export interface Workspace {
  user: { id: string; name: string; email: string; emailVerified?: boolean };
  organization: { id: string; name: string; slug: string } | null;
  role: string;
  organizations: { id: string; name: string; slug: string }[];
}
