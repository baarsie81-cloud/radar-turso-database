"use client";

import Link from "next/link";
import { useState } from "react";

export type BaseRadarTableRow = {
  id: number;
  symbol: string | null;
  tokenAddress: string | null;
  poolAddress: string;
  firstSeenAt: number;
  entryLiquidityUsd: number;
  plus5RoiPct: number | null;
  plus10RoiPct: number | null;
  momentum: number | null;
  plus10LiquidityUsd: number | null;
  decision: string | null;
  rejectReason: string | null;
};

function pct(value: number | null): string {
  return value == null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function shortAddress(address: string): string {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

export function BaseRadarTable({ rows }: { rows: BaseRadarTableRow[] }) {
  const [copiedId, setCopiedId] = useState<number | null>(null);

  async function copyAddress(id: number, address: string) {
    await navigator.clipboard.writeText(address);
    setCopiedId(id);
    window.setTimeout(() => setCopiedId((current) => current === id ? null : current), 1200);
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.9rem" }}>
        <thead>
          <tr>
            {['Coin','Token address','Seen','Entry liq','+5','+10','Momentum','+10 liq','Decision'].map((label) => (
              <th key={label} style={{ textAlign: "left", padding: "0.55rem", borderBottom: "1px solid #ddd" }}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td style={{ padding: "0.55rem", borderBottom: "1px solid #eee" }}>
                <Link href={`/base-cases/${row.id}`} style={{ color: "#111", fontWeight: 600, textDecoration: "underline" }}>
                  {row.symbol ?? row.poolAddress.slice(0, 10)}
                </Link>
              </td>
              <td style={{ padding: "0.55rem", borderBottom: "1px solid #eee" }}>
                {row.tokenAddress ? (
                  <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                    <code title={row.tokenAddress}>{shortAddress(row.tokenAddress)}</code>
                    <button
                      type="button"
                      onClick={() => copyAddress(row.id, row.tokenAddress!)}
                      style={{ padding: "0.2rem 0.45rem", cursor: "pointer" }}
                      aria-label={`Copy token address for ${row.symbol ?? `case ${row.id}`}`}
                    >
                      {copiedId === row.id ? "Copied" : "Copy"}
                    </button>
                  </div>
                ) : 'pending'}
              </td>
              <td style={{ padding: "0.55rem", borderBottom: "1px solid #eee" }}>{new Date(row.firstSeenAt).toLocaleString()}</td>
              <td style={{ padding: "0.55rem", borderBottom: "1px solid #eee" }}>${Math.round(row.entryLiquidityUsd).toLocaleString()}</td>
              <td style={{ padding: "0.55rem", borderBottom: "1px solid #eee" }}>{pct(row.plus5RoiPct)}</td>
              <td style={{ padding: "0.55rem", borderBottom: "1px solid #eee" }}>{pct(row.plus10RoiPct)}</td>
              <td style={{ padding: "0.55rem", borderBottom: "1px solid #eee" }}>{pct(row.momentum)}</td>
              <td style={{ padding: "0.55rem", borderBottom: "1px solid #eee" }}>{row.plus10LiquidityUsd == null ? '—' : `$${Math.round(row.plus10LiquidityUsd).toLocaleString()}`}</td>
              <td style={{ padding: "0.55rem", borderBottom: "1px solid #eee" }} title={row.rejectReason ?? undefined}>{row.decision ?? 'PENDING'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
