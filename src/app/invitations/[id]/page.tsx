"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { message } from "@/lib/client";
import { Brand } from "@/components/workspace";
import { Button, Loading, Notice } from "@/components/ui";
export default function InvitationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const session = authClient.useSession();
  const router = useRouter();
  const [organization, setOrganization] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!session.data?.user.emailVerified) return;
    let alive = true;
    void authClient.organization
      .getInvitation({ query: { id } })
      .then((result) => {
        if (!alive) return;
        if (result.error)
          setError(
            result.error.message ??
              "This invitation is unavailable or has expired.",
          );
        else if (result.data) {
          setOrganization(result.data.organizationName);
          setEmail(result.data.email);
        }
      });
    return () => {
      alive = false;
    };
  }, [id, session.data?.user.emailVerified]);
  async function accept() {
    setBusy(true);
    setError("");
    try {
      const result = await authClient.organization.acceptInvitation({
        invitationId: id,
      });
      if (result.error) throw new Error(result.error.message);
      if (result.data?.member)
        await authClient.organization.setActive({
          organizationId: result.data.member.organizationId,
        });
      router.replace("/dashboard");
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  async function verify() {
    if (!session.data) return;
    setBusy(true);
    setError("");
    try {
      const result = await authClient.sendVerificationEmail({
        email: session.data.user.email,
        callbackURL: `/invitations/${id}`,
      });
      if (result.error) throw new Error(result.error.message);
      setInfo(
        "Verification requested. Check your inbox, then return to this invitation. Email delivery requires the workspace deployment’s email service.",
      );
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  if (session.isPending) return <Loading label="Checking your invitation" />;
  return (
    <main className="standalone">
      <div className="onboarding-card">
        <Brand />
        <div className="eyebrow">Team invitation</div>
        <h1>
          {organization ? `Join ${organization}` : "Join your team’s workspace"}
        </h1>
        <p>
          Collaborate on procurement projects and confidential supplier
          intelligence.
        </p>
        {error && <Notice>{error}</Notice>}
        {info && <Notice kind="success">{info}</Notice>}
        {!session.data ? (
          <div className="form-stack">
            <Notice kind="info">
              Sign in with the invited email address to review and accept this
              invitation.
            </Notice>
            <Link
              href={`/login?next=${encodeURIComponent(`/invitations/${id}`)}`}
              className="button button-primary"
            >
              Sign in to continue
            </Link>
            <Link
              href={`/signup?next=${encodeURIComponent(`/invitations/${id}`)}`}
              className="text-link"
            >
              Create an account
            </Link>
          </div>
        ) : !session.data.user.emailVerified ? (
          <div className="form-stack">
            <Notice kind="info">
              Verify {session.data.user.email} before accepting an invitation.
              This protects the organization from someone claiming another
              person’s email address.
            </Notice>
            <Button onClick={verify} loading={busy}>
              Send verification email
            </Button>
            <Button
              variant="secondary"
              onClick={() => window.location.reload()}
            >
              I have verified my email
            </Button>
          </div>
        ) : organization ? (
          <div className="form-stack">
            <Notice kind="info">
              This invitation is for {email}. You are signed in as{" "}
              {session.data.user.email}.
            </Notice>
            <Button onClick={accept} loading={busy}>
              Accept invitation
            </Button>
          </div>
        ) : !error ? (
          <Loading label="Loading invitation" />
        ) : (
          <Link href="/dashboard" className="button button-secondary">
            Return to workspace
          </Link>
        )}
      </div>
    </main>
  );
}
