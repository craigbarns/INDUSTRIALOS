import Link from "next/link";
export default function NotFound() {
  return (
    <main className="standalone">
      <div className="auth-card">
        <div className="eyebrow">INDUSTRIAL OS · 404</div>
        <h1>Page not found</h1>
        <p>This page may have moved, or you may not have access.</p>
        <Link className="button button-primary" href="/">
          Return to workspace
        </Link>
      </div>
    </main>
  );
}
