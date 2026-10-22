"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileSearch, Layers3, LockKeyhole } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { message } from "@/lib/client";
import { Brand } from "@/components/workspace";
import { Button, Notice } from "@/components/ui";

export function AuthForm({ signup = false }: { signup?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const router = useRouter();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const requested = new URLSearchParams(window.location.search).get("next");
    const destination =
      requested?.startsWith("/") && !requested.startsWith("//")
        ? requested
        : signup
          ? "/onboarding"
          : "/dashboard";
    try {
      const result = signup
        ? await authClient.signUp.email({
            name: String(form.get("name")),
            email,
            password: String(form.get("password")),
            callbackURL: destination,
          })
        : await authClient.signIn.email({
            email,
            password: String(form.get("password")),
            rememberMe: true,
            callbackURL: destination,
          });
      if (result.error)
        setError(
          result.error.message ??
            "Authentication failed. Check your details and try again.",
        );
      else router.replace(destination);
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-layout">
      <aside className="auth-aside">
        <Brand />
        <div className="auth-aside-copy">
          <div className="eyebrow" style={{ color: "#8094b5" }}>
            Intelligence for industrial procurement
          </div>
          <h1>
            Your documents.
            <br />
            Your decisions.
            <br />
            One workspace.
          </h1>
          <p>
            Turn complex supplier quotations into clear, traceable procurement
            intelligence.
          </p>
          <div className="auth-proof">
            <div>
              <FileSearch size={17} />
              Source evidence for every extracted field
            </div>
            <div>
              <Layers3 size={17} />
              Projects, documents, and teams in one place
            </div>
            <div>
              <LockKeyhole size={17} />
              Private workspaces for confidential information
            </div>
          </div>
        </div>
        <div className="auth-aside-footer">
          Built for the teams behind global industry.
          <br />© {new Date().getFullYear()} Industrial OS
        </div>
      </aside>
      <main className="auth-main">
        <div className="auth-card">
          <div className="auth-mobile-brand">
            <Brand />
          </div>
          <div>
            <div className="eyebrow">Welcome to Industrial OS</div>
            <h1>{signup ? "Create your account" : "Welcome back"}</h1>
            <p>
              {signup
                ? "Start building your procurement workspace."
                : "Sign in to your organization’s workspace."}
            </p>
          </div>
          {error && <Notice>{error}</Notice>}
          <form onSubmit={submit} className="form-stack">
            {signup && (
              <div className="field">
                <label htmlFor="name">Full name</label>
                <input
                  className="input"
                  id="name"
                  name="name"
                  autoComplete="name"
                  placeholder="Your full name"
                  required
                  maxLength={100}
                />
              </div>
            )}
            <div className="field">
              <label htmlFor="email">Work email</label>
              <input
                className="input"
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                maxLength={254}
              />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                className="input"
                id="password"
                name="password"
                type="password"
                autoComplete={signup ? "new-password" : "current-password"}
                placeholder={
                  signup ? "At least 12 characters" : "Enter your password"
                }
                required
                minLength={signup ? 12 : undefined}
                maxLength={128}
              />
              {signup && (
                <span className="field-help">
                  Use at least 12 characters and a unique password.
                </span>
              )}
            </div>
            <Button type="submit" loading={busy}>
              {signup ? "Create account" : "Sign in"}
            </Button>
          </form>
          <p className="auth-footnote">
            {signup ? "Already have an account? " : "New to Industrial OS? "}
            <Link className="text-link" href={signup ? "/login" : "/signup"}>
              {signup ? "Sign in" : "Create an account"}
            </Link>
          </p>
          <div className="auth-legal auth-divider">
            Access is restricted to authorized organization members.
            <br />
            Your documents are private and processed only with your permission.
          </div>
        </div>
      </main>
    </div>
  );
}
