import { describe, expect, it } from "vitest";
import { createTursoClient } from "../src/db/client";
import { migrate } from "../src/db/migrate";

describe("0001_init schema", () => {
  it("allows REJECT at PLUS_10 while the case stays OPEN", async () => {
    const client = await createTursoClient({ url: ":memory:" });
    await migrate(client);

    const now = Date.now();
    await client.execute({
      sql: `
        INSERT INTO token_cases (
          mint, first_seen_at, entry_price, entry_valid, stage, case_status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: ["SoMint1111111111111111111111111111111111111", now, 1.5, 1, "PLUS_10", "OPEN", now, now],
    });

    await client.execute({
      sql: `
        INSERT INTO decisions (
          token_case_id, decision_stage, decided_at, decision_status, reject_reason,
          radar_version, entry_price, plus5_roi_pct, plus10_roi_pct, momentum_5_to_10_pct, inputs_json
        ) VALUES (1, 'PLUS_10', ?, 'REJECT', 'NEGATIVE_MOMENTUM_5_TO_10', '2.4', 1.5, 40, 30, -10, ?)
      `,
      args: [now, JSON.stringify({ momentum5To10Pct: -10 })],
    });

    await client.execute({
      sql: `
        INSERT INTO snapshots (token_case_id, stage, captured_at, price, roi_pct)
        VALUES (1, 'PLUS_15', ?, 1.8, 20)
      `,
      args: [now],
    });

    await client.execute({
      sql: `UPDATE token_cases SET stage = 'PLUS_15', updated_at = ? WHERE id = 1`,
      args: [now],
    });

    const caseRow = await client.execute("SELECT case_status, stage FROM token_cases WHERE id = 1");
    const decisionRow = await client.execute(
      "SELECT decision_status, reject_reason FROM decisions WHERE token_case_id = 1",
    );

    expect(caseRow.rows[0]?.case_status).toBe("OPEN");
    expect(caseRow.rows[0]?.stage).toBe("PLUS_15");
    expect(decisionRow.rows[0]?.decision_status).toBe("REJECT");
    expect(decisionRow.rows[0]?.reject_reason).toBe("NEGATIVE_MOMENTUM_5_TO_10");

    await client.execute({
      sql: `UPDATE token_cases SET stage = 'CLOSED', case_status = 'CLOSED', updated_at = ? WHERE id = 1`,
      args: [now],
    });

    const closed = await client.execute("SELECT case_status, stage FROM token_cases WHERE id = 1");
    const stillRejected = await client.execute(
      "SELECT decision_status FROM decisions WHERE token_case_id = 1",
    );
    expect(closed.rows[0]?.case_status).toBe("CLOSED");
    expect(closed.rows[0]?.stage).toBe("CLOSED");
    expect(stillRejected.rows[0]?.decision_status).toBe("REJECT");
  });

  it("prevents duplicate social calls with the same source and external_id", async () => {
    const client = await createTursoClient({ url: ":memory:" });
    await migrate(client);
    const now = Date.now();

    const insert = {
      sql: `
        INSERT INTO social_calls (
          source, external_id, called_at, mint, collapse_before, collapse_after, collapse_window_minutes, created_at
        ) VALUES ('twitter', 'tweet-1', ?, 'SoMint', 1, 0, 15, ?)
      `,
      args: [now, now],
    };

    await client.execute(insert);
    await expect(client.execute(insert)).rejects.toThrow();
  });
});
