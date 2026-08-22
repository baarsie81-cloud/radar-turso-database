"use client";

import { useState } from "react";

type Props = {
  mint: string;
};

/** Selectable mint address with one-click copy for operational use. */
export function MintAddressField({ mint }: Props) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(mint);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "0.5rem",
      }}
    >
      <code
        data-testid="mint-address-value"
        style={{
          display: "inline-block",
          maxWidth: "100%",
          padding: "0.35rem 0.5rem",
          background: "#f4f4f4",
          border: "1px solid #ddd",
          borderRadius: "3px",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: "0.85rem",
          wordBreak: "break-all",
          userSelect: "all",
        }}
      >
        {mint}
      </code>
      <button
        type="button"
        onClick={() => {
          void handleCopy();
        }}
        style={{
          padding: "0.3rem 0.65rem",
          fontSize: "0.8rem",
          border: "1px solid #bbb",
          borderRadius: "3px",
          background: "#fff",
          cursor: "pointer",
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
