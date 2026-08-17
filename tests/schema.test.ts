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

  it("adds nullable outcome columns and only allows labels on CLOSED cases", async () => {
    const client = await createTursoClient({ url: ":memory:" });
    const ran = await migrate(client);
    expect(ran).toContain("0002_outcome_label");

    const now = Date.now();
    await client.execute({
      sql: `
        INSERT INTO token_cases (
          mint, first_seen_at, entry_price, entry_valid, stage, case_status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: ["SoMint", now, 1.5, 1, "PLUS_60", "OPEN", now, now],
    });

    const unlabeled = await client.execute(
      "SELECT outcome_label, outcome_labeled_at, outcome_inputs_json FROM token_cases WHERE id = 1",
    );
    expect(unlabeled.rows[0]?.outcome_label).toBeNull();
    expect(unlabeled.rows[0]?.outcome_labeled_at).toBeNull();
    expect(unlabeled.rows[0]?.outcome_inputs_json).toBeNull();

    await expect(
      client.execute({
        sql: `UPDATE token_cases SET outcome_label = 'RUNNER' WHERE id = 1`,
        args: [],
      }),
    ).rejects.toThrow();

    await client.execute({
      sql: `
        UPDATE token_cases
        SET case_status = 'CLOSED', stage = 'CLOSED', outcome_label = 'SMALL_WIN',
            outcome_labeled_at = ?, outcome_inputs_json = ?
        WHERE id = 1
      `,
      args: [now, JSON.stringify({ peakRoiPct: 40 })],
    });

    const labeled = await client.execute(
      "SELECT case_status, outcome_label FROM token_cases WHERE id = 1",
    );
    expect(labeled.rows[0]?.case_status).toBe("CLOSED");
    expect(labeled.rows[0]?.outcome_label).toBe("SMALL_WIN");

    await expect(
      client.execute("UPDATE token_cases SET outcome_label = 'FAILED' WHERE id = 1"),
    ).rejects.toThrow();
  });

  it("adds push subscription and delivery tables", async () => {
    const client = await createTursoClient({ url: ":memory:" });
    const ran = await migrate(client);
    expect(ran).toContain("0003_push");

    const now = Date.now();
    await client.execute({
      sql: `
        INSERT INTO token_cases (
          mint, first_seen_at, stage, case_status, created_at, updated_at
        ) VALUES (?, ?, 'PLUS_10', 'OPEN', ?, ?)
      `,
      args: ["SoMint", now, now, now],
    });
    await client.execute({
      sql: `
        INSERT INTO decisions (
          token_case_id, decision_stage, decided_at, decision_status, radar_version, inputs_json
        ) VALUES (1, 'PLUS_10', ?, 'PASS', '2.4', ?)
      `,
      args: [now, JSON.stringify({ plus10RoiPct: 30 })],
    });

    await client.execute({
      sql: `
        INSERT INTO push_subscriptions (endpoint, p256dh, auth, created_at, updated_at)
        VALUES ('https://push.example/a', 'p256', 'auth', ?, ?)
      `,
      args: [now, now],
    });
    await expect(
      client.execute({
        sql: `
          INSERT INTO push_subscriptions (endpoint, p256dh, auth, created_at, updated_at)
          VALUES ('https://push.example/a', 'other', 'auth', ?, ?)
        `,
        args: [now, now],
      }),
    ).rejects.toThrow();

    await client.execute({
      sql: `
        INSERT INTO push_deliveries (decision_id, token_case_id, sent_at)
        VALUES (1, 1, ?)
      `,
      args: [now],
    });
    await expect(
      client.execute({
        sql: `
          INSERT INTO push_deliveries (decision_id, token_case_id, sent_at)
          VALUES (1, 1, ?)
        `,
        args: [now],
      }),
    ).rejects.toThrow();
  });
});
