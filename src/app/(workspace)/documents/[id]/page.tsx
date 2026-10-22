"use client";
import { use } from "react";
import { DocumentReview } from "@/components/document-review";
export default function DocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <DocumentReview key={id} id={id} />;
}
