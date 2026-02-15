"use client";

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
    <main
      style={{
        minHeight: "100vh",
        background: "#0a0a0a",
        color: "#f5f5f5",
        padding: "48px 24px",
      }}
    >
      <div
        style={{
          maxWidth: "640px",
          margin: "0 auto",
          border: "1px solid rgba(255,255,255,0.14)",
          borderRadius: "12px",
          padding: "24px",
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: "11px",
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: "#a855f7",
            fontWeight: 700,
          }}
        >
          Application Error
        </p>
        <h1 style={{ marginTop: "10px", marginBottom: 0, fontSize: "28px" }}>
          Unable to render this page
        </h1>
        <p style={{ marginTop: "12px", color: "#c4b5fd" }}>
          Prismarine hit an unexpected client/runtime error. Use retry first. If
          it persists, return to the homepage and hard refresh.
        </p>
        {error.digest ? (
          <p style={{ marginTop: "8px", color: "#a78bfa", fontSize: "12px" }}>
            Error ID: {error.digest}
          </p>
        ) : null}

        <div style={{ marginTop: "20px", display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              border: "none",
              borderRadius: "8px",
              background: "#a855f7",
              color: "#fff",
              padding: "10px 14px",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Retry
          </button>
          <a
            href="/"
            style={{
              textDecoration: "none",
              borderRadius: "8px",
              border: "1px solid rgba(255,255,255,0.2)",
              color: "#f5f5f5",
              padding: "10px 14px",
              fontWeight: 700,
            }}
          >
            Go To Homepage
          </a>
          <a
            href="/login"
            style={{
              textDecoration: "none",
              borderRadius: "8px",
              border: "1px solid rgba(255,255,255,0.2)",
              color: "#f5f5f5",
              padding: "10px 14px",
              fontWeight: 700,
            }}
          >
            Open Login
          </a>
        </div>
      </div>
    </main>
  );
}
