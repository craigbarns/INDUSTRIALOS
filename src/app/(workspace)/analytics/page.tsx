"use client";
import { useState } from "react";
import Link from "next/link";
import { BarChart3, ChevronRight } from "lucide-react";
import { useResource } from "@/lib/client";
import {
  Empty,
  Loading,
  Notice,
  PageHeader,
  SectionTitle,
} from "@/components/ui";

interface Analytics {
  totals: {
    documents: number;
    analyzed: number;
    approved: number;
    reviewRequired: number;
    failed: number;
    suppliers: number;
    productsQuoted: number;
  };
  statuses: { status: string; count: number }[];
  monthly: { month: string; uploaded: number; approved: number }[];
  countries: { country: string | null; suppliers: number }[];
  projects: {
    id: string;
    name: string;
    quotations: number;
    suppliers: number;
    approved: number;
  }[];
}
const statusOrder: [string, string][] = [
  ["uploaded", "Uploaded"],
  ["queued", "Queued"],
  ["processing", "Processing"],
  ["review_required", "Review required"],
  ["completed", "Completed"],
  ["failed", "Failed"],
];
function monthLabel(month: string, withYear = false) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    year: withYear ? "numeric" : undefined,
    timeZone: "UTC",
  }).format(new Date(`${month}-01T00:00:00Z`));
}
function niceMax(value: number) {
  if (value <= 4) return 4;
  const step = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / step) * step;
}
export default function AnalyticsPage() {
  const { data, error, loading, refresh } =
    useResource<Analytics>("/api/analytics");
  return (
    <>
      <PageHeader
        eyebrow="Procurement insights"
        title="Analytics"
        description="Document processing, review progress and supplier coverage across your organization."
      />
      {error && (
        <Notice>
          {error.message}{" "}
          <button className="text-link" onClick={refresh}>
            Try again
          </button>
        </Notice>
      )}
      {loading ? (
        <Loading label="Loading analytics" />
      ) : data && data.totals.documents === 0 ? (
        <section className="section-card">
          <Empty
            icon={<BarChart3 size={24} />}
            title="No activity to analyze yet"
            action={
              <Link href="/documents" className="button button-secondary">
                Go to documents
              </Link>
            }
          >
            Analytics appear once documents have been uploaded and analyzed in
            this organization.
          </Empty>
        </section>
      ) : (
        data && <AnalyticsContent data={data} />
      )}
    </>
  );
}
function AnalyticsContent({ data }: { data: Analytics }) {
  const { totals } = data;
  const approvalRate = totals.analyzed
    ? Math.round((totals.approved / totals.analyzed) * 100)
    : 0;
  const cards = [
    {
      label: "Analyzed documents",
      value: totals.analyzed.toLocaleString("en"),
      caption: `of ${totals.documents.toLocaleString("en")} uploaded`,
    },
    {
      label: "Approved analyses",
      value: totals.approved.toLocaleString("en"),
      caption: `${approvalRate}% of analyzed documents`,
    },
    {
      label: "Suppliers identified",
      value: totals.suppliers.toLocaleString("en"),
      caption: "Grouped by supplier name",
    },
    {
      label: "Products quoted",
      value: totals.productsQuoted.toLocaleString("en"),
      caption: "Line items across all quotations",
    },
  ];
  const statusCounts = statusOrder
    .map(([status, label]) => ({
      label,
      value: data.statuses.find((row) => row.status === status)?.count ?? 0,
    }))
    .filter((row) => row.value > 0);
  return (
    <div className="viz analytics-stack">
      <div className="metric-grid">
        {cards.map((card) => (
          <div key={card.label} className="metric-card">
            <div className="metric-label">{card.label}</div>
            <div className="metric-number">{card.value}</div>
            <div className="metric-caption">{card.caption}</div>
          </div>
        ))}
      </div>
      <section className="section-card">
        <SectionTitle title="Monthly activity" />
        <MonthlyChart monthly={data.monthly} />
      </section>
      <div className="analytics-columns">
        <section className="section-card">
          <SectionTitle title="Review progress" />
          <BarList
            rows={statusCounts}
            unit="documents"
            empty="No documents yet."
          />
        </section>
        <section className="section-card">
          <SectionTitle title="Suppliers by country" />
          <BarList
            rows={data.countries.map((row) => ({
              label: row.country ?? "Country not found",
              value: row.suppliers,
            }))}
            unit="suppliers"
            empty="No suppliers identified yet."
          />
        </section>
      </div>
      <section className="section-card">
        <SectionTitle
          title="Quotation coverage by project"
          count={data.projects.length}
        />
        {data.projects.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Project</th>
                  <th scope="col">Quotations</th>
                  <th scope="col">Suppliers</th>
                  <th scope="col">Approved</th>
                  <th scope="col">
                    <span className="sr-only">Compare</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.projects.map((project) => (
                  <tr key={project.id}>
                    <td>
                      <Link
                        href={`/projects/${project.id}#comparison`}
                        className="table-title"
                      >
                        {project.name}
                      </Link>
                    </td>
                    <td>{project.quotations}</td>
                    <td className="muted">{project.suppliers}</td>
                    <td className="muted">
                      {project.approved} of {project.quotations}
                    </td>
                    <td>
                      <Link
                        href={`/projects/${project.id}#comparison`}
                        className="icon-button"
                        aria-label={`Compare quotations for ${project.name}`}
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
          <Empty title="No project has analyzed quotations">
            Add documents to a project to compare supplier quotations side by
            side.
          </Empty>
        )}
      </section>
    </div>
  );
}
function MonthlyChart({ monthly }: { monthly: Analytics["monthly"] }) {
  const [active, setActive] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const max = niceMax(
    Math.max(0, ...monthly.flatMap((m) => [m.uploaded, m.approved])),
  );
  const series = [
    { key: "uploaded", label: "Uploaded", className: "series-1" },
    { key: "approved", label: "Approved", className: "series-2" },
  ] as const;
  return (
    <div className="chart-body">
      <div className="chart-toolbar">
        <div className="chart-legend" aria-hidden="true">
          {series.map((s) => (
            <span key={s.key}>
              <i className={`legend-swatch ${s.className}`} />
              {s.label}
            </span>
          ))}
        </div>
        <button className="text-link" onClick={() => setTable(!table)}>
          {table ? "Show chart" : "Show as table"}
        </button>
      </div>
      {table ? (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col">Uploaded</th>
                <th scope="col">Approved</th>
              </tr>
            </thead>
            <tbody>
              {monthly.map((m) => (
                <tr key={m.month}>
                  <td>{monthLabel(m.month, true)}</td>
                  <td>{m.uploaded}</td>
                  <td>{m.approved}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="column-chart" onMouseLeave={() => setActive(null)}>
          <div className="column-grid" aria-hidden="true">
            {[max, max / 2, 0].map((tick) => (
              <div key={tick} className="grid-line">
                <span>{Number.isInteger(tick) ? tick : tick.toFixed(1)}</span>
              </div>
            ))}
          </div>
          <div className="column-plot">
            {monthly.map((m, index) => (
              <div
                key={m.month}
                className={`column-group${active === index ? " active" : ""}`}
                tabIndex={0}
                aria-label={`${monthLabel(m.month, true)}: ${m.uploaded} uploaded, ${m.approved} approved`}
                onMouseEnter={() => setActive(index)}
                onFocus={() => setActive(index)}
                onBlur={() => setActive(null)}
              >
                <div className="column-bars">
                  {series.map((s) => (
                    <div
                      key={s.key}
                      className={`column-bar ${s.className}`}
                      style={{ height: `${(m[s.key] / max) * 100}%` }}
                    />
                  ))}
                </div>
                <div className="column-label">
                  {monthLabel(m.month, index === 0 || m.month.endsWith("-01"))}
                </div>
                {active === index && (
                  <div
                    className={`chart-tooltip${index > monthly.length - 4 ? " align-end" : ""}`}
                    role="status"
                  >
                    <strong>{monthLabel(m.month, true)}</strong>
                    {series.map((s) => (
                      <div key={s.key} className="tooltip-row">
                        <i className={`legend-swatch ${s.className}`} />
                        {s.label}
                        <b>{m[s.key]}</b>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
function BarList({
  rows,
  unit,
  empty,
}: {
  rows: { label: string; value: number }[];
  unit: string;
  empty: string;
}) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  if (!rows.length) return <p className="chart-body muted">{empty}</p>;
  return (
    <ul className="chart-body bar-list">
      {rows.map((row) => (
        <li key={row.label} title={`${row.label}: ${row.value} ${unit}`}>
          <span className="bar-list-label">{row.label}</span>
          <span className="bar-list-track">
            <span
              className="bar-list-fill series-1"
              style={{ width: `${(row.value / max) * 100}%` }}
            />
          </span>
          <span className="bar-list-value">{row.value}</span>
        </li>
      ))}
    </ul>
  );
}
