"use client";
import { use } from "react";
import Link from "next/link";
import { ArrowLeft, Globe, Mail, MapPin } from "lucide-react";
import {
  useResource,
  type Supplier,
  type SupplierProduct,
  type SupplierQuotation,
} from "@/lib/client";
import { formatDate } from "@/lib/i18n";
import {
  Empty,
  ExportLink,
  Loading,
  Notice,
  PageHeader,
  SectionTitle,
  Status,
} from "@/components/ui";
export default function SupplierPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <SupplierContent key={id} id={id} />;
}
function joined(...values: Array<string | null>) {
  return values.filter(Boolean).join(" ") || "—";
}
function SupplierContent({ id }: { id: string }) {
  const { data, error, loading } = useResource<{
    supplier: Supplier;
    quotations: SupplierQuotation[];
    products: SupplierProduct[];
  }>(`/api/suppliers/${id}`);
  if (loading) return <Loading label="Loading supplier" />;
  if (error || !data)
    return <Notice>{error?.message ?? "Supplier unavailable."}</Notice>;
  const { supplier, quotations, products } = data;
  const otherNames = supplier.aliases.filter((name) => name !== supplier.name);
  const cards = [
    { label: "Quotations", value: supplier.quotationCount },
    { label: "Approved", value: supplier.approvedCount },
    { label: "Products quoted", value: supplier.productCount },
    { label: "Currencies", value: supplier.currencies.length },
  ];
  return (
    <>
      <Link href="/suppliers" className="back-link">
        <ArrowLeft size={13} />
        All suppliers
      </Link>
      <PageHeader
        eyebrow="Supplier"
        title={supplier.name}
        description={
          otherNames.length
            ? `Also appears as ${otherNames.join(", ")}.`
            : undefined
        }
      />
      <div className="detail-meta">
        <span>
          <MapPin size={12} />
          {supplier.country ?? "Country not found"}
        </span>
        {supplier.email && (
          <span>
            <Mail size={12} />
            {supplier.email}
          </span>
        )}
        {supplier.website && (
          <span>
            <Globe size={12} />
            {supplier.website}
          </span>
        )}
        <span>Last activity {formatDate(supplier.lastActivityAt)}</span>
      </div>
      {supplier.approvedCount < supplier.quotationCount && (
        <div className="supplier-review-note">
          <Notice kind="info">
            {supplier.quotationCount - supplier.approvedCount} of{" "}
            {supplier.quotationCount} quotations are not approved yet. Their
            values come from the analysis and still need review.
          </Notice>
        </div>
      )}
      <div className="metric-grid">
        {cards.map((card) => (
          <div key={card.label} className="metric-card">
            <div className="metric-label">{card.label}</div>
            <div className="metric-number">{card.value}</div>
          </div>
        ))}
      </div>
      <div className="section-stack">
        <section className="section-card">
          <SectionTitle title="Quotations" count={quotations.length} />
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Quotation</th>
                  <th scope="col">Date</th>
                  <th scope="col">Total</th>
                  <th scope="col">Incoterm</th>
                  <th scope="col">Project</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {quotations.map((quotation) => (
                  <tr key={quotation.documentId}>
                    <td className="nowrap">
                      <Link href={`/documents/${quotation.documentId}`}>
                        <div className="table-title">
                          {quotation.quotationNumber ?? quotation.fileName}
                        </div>
                        <div className="table-subtitle">
                          {quotation.fileName} · {quotation.productCount}{" "}
                          {quotation.productCount === 1
                            ? "product"
                            : "products"}
                        </div>
                      </Link>
                    </td>
                    <td className="muted nowrap">
                      {quotation.quotationDate ?? "—"}
                      {quotation.validityDate && (
                        <div className="table-subtitle">
                          Valid until {quotation.validityDate}
                        </div>
                      )}
                    </td>
                    <td className="nowrap">
                      {joined(quotation.totalAmount, quotation.currency)}
                    </td>
                    <td className="muted nowrap">
                      {quotation.incoterm ?? "—"}
                    </td>
                    <td className="muted nowrap">
                      {quotation.projectId ? (
                        <Link
                          className="text-link"
                          href={`/projects/${quotation.projectId}`}
                        >
                          {quotation.projectName}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      <Status
                        status={quotation.documentStatus}
                        approved={quotation.approved}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="section-card">
          <SectionTitle
            title="Quoted products"
            count={products.length}
            action={
              products.length ? (
                <ExportLink href={`/api/suppliers/${id}?format=csv`} />
              ) : undefined
            }
          />
          {products.length ? (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Product</th>
                    <th scope="col">Unit price</th>
                    <th scope="col">Minimum order</th>
                    <th scope="col">Lead time</th>
                    <th scope="col">Quotation</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((product, index) => (
                    <tr key={`${product.documentId}-${index}`}>
                      <td>
                        <div className="table-title">
                          {product.reference ?? "No reference"}
                        </div>
                        <div className="table-subtitle">
                          {joined(product.description, product.material)}
                        </div>
                      </td>
                      <td className="nowrap">
                        {joined(product.unitPrice, product.currency)}
                        {product.priceBasis && (
                          <div className="table-subtitle">
                            {product.priceBasis}
                          </div>
                        )}
                      </td>
                      <td className="muted nowrap">
                        {joined(
                          product.minimumOrderQuantity,
                          product.minimumOrderQuantity
                            ? product.quantityUnit
                            : null,
                        )}
                      </td>
                      <td className="muted">{product.leadTime ?? "—"}</td>
                      <td className="muted nowrap">
                        <Link
                          className="text-link"
                          href={`/documents/${product.documentId}`}
                        >
                          {product.quotationNumber ?? "Open document"}
                        </Link>
                        <div className="table-subtitle">
                          {product.approved ? "Approved" : "Not approved"}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="No products found">
              None of this supplier&apos;s quotations list individual products.
            </Empty>
          )}
        </section>
      </div>
    </>
  );
}
