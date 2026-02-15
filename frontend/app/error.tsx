"use client";

import Link from "next/link";
import { useEffect } from "react";

type ErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    console.error("Route error boundary caught an error:", error);
  }, [error]);

  return (
    <main className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] px-6 py-16">
      <div className="mx-auto max-w-2xl rounded-xl border border-white/10 bg-white/[0.03] p-8 shadow-lg">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--accent-primary)]">
          Application Error
        </p>
        <h1 className="mt-3 text-2xl font-bold">Unable to render this page</h1>
        <p className="mt-3 text-sm text-[var(--text-secondary)]">
          Prismarine hit an unexpected client/runtime error. Use retry first. If
          it persists, return to the homepage and hard refresh.
        </p>
        {error.digest ? (
          <p className="mt-2 text-xs text-[var(--text-tertiary)]">
            Error ID: {error.digest}
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex items-center justify-center rounded-md bg-gradient-to-r from-[#a855f7] to-[#ec4899] px-4 py-2 text-sm font-semibold text-white"
          >
            Retry
          </button>
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-white/20 bg-white/5 px-4 py-2 text-sm font-semibold text-[var(--text-secondary)]"
          >
            Go To Homepage
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center justify-center rounded-md border border-white/20 bg-white/5 px-4 py-2 text-sm font-semibold text-[var(--text-secondary)]"
          >
            Open Login
          </Link>
        </div>
      </div>
    </main>
  );
}
