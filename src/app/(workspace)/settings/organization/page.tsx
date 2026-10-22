"use client";
import { useState, type FormEvent } from "react";
import { ShieldCheck } from "lucide-react";
import { api, message, useResource } from "@/lib/client";
import { useWorkspace } from "@/components/workspace";
import { Button, Loading, Modal, Notice, Status } from "@/components/ui";
interface OrganizationSettings {
  id: string;
  name: string;
  slug: string;
  aiProcessingEnabled: boolean;
  deploymentAiEnabled?: boolean;
}
export default function OrganizationPage() {
  const { workspace, refresh: refreshWorkspace } = useWorkspace();
  const { data, error, loading, refresh } = useResource<OrganizationSettings>(
    "/api/settings/organization",
  );
  const admin = workspace.role
    .split(",")
    .some((role) => ["owner", "admin"].includes(role));
  const [formError, setFormError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  async function update(input: {
    name?: string;
    aiProcessingEnabled?: boolean;
  }) {
    setBusy(true);
    setFormError("");
    setSuccess("");
    try {
      await api("/api/settings/organization", {
        method: "PATCH",
        body: JSON.stringify(input),
      });
      refresh();
      refreshWorkspace();
      setSuccess("Organization settings have been saved.");
      setConsent(false);
    } catch (error) {
      setFormError(message(error));
    } finally {
      setBusy(false);
    }
  }
  function name(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void update({
      name: String(new FormData(event.currentTarget).get("name")),
    });
  }
  if (loading) return <Loading label="Loading organization settings" />;
  if (error || !data)
    return (
      <Notice>{error?.message ?? "Organization settings unavailable."}</Notice>
    );
  return (
    <div className="stack">
      {formError && <Notice>{formError}</Notice>}
      {success && <Notice kind="success">{success}</Notice>}
      {!admin && (
        <Notice kind="info">
          Only workspace owners and administrators can change organization
          settings.
        </Notice>
      )}
      <section className="section-card settings-card">
        <div className="settings-section">
          <h3>Organization details</h3>
          <p>Your workspace name is visible to your organization members.</p>
          <form className="form-stack" onSubmit={name}>
            <div className="field">
              <label htmlFor="organization-name">Organization name</label>
              <input
                id="organization-name"
                className="input"
                name="name"
                required
                maxLength={100}
                defaultValue={data.name}
                disabled={!admin}
              />
            </div>
            <div className="field">
              <label htmlFor="organization-slug">Workspace identifier</label>
              <input
                id="organization-slug"
                className="input"
                value={data.slug}
                disabled
              />
            </div>
            {admin && (
              <div className="form-actions">
                <Button type="submit" loading={busy}>
                  Save changes
                </Button>
              </div>
            )}
          </form>
        </div>
        <div className="settings-section">
          <div className="row-between" style={{ marginBottom: 10 }}>
            <h3 className="row">
              <ShieldCheck size={15} />
              AI document processing
            </h3>
            <Status status={data.aiProcessingEnabled ? "active" : "disabled"} />
          </div>
          <p>
            OCR and structured extraction use Mistral’s direct API. Processing
            is controlled for your entire organization.
          </p>
          <div className="contract-box">
            When you start analysis, Industrial OS sends the original document
            bytes to Mistral for OCR. The resulting page text is sent to a
            Mistral language model for structured extraction. Document contents
            may include supplier identities, contact information,
            specifications, prices, and commercial terms. These operations
            require your organization’s authorization and appropriate provider
            contractual safeguards. Your deployment administrator must verify
            the applicable Mistral agreement, retention controls, region, and
            processing terms before enabling this feature.
          </div>
          {data.deploymentAiEnabled === false && (
            <div style={{ marginBottom: 17 }}>
              <Notice kind="info">
                AI processing is disabled for this deployment. Your deployment
                administrator must finish provider configuration before
                documents can be analyzed.
              </Notice>
            </div>
          )}
          <p className="small">
            Disabling processing prevents new provider calls. It does not erase
            information already sent to the provider. Original documents and
            extracted results remain private in your workspace.
          </p>
          {admin && (
            <Button
              variant="secondary"
              loading={busy}
              onClick={() => {
                if (data.aiProcessingEnabled)
                  void update({ aiProcessingEnabled: false });
                else {
                  setAcknowledged(false);
                  setConsent(true);
                }
              }}
            >
              {data.aiProcessingEnabled
                ? "Disable AI processing"
                : "Review and enable AI processing"}
            </Button>
          )}
        </div>
      </section>
      <Modal
        open={consent}
        onOpenChange={setConsent}
        title="Enable AI document processing"
        description="Confirm your organization’s authorization before confidential documents can be sent to Mistral."
      >
        <div className="form-stack">
          <Notice kind="info">
            This setting enables manual and queued document analyses for your
            workspace. It does not start an analysis automatically.
          </Notice>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
            />
            <span>
              I am authorized to enable processing for this organization. We
              have the necessary permissions to send these documents to Mistral
              and have confirmed appropriate contractual safeguards, including
              data handling and retention terms.
            </span>
          </label>
          {formError && <Notice>{formError}</Notice>}
          <div className="form-actions">
            <Button variant="secondary" onClick={() => setConsent(false)}>
              Cancel
            </Button>
            <Button
              disabled={!acknowledged}
              loading={busy}
              onClick={() => update({ aiProcessingEnabled: true })}
            >
              Enable AI processing
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
