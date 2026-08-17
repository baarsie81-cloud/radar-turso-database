import { describe, expect, it } from "vitest";
import { createApiApp } from "../src/api/app";
import { createTursoClient } from "../src/db/client";
import { migrate } from "../src/db/migrate";
import { storeDecision } from "../src/db/repositories/decisions";
import {
  createPushDelivery,
  deletePushSubscription,
  getPushSubscriptions,
  hasPushDelivery,
  upsertPushSubscription,
} from "../src/db/repositories/push";
import { createTokenCase } from "../src/db/repositories/tokenCases";

const SECRET = "radar-api-secret";

async function setup() {
  const client = await createTursoClient({ url: ":memory:" });
  await migrate(client);
  return client;
}

async function seedDecision(client: Awaited<ReturnType<typeof setup>>, mint = "MintPush") {
  const now = 1_700_000_000_000;
  const tokenCase = await createTokenCase(client, {
    mint,
    firstSeenAt: now,
    stage: "PLUS_10",
    caseStatus: "OPEN",
  });
  const decision = await storeDecision(client, {
    tokenCaseId: tokenCase.id,
    decisionStage: "PLUS_10",
    decidedAt: now + 10 * 60_000,
    decisionStatus: "PASS",
    inputsJson: JSON.stringify({ plus10RoiPct: 30 }),
  });
  return { tokenCase, decision };
}

function authHeaders(secret = SECRET): HeadersInit {
  return {
    authorization: `Bearer ${secret}`,
    "content-type": "application/json",
  };
}

describe("push repository", () => {
  it("upserts a subscription and updates keys without duplicating the endpoint", async () => {
    const client = await setup();

    const first = await upsertPushSubscription(client, {
      endpoint: "https://push.example/a",
      p256dh: "p256-1",
      auth: "auth-1",
      userAgent: "Phone/1",
      createdAt: 100,
      updatedAt: 100,
    });
    expect(first.endpoint).toBe("https://push.example/a");
    expect(first.lastSuccessAt).toBeNull();

    const second = await upsertPushSubscription(client, {
      endpoint: "https://push.example/a",
      p256dh: "p256-2",
      auth: "auth-2",
      userAgent: "Phone/2",
      createdAt: 999,
      updatedAt: 200,
    });

    expect(second.p256dh).toBe("p256-2");
    expect(second.auth).toBe("auth-2");
    expect(second.userAgent).toBe("Phone/2");
    expect(second.createdAt).toBe(100);
    expect(second.updatedAt).toBe(200);

    const listed = await getPushSubscriptions(client);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.p256dh).toBe("p256-2");
  });

  it("deletes a subscription by endpoint", async () => {
    const client = await setup();
    await upsertPushSubscription(client, {
      endpoint: "https://push.example/a",
      p256dh: "p256",
      auth: "auth",
    });
    await upsertPushSubscription(client, {
      endpoint: "https://push.example/b",
      p256dh: "p256",
      auth: "auth",
    });

    expect(await deletePushSubscription(client, "https://push.example/a")).toBe(true);
    expect(await deletePushSubscription(client, "https://push.example/a")).toBe(false);

    const remaining = await getPushSubscriptions(client);
    expect(remaining.map((row) => row.endpoint)).toEqual(["https://push.example/b"]);
  });

  it("prevents duplicate deliveries for the same decision", async () => {
    const client = await setup();
    const { tokenCase, decision } = await seedDecision(client);

    expect(await hasPushDelivery(client, decision.id)).toBe(false);

    const first = await createPushDelivery(client, {
      decisionId: decision.id,
      tokenCaseId: tokenCase.id,
      sentAt: 1_700_000_100_000,
    });
    expect(first.decisionId).toBe(decision.id);
    expect(first.sentAt).toBe(1_700_000_100_000);
    expect(await hasPushDelivery(client, decision.id)).toBe(true);

    const second = await createPushDelivery(client, {
      decisionId: decision.id,
      tokenCaseId: tokenCase.id,
      sentAt: 1_700_000_200_000,
    });
    expect(second.sentAt).toBe(first.sentAt);
    expect(second.tokenCaseId).toBe(tokenCase.id);

    const count = await client.execute({
      sql: "SELECT COUNT(*) AS n FROM push_deliveries WHERE decision_id = ?",
      args: [decision.id],
    });
    expect(Number(count.rows[0]?.n)).toBe(1);
  });
});

describe("push API", () => {
  it("rejects unauthorized push writes and keeps GET /cases open", async () => {
    const client = await setup();
    const app = createApiApp(client, { radarApiSecret: SECRET });
    const body = JSON.stringify({
      endpoint: "https://push.example/a",
      p256dh: "p256",
      auth: "auth",
    });

    const missing = await app.request("/push/subscriptions", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body,
    });
    expect(missing.status).toBe(401);

    const wrong = await app.request("/push/subscriptions", {
      method: "PUT",
      headers: authHeaders("nope"),
      body,
    });
    expect(wrong.status).toBe(401);

    const unconfigured = createApiApp(client);
    const noSecret = await unconfigured.request("/push/subscriptions", {
      method: "PUT",
      headers: authHeaders(),
      body,
    });
    expect(noSecret.status).toBe(401);

    const del = await app.request("/push/subscriptions", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint: "https://push.example/a" }),
    });
    expect(del.status).toBe(401);

    const cases = await app.request("/cases");
    expect(cases.status).toBe(200);

    const getSubscriptions = await app.request("/push/subscriptions");
    expect(getSubscriptions.status).toBe(401);
  });

  it("upserts and deletes a subscription with valid authorization", async () => {
    const client = await setup();
    const app = createApiApp(client, { radarApiSecret: SECRET });

    const created = await app.request("/push/subscriptions", {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({
        endpoint: "https://push.example/a",
        p256dh: "p256-1",
        auth: "auth-1",
        userAgent: "Phone/1",
      }),
    });
    expect(created.status).toBe(200);
    expect(await created.json()).toMatchObject({
      endpoint: "https://push.example/a",
      p256dh: "p256-1",
      auth: "auth-1",
      userAgent: "Phone/1",
      lastSuccessAt: null,
    });

    const updated = await app.request("/push/subscriptions", {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({
        endpoint: "https://push.example/a",
        p256dh: "p256-2",
        auth: "auth-2",
      }),
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      endpoint: "https://push.example/a",
      p256dh: "p256-2",
      auth: "auth-2",
    });

    const listed = await getPushSubscriptions(client);
    expect(listed).toHaveLength(1);

    const missingBody = await app.request("/push/subscriptions", {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ endpoint: "https://push.example/a" }),
    });
    expect(missingBody.status).toBe(400);

    const deleted = await app.request("/push/subscriptions", {
      method: "DELETE",
      headers: authHeaders(),
      body: JSON.stringify({ endpoint: "https://push.example/a" }),
    });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ ok: true });

    const missing = await app.request("/push/subscriptions", {
      method: "DELETE",
      headers: authHeaders(),
      body: JSON.stringify({ endpoint: "https://push.example/a" }),
    });
    expect(missing.status).toBe(404);
    expect(await getPushSubscriptions(client)).toEqual([]);
  });

  it("lists subscriptions and records deliveries with valid authorization", async () => {
    const client = await setup();
    const app = createApiApp(client, { radarApiSecret: SECRET });
    const { tokenCase, decision } = await seedDecision(client);

    await app.request("/push/subscriptions", {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({
        endpoint: "https://push.example/a",
        p256dh: "p256",
        auth: "auth",
      }),
    });

    const listed = await app.request("/push/subscriptions", { headers: authHeaders() });
    expect(listed.status).toBe(200);
    expect(await listed.json()).toMatchObject([{ endpoint: "https://push.example/a", p256dh: "p256" }]);

    const missing = await app.request(`/push/deliveries/${decision.id}`, { headers: authHeaders() });
    expect(missing.status).toBe(200);
    expect(await missing.json()).toEqual({ delivered: false });

    const created = await app.request("/push/deliveries", {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ decisionId: decision.id, tokenCaseId: tokenCase.id }),
    });
    expect(created.status).toBe(200);
    expect(await created.json()).toMatchObject({ decisionId: decision.id, tokenCaseId: tokenCase.id });

    const present = await app.request(`/push/deliveries/${decision.id}`, { headers: authHeaders() });
    expect(await present.json()).toEqual({ delivered: true });

    const unauthorized = await app.request(`/push/deliveries/${decision.id}`);
    expect(unauthorized.status).toBe(401);
  });
});
