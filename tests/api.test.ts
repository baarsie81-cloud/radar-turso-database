import { describe, expect, it } from "vitest";
import { createApiApp } from "../src/api/app";
import { createTursoClient } from "../src/db/client";
import { migrate } from "../src/db/migrate";
import { storeDecision } from "../src/db/repositories/decisions";
import { upsertSnapshot } from "../src/db/repositories/snapshots";
import { storeSocialCall } from "../src/db/repositories/socialCalls";
import { createTokenCase } from "../src/db/repositories/tokenCases";

async function setupApp() {
  const client = await createTursoClient({ url: ":memory:" });
  await migrate(client);
  const now = 1_700_000_000_000;

  const openPlus10 = await createTokenCase(client, {
    mint: "MintA",
    firstSeenAt: now,
    entryPrice: 100,
    entryValid: true,
    stage: "PLUS_10",
    caseStatus: "OPEN",
  });
  await createTokenCase(client, {
    mint: "MintB",
    firstSeenAt: now + 1,
    stage: "PLUS_10",
    caseStatus: "CLOSED",
  });

  await upsertSnapshot(client, {
    tokenCaseId: openPlus10.id,
    stage: "INITIAL",
    capturedAt: now,
    price: 100,
  });
  await upsertSnapshot(client, {
    tokenCaseId: openPlus10.id,
    stage: "PLUS_10",
    capturedAt: now + 10 * 60_000,
    price: 130,
  });
  await storeDecision(client, {
    tokenCaseId: openPlus10.id,
    decisionStage: "PLUS_10",
    decidedAt: now + 10 * 60_000,
    decisionStatus: "PASS",
    radarVersion: "2.4",
    entryPrice: 100,
    plus5RoiPct: 20,
    plus10RoiPct: 30,
    momentum5To10Pct: 10,
    inputsJson: JSON.stringify({ plus10RoiPct: 30 }),
  });
  await storeSocialCall(client, {
    source: "twitter",
    externalId: "tweet-1",
    calledAt: now,
    tokenCaseId: openPlus10.id,
    mint: "MintA",
  });

  return { app: createApiApp(client), openPlus10 };
}

describe("read API", () => {
  it("returns health", async () => {
    const { app } = await setupApp();
    const response = await app.request("/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("lists cases with optional filters", async () => {
    const { app } = await setupApp();

    const all = await app.request("/cases");
    expect(all.status).toBe(200);
    expect(await all.json()).toHaveLength(2);

    const open = await app.request("/cases?case_status=OPEN");
    const openBody = (await open.json()) as Array<{ mint: string }>;
    expect(open.status).toBe(200);
    expect(openBody.map((row) => row.mint)).toEqual(["MintA"]);

    const mintA = await app.request("/cases?mint=MintA&stage=PLUS_10");
    const mintABody = (await mintA.json()) as Array<{ mint: string }>;
    expect(mintABody).toHaveLength(1);

    const invalid = await app.request("/cases?case_status=NOPE");
    expect(invalid.status).toBe(400);
  });

  it("returns a case summary by id", async () => {
    const { app, openPlus10 } = await setupApp();
    const response = await app.request(`/cases/${openPlus10.id}`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      tokenCase: { mint: string };
      snapshots: unknown[];
      decisions: unknown[];
      socialCalls: unknown[];
    };
    expect(body.tokenCase.mint).toBe("MintA");
    expect(body.snapshots).toHaveLength(2);
    expect(body.decisions).toHaveLength(1);
    expect(body.socialCalls).toHaveLength(1);

    const missing = await app.request("/cases/99");
    expect(missing.status).toBe(404);

    const badId = await app.request("/cases/abc");
    expect(badId.status).toBe(400);
  });

  it("returns decision replay by stage", async () => {
    const { app, openPlus10 } = await setupApp();
    const response = await app.request(
      `/cases/${openPlus10.id}/decisions/PLUS_10?radar_version=2.4`,
    );
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      decisionStatus: string;
      inputs: { plus10RoiPct: number };
      inputsError: string | null;
    };
    expect(body.decisionStatus).toBe("PASS");
    expect(body.inputs.plus10RoiPct).toBe(30);
    expect(body.inputsError).toBeNull();

    const missing = await app.request(`/cases/${openPlus10.id}/decisions/PLUS_5`);
    expect(missing.status).toBe(404);

    const badStage = await app.request(`/cases/${openPlus10.id}/decisions/CLOSED`);
    expect(badStage.status).toBe(400);
  });
});
