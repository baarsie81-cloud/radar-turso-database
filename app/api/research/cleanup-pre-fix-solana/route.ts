import { createTursoClient } from "../../../../src/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CLEAN_CUTOFF = 1787731063232; // 2026-08-26 09:57:43 Europe/Amsterdam

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const client = await createTursoClient();
  try {
    const before = await client.execute(`SELECT COUNT(*) AS n FROM solana_validated_cases`);

    const old = await client.execute({
      sql: `DELETE FROM solana_validated_cases WHERE first_seen_at < ?`,
      args: [CLEAN_CUTOFF],
    });

    const corrupt = await client.execute(`
      DELETE FROM solana_validated_cases
      WHERE id IN (
        SELECT c.id
        FROM solana_validated_cases c
        JOIN solana_validated_snapshots i ON i.case_id=c.id AND i.stage='INITIAL'
        LEFT JOIN solana_validated_snapshots p5 ON p5.case_id=c.id AND p5.stage='PLUS_5'
        LEFT JOIN solana_validated_snapshots p10 ON p10.case_id=c.id AND p10.stage='PLUS_10'
        WHERE
          (p5.captured_at IS NOT NULL AND p5.captured_at - i.captured_at < 240000)
          OR
          (p10.captured_at IS NOT NULL AND p10.captured_at - i.captured_at < 540000)
      )
    `);

    const after = await client.execute(`SELECT COUNT(*) AS n FROM solana_validated_cases`);
    return Response.json({
      ok: true,
      cutoff: CLEAN_CUTOFF,
      before: Number(before.rows[0]?.n ?? 0),
      deletedPreFix: old.rowsAffected,
      deletedTimingCorrupt: corrupt.rowsAffected,
      after: Number(after.rows[0]?.n ?? 0),
    });
  } finally {
    client.close();
  }
}
