"use client";

import { useEffect } from "react";

// This replaces the root layout when a render error escapes it, so it gets no
// global styles, fonts, or theme — everything here is inline and self-contained.
export default function GlobalError({
  error,
  retry,
  reset,
}: {
  error: Error & { digest?: string };
  retry?: () => void;
  reset?: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const recover = retry ?? reset ?? (() => window.location.reload());

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          background: "#fff",
          color: "#111",
        }}
      >
        <div style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 8px" }}>
            We&apos;re having trouble
          </h1>
          <p style={{ fontSize: 14, color: "#555", margin: "0 0 20px" }}>
            Something went wrong while loading the page. This is usually
            temporary — please try again.
          </p>
          <button
            type="button"
            onClick={() => recover()}
            style={{
              padding: "8px 16px",
              fontSize: 14,
              fontWeight: 500,
              borderRadius: 8,
              border: "none",
              background: "#111",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
