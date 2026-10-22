"use client";
import { Button, Notice } from "@/components/ui";
export default function ErrorPage({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <main className="standalone">
      <div className="auth-card">
        <h1>Something went wrong</h1>
        <Notice>We could not load this page. Your saved work is safe.</Notice>
        <Button onClick={reset}>Try again</Button>
      </div>
    </main>
  );
}
