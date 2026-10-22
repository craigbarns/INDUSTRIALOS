"use client";
import { useState, type FormEvent } from "react";
import { Check, Mail } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { message } from "@/lib/client";
import { useWorkspace } from "@/components/workspace";
import { Button, Notice } from "@/components/ui";
export default function ProfilePage() {
  const { workspace, refresh } = useWorkspace();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  async function updateName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setBusy("name");
    try {
      const result = await authClient.updateUser({
        name: String(new FormData(event.currentTarget).get("name")),
      });
      if (result.error) throw new Error(result.error.message);
      refresh();
      setSuccess("Your profile has been updated.");
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(null);
    }
  }
  async function password(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    setError("");
    setSuccess("");
    setBusy("password");
    try {
      const result = await authClient.changePassword({
        currentPassword: String(form.get("currentPassword")),
        newPassword: String(form.get("newPassword")),
        revokeOtherSessions: true,
      });
      if (result.error) throw new Error(result.error.message);
      element.reset();
      setSuccess(
        "Your password has been changed. Other sessions have been signed out.",
      );
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(null);
    }
  }
  async function verifyEmail() {
    setError("");
    setSuccess("");
    setBusy("verify");
    try {
      const result = await authClient.sendVerificationEmail({
        email: workspace.user.email,
        callbackURL: "/settings/profile",
      });
      if (result.error) throw new Error(result.error.message);
      setSuccess(
        "Verification requested. Check your inbox. Delivery requires the deployment’s email service to be configured.",
      );
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="stack">
      {error && <Notice>{error}</Notice>}
      {success && <Notice kind="success">{success}</Notice>}
      <section className="section-card settings-card">
        <div className="settings-section">
          <h3>Personal information</h3>
          <p>Your profile is shared with members of your organizations.</p>
          <form onSubmit={updateName} className="form-stack">
            <div className="field">
              <label htmlFor="profile-name">Full name</label>
              <input
                className="input"
                id="profile-name"
                name="name"
                required
                minLength={1}
                maxLength={100}
                defaultValue={workspace.user.name}
              />
            </div>
            <div className="field">
              <label htmlFor="profile-email">Email address</label>
              <input
                className="input"
                id="profile-email"
                value={workspace.user.email}
                disabled
              />
              <div className="field-help row">
                {workspace.user.emailVerified ? (
                  <>
                    <Check size={12} />
                    Email verified
                  </>
                ) : (
                  <>
                    <Mail size={12} />
                    Email verification is required to accept team invitations.
                  </>
                )}
              </div>
            </div>
            <div className="row-between">
              {!workspace.user.emailVerified ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={verifyEmail}
                  loading={busy === "verify"}
                >
                  Send verification email
                </Button>
              ) : (
                <span />
              )}
              <Button type="submit" loading={busy === "name"}>
                Save profile
              </Button>
            </div>
          </form>
        </div>
        <div className="settings-section">
          <h3>Change password</h3>
          <p>
            Use a unique password of at least 12 characters. Other active
            sessions will be revoked.
          </p>
          <form className="form-stack" onSubmit={password}>
            <div className="field">
              <label htmlFor="current-password">Current password</label>
              <input
                className="input"
                id="current-password"
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                required
                maxLength={128}
              />
            </div>
            <div className="field">
              <label htmlFor="new-password">New password</label>
              <input
                className="input"
                id="new-password"
                name="newPassword"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
              />
            </div>
            <div className="form-actions">
              <Button
                type="submit"
                variant="secondary"
                loading={busy === "password"}
              >
                Update password
              </Button>
            </div>
          </form>
        </div>
        <div className="settings-section">
          <h3>Application language</h3>
          <p>
            English is currently available. French and Chinese localization are
            planned.
          </p>
          <select
            className="select"
            aria-label="Application language"
            defaultValue="en"
            style={{ maxWidth: 250 }}
          >
            <option value="en">English</option>
            <option value="fr" disabled>
              Français — planned
            </option>
            <option value="zh" disabled>
              中文 — planned
            </option>
          </select>
        </div>
      </section>
    </div>
  );
}
