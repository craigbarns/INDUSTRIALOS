"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { ApiError, message, useResource, type Workspace } from "@/lib/client";
import { Brand } from "@/components/workspace";
import { Button, Loading, Notice } from "@/components/ui";

export default function OnboardingPage() {
  const { data, error, loading } = useResource<Workspace>("/api/workspace");
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    if (error instanceof ApiError && error.status === 401)
      router.replace("/login");
    if (data?.organization) router.replace("/dashboard");
  }, [data, error, router]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFormError("");
    try {
      const result = await authClient.organization.create({ name, slug });
      if (result.error)
        throw new Error(
          result.error.message ?? "Could not create organization.",
        );
      if (result.data) {
        const active = await authClient.organization.setActive({
          organizationId: result.data.id,
        });
        if (active.error) throw new Error(active.error.message);
      }
      router.replace("/dashboard");
      router.refresh();
    } catch (error) {
      setFormError(message(error));
    } finally {
      setBusy(false);
    }
  }
  async function selectOrganization(id: string) {
    setBusy(true);
    setFormError("");
    try {
      const result = await authClient.organization.setActive({
        organizationId: id,
      });
      if (result.error) throw new Error(result.error.message);
      router.replace("/dashboard");
    } catch (error) {
      setFormError(message(error));
    } finally {
      setBusy(false);
    }
  }
  if (loading) return <Loading />;
  return (
    <main className="standalone">
      <div className="onboarding-card">
        <Brand />
        <div className="eyebrow">Your company, connected</div>
        <h1>
          {data?.organizations.length && !creating
            ? "Choose your workspace"
            : "Create your workspace"}
        </h1>
        <p>
          Organize your team’s projects and confidential supplier documents in a
          private company workspace.
        </p>
        {(formError || error) && <Notice>{formError || error?.message}</Notice>}
        {Boolean(data?.organizations.length) && !creating ? (
          <div className="form-stack">
            {data?.organizations.map((org) => (
              <Button
                key={org.id}
                variant="secondary"
                disabled={busy}
                onClick={() => selectOrganization(org.id)}
              >
                {org.name}
                <ArrowRight size={14} />
              </Button>
            ))}
            <Button variant="ghost" onClick={() => setCreating(true)}>
              Create another organization
            </Button>
          </div>
        ) : (
          <form className="form-stack" onSubmit={submit}>
            <div className="field">
              <label htmlFor="org-name">Company name</label>
              <input
                className="input"
                id="org-name"
                required
                maxLength={100}
                placeholder="Your company"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setSlug(
                    e.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, "-")
                      .replace(/^-|-$/g, ""),
                  );
                }}
              />
            </div>
            <div className="field">
              <label htmlFor="org-slug">Workspace identifier</label>
              <input
                className="input"
                id="org-slug"
                required
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                minLength={3}
                maxLength={80}
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="your-company"
              />
              <span className="field-help">
                Lowercase letters, numbers, and hyphens.
              </span>
            </div>
            <Notice kind="info">
              AI document processing is disabled initially. An administrator can
              enable it after confirming your organization’s processing
              permissions.
            </Notice>
            <Button type="submit" loading={busy}>
              Create workspace <ArrowRight size={14} />
            </Button>
          </form>
        )}
        <div className="auth-legal" style={{ marginTop: 20 }}>
          Signed in as {data?.user.email}
        </div>
      </div>
    </main>
  );
}
