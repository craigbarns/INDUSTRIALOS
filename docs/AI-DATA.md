# AI processing and confidential documents

Sprint 1 uses the official `@mistralai/mistralai` SDK for two separate stateless operations. No OpenRouter, other LLM provider, email, supplier contact, purchasing or payment operation is implemented. Model identifiers are configurable; defaults are `mistral-ocr-latest` and `mistral-large-latest`. Confirm model availability under the deployed Mistral account and pin an approved stable model where contractual controls require it. An alias can change independently of this application.

## Data flow and permission

The authenticated API authorizes membership of the active organization before scheduling processing. The background worker checks the global `AI_PROCESSING_ENABLED=true` gate and the organization's processing permission before sending data. Organization administrators must only enable processing after their company has authorized Mistral as a processor and reviewed applicable contracts, security, retention, training preferences and data-location requirements. The permission flag is an application control; it cannot negotiate or verify a provider contract.

The worker reads original document bytes from the private Railway S3-compatible bucket through a server-side loader. OCR sends those bytes as an inline base64 PDF (`document_url`) or image (`image_url`) to Mistral's `/v1/ocr` endpoint. It does not send Railway credentials, session tokens, signed bucket URLs, organization membership records or database credentials. A full page may still contain supplier/customer names, addresses, prices, personal information and confidential specifications.

The OCR result is normalized into 1-based page numbers and Markdown. Default inline table formatting keeps table text within its source page. Semantic extraction then sends the OCR page Markdown and a procurement JSON schema to `/v1/chat/completions`. Structured output is validated locally using Zod. OCR pages, extraction data and field evidence are persisted in the tenant's PostgreSQL records. Machine interpretations remain separate from the original OCR and from user corrections. Application/provider failures expose only safe codes and messages; the integration modules do not log source documents, extraction values or provider error bodies. No monitoring or analytics integration receives document contents.

This application does not assert that Mistral retains no data, uses no data for training, or guarantees a particular processing region for a given customer. Those controls must be verified in the actual Mistral account and contract. Mistral documents ZDR for eligible stateless endpoints, including OCR and chat completions, and distinguishes it from training opt-out. The application uses neither the Files API nor stateful provider agents. Read the current [ZDR documentation](https://docs.mistral.ai/admin/monitor-comply/zero-data-retention), [privacy policy](https://legal.mistral.ai/terms/privacy-policy/), [commercial terms](https://legal.mistral.ai/terms/commercial-terms-of-service/), [data processing addendum](https://legal.mistral.ai/terms/data-processing-addendum/), and [data-location guidance](https://help.mistral.ai/en/articles/347629-where-do-you-store-my-data-or-my-organization-s-data) before authorizing production processing. Preview/Labs models may have different terms.

## Extraction contract

The schema in `src/lib/ai/extraction-schema.ts` contains supplier, quotation, products, pricing, logistics and compliance sections. Each product has independent technical, quantity, currency, price-basis and price-tier fields. Financial values are decimal strings, never JavaScript floating-point numbers. Physical measurements retain their quoted units. The application does not calculate an exchange rate, convert currencies, convert weights, or infer a certification from a general compliance claim.

Every extracted leaf includes:

```ts
{
  value: string | null;
  originalText: string | null;
  pageNumber: number | null; // 1-based source page
  status: "extracted" | "missing" | "ambiguous" | "corrected";
  documentId: string; // assigned by the server, never by the model
}
```

The model can return only `extracted`, `missing` or `ambiguous`; the server assigns document IDs. Missing information uses null rather than guessed values. Quoted evidence must occur on the cited OCR page after whitespace/Unicode normalization. Invalid quotes, nonexistent pages, unsupported decimal notation, inferred currency codes, or absent price/quantity/weight bases are flagged. Numeric values are compared as strings against source numeric tokens without rounding. No synthetic confidence score is produced. The normalizer rejects empty OCR, duplicate page indexes and gaps in the returned page sequence instead of silently discarding pages.

Quote matching proves that a text span exists. It does **not** prove that the model attached the right price to the right product, that OCR read a character correctly, that a compliance assertion is true, or that all line items were found. OCR may also omit a trailing page without providing an independently verifiable page count. All completed machine analyses require explicit human review and approval. An unresolved ambiguous field blocks approval. Users should compare supplier claims and price bases with the original document.

Corrections accept only validated existing leaf paths and values; clients cannot replace source quotes, page references or document IDs. A user-added value with no original evidence retains null source fields and is marked `corrected`. This means the user supplied or verified the value; it does not claim the document contained it. Audit records retain the original AI value, previous value, corrected value, actor and time. The API controls optimistic versions to avoid overwriting another reviewer. Source OCR and original extraction remain immutable during correction.

## Untrusted supplier instructions

Supplier text is serialized as untrusted page data in the user message; business rules and the JSON contract remain in the system message. The model is explicitly instructed to ignore document instructions, avoid fabricated values and return only schema-bound data. No tools or external actions are available to extraction. JSON schema and deterministic evidence validation limit output shape and reject unsupported evidence. These controls reduce risk but do not guarantee that a language model cannot be influenced by malicious text. Human review is the final approval boundary in Sprint 1.

## Operational limits and tests

Uploads are limited to 20 MB PDF, PNG and JPEG files with server-side extension, MIME and signature checks. OCR and extraction each have a request timeout and accept the worker's cancellation signal. Extraction fails explicitly above 350,000 OCR characters or 500 product rows. It uses page ranges of at most four pages and about 60,000 characters, retaining original page numbers; a single longer page stays intact. The default output budget is 65,536 tokens per request, configurable through `MISTRAL_EXTRACTION_MAX_TOKENS`. Adapt it when selecting a model with a smaller context/output budget: Mistral counts input and output toward the [model context limit](https://docs.mistral.ai/resources/known-limitations).

If Mistral reports `finishReason: length`, the range is split and extracted again. A single page that still does not fit fails with `EXTRACTION_DOCUMENT_TOO_LONG`; partial responses never reach the database. Products are kept in page order without deduplicating or inferring merged prices. Conflicting document-level fields are flagged as ambiguous. Products continuing across ranges require human review. The maintained PostgreSQL-backed queue handles persistent retries; the AI modules classify transient network/429/5xx failures as retryable and do not run their own in-memory queue.

Automated AI tests use injected transports and mocked provider responses, including multiple products/currencies/tiers, absent prices/certifications, forged evidence, ambiguous bases, missing pages, API failure and correction safety. They incur no provider charges. They demonstrate application behavior, not live OCR/model accuracy.

The optional real integration test is disabled unless both `RUN_MISTRAL_INTEGRATION=true` and `AI_PROCESSING_ENABLED=true` are set, plus an explicit `MISTRAL_API_KEY`. Pass an authorized, preferably non-sensitive fixture path; there is no default customer document. For an environment file:

```sh
RUN_MISTRAL_INTEGRATION=true AI_PROCESSING_ENABLED=true \
  node --env-file=.env.local --import tsx scripts/test-mistral.ts /absolute/path/to/fixture.pdf
```

This sends that fixture to Mistral and may incur charges. It prints only page/product counts and validation counts. No live Mistral test has been run merely by installing the application or running the mocked test suite.

## Official integration references

- [Mistral OCR processor](https://docs.mistral.ai/studio/document-processing/basic_ocr): supported inline base64 input, page structure, inline tables and current OCR alias.
- [OCR API](https://docs.mistral.ai/api/endpoint/ocr): endpoint and provider response contract.
- [Custom structured outputs](https://docs.mistral.ai/studio/conversations/structured-output/custom) and [chat API](https://docs.mistral.ai/api/endpoint/chat): JSON schema mode with separate semantic extraction.
- [Official TypeScript SDK](https://github.com/mistralai/client-ts): camelCase SDK properties (`documentUrl`, `imageUrl`, `responseFormat`, `jsonSchema.schemaDefinition`) map to the API's snake_case JSON.

References reviewed on 2026-10-22. Provider behavior, terms and model aliases can change; recheck them before production enablement.
