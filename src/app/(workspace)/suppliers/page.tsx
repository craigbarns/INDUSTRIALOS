"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, Search, Users } from "lucide-react";
import { useResource, type Supplier } from "@/lib/client";
import { formatDate } from "@/lib/i18n";
import {
  Empty,
  ExportLink,
  Loading,
  Notice,
  PageHeader,
} from "@/components/ui";
export default function SuppliersPage() {
  const { data, error, loading, refresh } =
    useResource<Supplier[]>("/api/suppliers");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("recent");
  const suppliers = useMemo(() => {
    const search = query.trim().toLowerCase();
    return (data ?? [])
      .filter(
        (s) =>
          !search ||
          [s.name, s.country, ...s.aliases].some((value) =>
            value?.toLowerCase().includes(search),
          ),
      )
      .sort((a, b) =>
        sort === "name"
          ? a.name.localeCompare(b.name)
          : sort === "quotations"
            ? b.quotationCount - a.quotationCount
            : Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt),
      );
  }, [data, query, sort]);
  return (
    <>
      <PageHeader
        eyebrow="Supplier network"
        title="Suppliers"
        description="Every supplier identified in your analyzed documents, with their quotations and products."
        action={
          data?.length ? (
            <ExportLink href="/api/suppliers?format=csv" />
          ) : undefined
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
              aria-label="Search suppliers"
              placeholder="Search by name or country…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <select
            className="select"
            aria-label="Sort suppliers"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="recent">Most recent activity</option>
            <option value="quotations">Most quotations</option>
            <option value="name">Name A–Z</option>
          </select>
        </div>
        {loading ? (
          <Loading label="Loading suppliers" />
        ) : suppliers.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Supplier</th>
                  <th scope="col">Country</th>
                  <th scope="col">Quotations</th>
                  <th scope="col">Products</th>
                  <th scope="col">Currencies</th>
                  <th scope="col">Last activity</th>
                  <th scope="col">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((supplier) => (
                  <tr key={supplier.id}>
                    <td>
                      <Link href={`/suppliers/${supplier.id}`}>
                        <div className="table-title">{supplier.name}</div>
                        <div className="table-subtitle">
                          {supplier.projects.length
                            ? supplier.projects.map((p) => p.name).join(", ")
                            : "No project"}
                        </div>
                      </Link>
                    </td>
                    <td className="muted">{supplier.country ?? "—"}</td>
                    <td className="nowrap">
                      {supplier.quotationCount}
                      <span className="muted">
                        {" "}
                        · {supplier.approvedCount} approved
                      </span>
                    </td>
                    <td className="muted">{supplier.productCount}</td>
                    <td className="muted">
                      {supplier.currencies.join(", ") || "—"}
                    </td>
                    <td className="muted nowrap">
                      {formatDate(supplier.lastActivityAt)}
                    </td>
                    <td>
                      <Link
                        href={`/suppliers/${supplier.id}`}
                        className="icon-button"
                        aria-label={`Open ${supplier.name}`}
                      >
                        <ChevronRight size={15} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            icon={<Users size={24} />}
            title={query ? "No matching suppliers" : "No suppliers yet"}
            action={
              query ? undefined : (
                <Link href="/documents" className="button button-secondary">
                  Go to documents
                </Link>
              )
            }
          >
            {query
              ? "Try another name or country."
              : "Suppliers appear here automatically once a document has been analyzed and a supplier name was found in it."}
          </Empty>
        )}
      </section>
      <div className="footer-note">
        <span>{data?.length ?? 0} suppliers in your organization</span>
        <span>Grouped by supplier name across analyzed documents</span>
      </div>
    </>
  );
}
