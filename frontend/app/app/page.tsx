import Link from "next/link";

export default function LegacyAppPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        background: "#0a0a0a",
        color: "#f5f5f5",
        fontFamily:
          "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <section
        style={{
          width: "100%",
          maxWidth: "600px",
          textAlign: "center",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: "12px",
          padding: "32px 24px",
          background: "rgba(255,255,255,0.03)",
        }}
      >
        <h1 style={{ margin: 0, fontSize: "2rem", fontWeight: 700 }}>
          Prismarine
        </h1>
        <p style={{ marginTop: "12px", color: "#c4b5fd" }}>
          This legacy `/app` route no longer auto-redirects.
        </p>
        <p style={{ marginTop: "6px", color: "#a78bfa", fontSize: "14px" }}>
          Use the links below to continue.
        </p>
        <div
          style={{
            marginTop: "20px",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}
        >
          <Link
            href="/"
            style={{
              display: "inline-block",
              textDecoration: "none",
              border: "1px solid #404040",
              color: "#f5f5f5",
              padding: "10px 16px",
              borderRadius: "8px",
              fontWeight: 600,
            }}
          >
            Go To Landing Page
          </Link>
          <Link
            href="/login"
            style={{
              display: "inline-block",
              textDecoration: "none",
              background: "#a855f7",
              color: "#ffffff",
              padding: "10px 16px",
              borderRadius: "8px",
              fontWeight: 600,
            }}
          >
            Go To Login
          </Link>
          <Link
            href="/graph"
            style={{
              display: "inline-block",
              textDecoration: "none",
              border: "1px solid #404040",
              color: "#f5f5f5",
              padding: "10px 16px",
              borderRadius: "8px",
              fontWeight: 600,
            }}
          >
            Open Graph
          </Link>
        </div>
      </section>
    </main>
  );
}
