"use client";
import Link from "next/link";
import { Trophy } from "lucide-react";
import { useResource, type DocumentStatus } from "@/lib/client";
import {
  ExportLink,
  Loading,
  Notice,
  SectionTitle,
  Status,
} from "@/components/ui";

interface ComparedQuotation {
  documentId: string;
  fileName: string;
  documentStatus: DocumentStatus;
  approved: boolean;
  supplierId: string | null;
  supplierName: string | null;
  quotationNumber: string | null;
  quotationDate: string | null;
  validityDate: string | null;
  currency: string | null;
  totalAmount: string | null;
  incoterm: string | null;
  productCount: number;
  lowestInCurrency: boolean;
}
export function QuotationComparison({ projectId }: { projectId: string }) {
  const { data, error, loading } = useResource<{
    quotations: ComparedQuotation[];
    supplierCount: number;
  }>(`/api/projects/${projectId}/comparison`);
  if (loading) return <Loading label="Comparing quotations" />;
  if (error) return <Notice>{error.message}</Notice>;
  if (!data?.quotations.length) return null;
  // A "lowest" mark only means something when several totals share a currency.
  const pricedPerCurrency = new Map<string, number>();
  for (const q of data.quotations)
    if (q.currency && q.totalAmount)
      pricedPerCurrency.set(
        q.currency,
        (pricedPerCurrency.get(q.currency) ?? 0) + 1,
      );
  const currencies = pricedPerCurrency.size;
  return (
    <section className="section-card" id="comparison">
      <SectionTitle
        title="Quotation comparison"
        count={data.quotations.length}
        action={
          <ExportLink
            href={`/api/projects/${projectId}/comparison?format=csv`}
          />
        }
      />
      <div className="comparison-note">
        {data.supplierCount}{" "}
        {data.supplierCount === 1 ? "supplier" : "suppliers"}. Totals are
        compared within the same currency only, without conversion
        {currencies > 1 ? ` (${currencies} currencies in this project)` : ""}.
        Check quantities, Incoterms and validity before deciding.
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Supplier</th>
              <th scope="col">Total</th>
              <th scope="col">Incoterm</th>
              <th scope="col">Valid until</th>
              <th scope="col">Products</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.quotations.map((q) => (
              <tr key={q.documentId}>
                <td className="comparison-supplier">
                  {q.supplierId ? (
                    <Link
                      href={`/suppliers/${q.supplierId}`}
                      className="table-title"
                    >
                      {q.supplierName}
                    </Link>
                  ) : (
                    <div className="table-title muted">Supplier not found</div>
                  )}
                  <div className="table-subtitle">
                    <Link
                      className="text-link"
                      href={`/documents/${q.documentId}`}
                    >
                      {q.quotationNumber ?? q.fileName}
                    </Link>
                    {q.quotationDate && ` · ${q.quotationDate}`}
                  </div>
                </td>
                <td className="nowrap">
                  {q.totalAmount && q.currency ? (
                    <>
                      <span className="comparison-total">
                        {q.totalAmount} {q.currency}
                      </span>
                      {q.lowestInCurrency &&
                        (pricedPerCurrency.get(q.currency) ?? 0) > 1 && (
                          <span className="lowest-tag">
                            <Trophy size={11} aria-hidden="true" />
                            Lowest {q.currency}
                          </span>
                        )}
                    </>
                  ) : (
                    <span className="muted">No total found</span>
                  )}
                </td>
                <td className="muted nowrap">{q.incoterm ?? "—"}</td>
                <td className="muted nowrap">{q.validityDate ?? "—"}</td>
                <td className="muted">{q.productCount}</td>
                <td>
                  <Status status={q.documentStatus} approved={q.approved} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
