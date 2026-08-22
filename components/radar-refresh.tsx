"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

/** Format a dashboard fetch timestamp for display. */
export function formatRadarFetchedAt(fetchedAt: number): string {
  if (!Number.isFinite(fetchedAt) || fetchedAt <= 0) {
    return "—";
  }
  return new Date(fetchedAt).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  });
}

type Props = {
  /** Epoch ms when the server fetched dashboard data. */
  fetchedAt: number;
};

/**
 * Shows when /radar data was fetched and offers a manual refresh.
 * No polling — calls Next.js router.refresh() only.
 */
export function RadarRefreshBar({ fetchedAt }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div
      data-testid="radar-refresh"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "0.75rem",
        marginTop: "0.75rem",
        marginBottom: "0.25rem",
        fontSize: "0.9rem",
        color: "#555",
      }}
    >
      <p style={{ margin: 0 }} data-testid="radar-last-updated">
        Last updated:{" "}
        <strong style={{ color: "#222", fontWeight: 600 }}>
          {formatRadarFetchedAt(fetchedAt)}
        </strong>
      </p>
      <button
        type="button"
        data-testid="radar-refresh-button"
        disabled={pending}
        onClick={() => {
          startTransition(() => {
            router.refresh();
          });
        }}
        style={{
          padding: "0.3rem 0.65rem",
          fontSize: "0.85rem",
          border: "1px solid #bbb",
          borderRadius: "3px",
          background: "#fff",
          cursor: pending ? "default" : "pointer",
        }}
      >
        {pending ? "Refreshing…" : "Refresh"}
      </button>
    </div>
  );
}
