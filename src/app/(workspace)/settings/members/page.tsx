"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Check, Copy, Plus, Users } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { message } from "@/lib/client";
import { formatDate } from "@/lib/i18n";
import { useWorkspace } from "@/components/workspace";
import {
  Button,
  Empty,
  Loading,
  Modal,
  Notice,
  SectionTitle,
} from "@/components/ui";
interface Member {
  id: string;
  role: string;
  userId: string;
  user: { id: string; name: string; email: string };
}
interface Invitation {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string | Date;
}
export default function MembersPage() {
  const { workspace } = useWorkspace();
  const admin = workspace.role
    .split(",")
    .some((role) => ["owner", "admin"].includes(role));
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [invite, setInvite] = useState(false);
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [remove, setRemove] = useState<Member | null>(null);
  const load = useCallback(
    () =>
      authClient.organization
        .getFullOrganization({
          query: {
            organizationId: workspace.organization!.id,
            membersLimit: 100,
          },
        })
        .then((result) => {
          if (result.error) throw new Error(result.error.message);
          if (result.data) {
            setError("");
            setNow(Date.now());
            setMembers(result.data.members as Member[]);
            setInvitations(result.data.invitations as unknown as Invitation[]);
          }
        })
        .catch((error: unknown) => setError(message(error)))
        .finally(() => setLoading(false)),
    [workspace.organization],
  );
  useEffect(() => {
    void load();
  }, [load]);
  async function inviteMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("invite");
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await authClient.organization.inviteMember({
        email: String(form.get("email")),
        role: String(form.get("role")) as "admin" | "member",
        organizationId: workspace.organization!.id,
      });
      if (result.error) throw new Error(result.error.message);
      if (result.data)
        setLink(`${window.location.origin}/invitations/${result.data.id}`);
      await load();
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(null);
    }
  }
  async function role(memberId: string, nextRole: string) {
    setBusy(memberId);
    setError("");
    try {
      const result = await authClient.organization.updateMemberRole({
        memberId,
        role: nextRole as "member" | "admin",
        organizationId: workspace.organization!.id,
      });
      if (result.error) throw new Error(result.error.message);
      await load();
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(null);
    }
  }
  async function removeMember() {
    if (!remove) return;
    setBusy(remove.id);
    setError("");
    try {
      const result = await authClient.organization.removeMember({
        memberIdOrEmail: remove.id,
        organizationId: workspace.organization!.id,
      });
      if (result.error) throw new Error(result.error.message);
      setRemove(null);
      await load();
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(null);
    }
  }
  async function cancelInvitation(id: string) {
    setBusy(id);
    setError("");
    try {
      const result = await authClient.organization.cancelInvitation({
        invitationId: id,
      });
      if (result.error) throw new Error(result.error.message);
      await load();
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(null);
    }
  }
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setError("Copy the invitation link from the text field.");
    }
  }
  return (
    <div className="stack">
      {error && <Notice>{error}</Notice>}
      <section className="section-card settings-card">
        <SectionTitle
          title="Organization members"
          count={members.length}
          action={
            admin && (
              <Button
                variant="secondary"
                onClick={() => {
                  setInvite(true);
                  setLink("");
                  setCopied(false);
                }}
              >
                <Plus size={13} />
                Invite member
              </Button>
            )
          }
        />
        {loading ? (
          <Loading label="Loading members" />
        ) : members.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Member</th>
                  <th scope="col">Role</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.id}>
                    <td>
                      <div className="row">
                        <div className="member-avatar">
                          {member.user.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div className="table-title">
                            {member.user.name}
                            {member.userId === workspace.user.id ? (
                              <span className="muted"> (you)</span>
                            ) : (
                              ""
                            )}
                          </div>
                          <div className="table-subtitle">
                            {member.user.email}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      {admin &&
                      member.userId !== workspace.user.id &&
                      !member.role.includes("owner") ? (
                        <select
                          className="select"
                          style={{
                            minHeight: 30,
                            padding: 5,
                            fontSize: 10,
                            width: 95,
                          }}
                          aria-label={`Role for ${member.user.name}`}
                          value={member.role}
                          disabled={busy === member.id}
                          onChange={(e) => {
                            void role(member.id, e.target.value);
                          }}
                        >
                          <option value="member">Member</option>
                          <option value="admin">Admin</option>
                        </select>
                      ) : (
                        <span
                          className="small"
                          style={{ textTransform: "capitalize" }}
                        >
                          {member.role}
                        </span>
                      )}
                    </td>
                    <td>
                      {admin &&
                        member.userId !== workspace.user.id &&
                        !member.role.includes("owner") && (
                          <Button
                            variant="ghost"
                            disabled={busy === member.id}
                            onClick={() => setRemove(member)}
                          >
                            Remove
                          </Button>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon={<Users size={22} />} title="No members available">
            We could not retrieve members for this organization.
          </Empty>
        )}
      </section>
      {admin && (
        <section className="section-card settings-card">
          <SectionTitle
            title="Pending invitations"
            count={
              invitations.filter(
                (i) =>
                  i.status === "pending" &&
                  Date.parse(String(i.expiresAt)) > now,
              ).length
            }
          />
          {invitations.filter(
            (i) =>
              i.status === "pending" && Date.parse(String(i.expiresAt)) > now,
          ).length ? (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Email</th>
                    <th scope="col">Role</th>
                    <th scope="col">Expires</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {invitations
                    .filter(
                      (i) =>
                        i.status === "pending" &&
                        Date.parse(String(i.expiresAt)) > now,
                    )
                    .map((i) => (
                      <tr key={i.id}>
                        <td>{i.email}</td>
                        <td
                          className="small"
                          style={{ textTransform: "capitalize" }}
                        >
                          {i.role}
                        </td>
                        <td className="small muted nowrap">
                          {formatDate(i.expiresAt)}
                        </td>
                        <td>
                          <div className="row">
                            <button
                              className="icon-button"
                              aria-label={`Copy invitation link for ${i.email}`}
                              onClick={() => {
                                void copy(
                                  `${window.location.origin}/invitations/${i.id}`,
                                );
                              }}
                            >
                              <Copy size={13} />
                            </button>
                            <Button
                              variant="ghost"
                              disabled={busy === i.id}
                              onClick={() => cancelInvitation(i.id)}
                            >
                              Cancel
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="section-body">
              <p className="small">
                No pending invitations. Invite a colleague to collaborate in
                this workspace.
              </p>
            </div>
          )}
        </section>
      )}
      <p className="small muted" style={{ maxWidth: 650, lineHeight: 1.8 }}>
        Invitation links must be shared directly with the intended recipient.
        Industrial OS does not send invitation emails automatically. Recipients
        must sign in with the invited email and verify their email address
        before accepting.
      </p>
      <Modal
        open={invite}
        onOpenChange={setInvite}
        title={link ? "Invitation ready" : "Invite a colleague"}
        description={
          link
            ? "Share this private link with the invited colleague through your preferred channel."
            : "Give your team access to projects and document intelligence."
        }
      >
        {error && <Notice>{error}</Notice>}
        {link ? (
          <div className="form-stack">
            <div className="copy-link">
              <input
                aria-label="Invitation link"
                className="input"
                readOnly
                value={link}
                onFocus={(e) => e.target.select()}
              />
              <Button variant="secondary" onClick={() => copy(link)}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <Notice kind="info">
              No invitation email has been sent. The recipient must verify their
              email before accepting.
            </Notice>
            <div className="form-actions">
              <Button onClick={() => setInvite(false)}>Done</Button>
            </div>
          </div>
        ) : (
          <form className="form-stack" onSubmit={inviteMember}>
            <div className="field">
              <label htmlFor="invite-email">Work email</label>
              <input
                className="input"
                name="email"
                id="invite-email"
                required
                type="email"
                maxLength={254}
                placeholder="colleague@company.com"
              />
            </div>
            <div className="field">
              <label htmlFor="invite-role">Workspace role</label>
              <select className="select" name="role" id="invite-role">
                <option value="member">Member — projects and documents</option>
                <option value="admin">
                  Admin — workspace and member management
                </option>
              </select>
            </div>
            <div className="form-actions">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setInvite(false)}
              >
                Cancel
              </Button>
              <Button type="submit" loading={busy === "invite"}>
                Create invitation link
              </Button>
            </div>
          </form>
        )}
      </Modal>
      <Modal
        open={Boolean(remove)}
        onOpenChange={(open) => {
          if (!open) setRemove(null);
        }}
        title="Remove this member?"
        description={`${remove?.user.name ?? "This member"} will lose access to this organization’s projects and documents.`}
      >
        {error && <Notice>{error}</Notice>}
        <div className="form-actions">
          <Button variant="secondary" onClick={() => setRemove(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={busy === remove?.id}
            onClick={removeMember}
          >
            Remove member
          </Button>
        </div>
      </Modal>
    </div>
  );
}
