import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Client } from "@libsql/client";
import { createTursoClient } from "../src/db/client";
import { migrate } from "../src/db/migrate";
import { storeDecision } from "../src/db/repositories/decisions";
import {
  getPushSubscriptions,
  hasPushDelivery,
} from "../src/db/repositories/push";
import { createTokenCase } from "../src/db/repositories/tokenCases";
import { handlePushSubscribe } from "../src/push";
import {
  buildPassPushPayload,
  createWebPushSender,
  parseBrowserPushSubscription,
  processPushDeliveries,
  processPushDeliveriesWithWebPush,
  readVapidConfig,
  savePushSubscription,
  selectPassPushCandidates,
  toServiceWorkerPushData,
  VapidConfigError,
} from "../src/push";
import type { PushPayload, WebPushTransport } from "../src/push";

const BASE = 1_700_000_000_000;
const MINT = "SoMintWebPush111111111111111111111111111";

async function setup() {
  const client = await createTursoClient({ url: ":memory:" });
  await migrate(client);
  return client;
}

async function seedPassDecision(client: Awaited<ReturnType<typeof setup>>) {
  const tokenCase = await createTokenCase(client, {
    mint: MINT,
    symbol: "WEB",
    name: "Web Push Token",
    firstSeenAt: BASE,
    entryPrice: 0.001,
    entryValid: true,
    stage: "PLUS_10",
    caseStatus: "OPEN",
    createdAt: BASE,
  });
  const decision = await storeDecision(client, {
    tokenCaseId: tokenCase.id,
    decisionStage: "PLUS_10",
    decidedAt: BASE + 600_000,
    decisionStatus: "PASS",
    plus10RoiPct: 30,
    momentum5To10Pct: 10,
    inputsJson: JSON.stringify({ plus10RoiPct: 30 }),
  });
  return { tokenCase, decision };
}

const VAPID = {
  VAPID_PUBLIC_KEY: "public-test-key",
  VAPID_PRIVATE_KEY: "private-test-key",
  VAPID_SUBJECT: "mailto:test@example.com",
};

describe("Web Push transport foundation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("missing VAPID config fails safely", async () => {
    expect(readVapidConfig({})).toBeNull();
    expect(
      readVapidConfig({
        VAPID_PUBLIC_KEY: "only-public",
      }),
    ).toBeNull();

    const sender = createWebPushSender({
      getSubscriptions: async () => [],
      env: {},
    });

    await expect(
      sender({
        title: "Radar V24 Signal",
        body: "test",
        url: "/cases/1",
        mint: MINT,
        decisionId: 1,
        tokenCaseId: 1,
        decisionStatus: "PASS",
        decisionStage: "PLUS_10",
        plus10RoiPct: 30,
        momentum5To10Pct: 10,
        symbol: "WEB",
      }),
    ).rejects.toBeInstanceOf(VapidConfigError);
  });

  it("valid payload sends through injected sender", async () => {
    const client = await setup();
    const { tokenCase } = await seedPassDecision(client);
    await savePushSubscription(client, {
      endpoint: "https://push.example/endpoint-a",
      p256dh: "p256",
      auth: "auth",
    });

    const sendNotification = vi.fn(async () => undefined);
    const transport: WebPushTransport = {
      sendNotification,
      setVapidDetails: vi.fn(),
    };

    const sendPush = createWebPushSender({
      getSubscriptions: () => getPushSubscriptions(client),
      env: VAPID,
      transport,
    });

    const [candidate] = await selectPassPushCandidates(client);
    const payload = buildPassPushPayload(candidate!);
    await sendPush(payload);

    expect(transport.setVapidDetails).toHaveBeenCalledWith(
      VAPID.VAPID_SUBJECT,
      VAPID.VAPID_PUBLIC_KEY,
      VAPID.VAPID_PRIVATE_KEY,
    );
    expect(sendNotification).toHaveBeenCalledOnce();
    const call = sendNotification.mock.calls[0] as unknown as [
      unknown,
      string,
    ];
    expect(JSON.parse(call[1])).toEqual({
      title: "Radar V24 Signal",
      body: payload.body,
      url: `/cases/${tokenCase.id}`,
      mint: MINT,
    });
  });

  it("subscription save works and dedupes by endpoint", async () => {
    const client = await setup();

    const first = await savePushSubscription(client, {
      endpoint: "https://push.example/a",
      p256dh: "p256-1",
      auth: "auth-1",
      userAgent: "Agent/1",
    });
    const second = await savePushSubscription(client, {
      endpoint: "https://push.example/a",
      p256dh: "p256-2",
      auth: "auth-2",
      userAgent: "Agent/2",
    });

    expect(first.endpoint).toBe(second.endpoint);
    expect(second.p256dh).toBe("p256-2");
    expect(second.auth).toBe("auth-2");

    const listed = await getPushSubscriptions(client);
    expect(listed).toHaveLength(1);
  });

  it("subscribe route stores browser PushSubscription JSON", async () => {
    const client = await setup();
    const close = vi.fn();
    const fakeClient = Object.assign(client, { close }) as Client;

    const response = await handlePushSubscribe(
      new Request("http://localhost/api/push/subscribe", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "TestBrowser/1",
        },
        body: JSON.stringify({
          endpoint: "https://push.example/browser",
          keys: {
            p256dh: "browser-p256",
            auth: "browser-auth",
          },
        }),
      }),
      {
        createClient: async () => fakeClient,
      },
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toMatchObject({
      ok: true,
      endpoint: "https://push.example/browser",
    });

    const listed = await getPushSubscriptions(client);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.p256dh).toBe("browser-p256");
    expect(listed[0]?.auth).toBe("browser-auth");
    expect(listed[0]?.userAgent).toBe("TestBrowser/1");
    expect(close).toHaveBeenCalledOnce();
  });

  it("duplicate subscription handling via subscribe route", async () => {
    const client = await setup();
    const close = vi.fn();
    const fakeClient = Object.assign(client, { close }) as Client;
    const createClient = async () => fakeClient;

    const body = JSON.stringify({
      endpoint: "https://push.example/dup",
      keys: { p256dh: "k1", auth: "a1" },
    });

    await handlePushSubscribe(
      new Request("http://localhost/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      }),
      { createClient },
    );

    const second = await handlePushSubscribe(
      new Request("http://localhost/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          endpoint: "https://push.example/dup",
          keys: { p256dh: "k2", auth: "a2" },
        }),
      }),
      { createClient },
    );

    expect(second.status).toBe(200);
    const listed = await getPushSubscriptions(client);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.p256dh).toBe("k2");
  });

  it("service worker payload format includes title body url mint", () => {
    const payload: PushPayload = {
      title: "Radar V24 Signal",
      body: "WEB · PASS · +10 ROI 30.00% · momentum 10.00%",
      url: "/cases/42",
      mint: MINT,
      decisionId: 7,
      tokenCaseId: 42,
      decisionStatus: "PASS",
      decisionStage: "PLUS_10",
      plus10RoiPct: 30,
      momentum5To10Pct: 10,
      symbol: "WEB",
    };

    expect(toServiceWorkerPushData(payload)).toEqual({
      title: "Radar V24 Signal",
      body: payload.body,
      url: "/cases/42",
      mint: MINT,
    });

    const swSource = readFileSync(
      join(process.cwd(), "public/sw.js"),
      "utf8",
    );
    expect(swSource).toContain("push");
    expect(swSource).toContain("notificationclick");
    expect(swSource).toContain("showNotification");
    expect(swSource).toContain("openWindow");
    expect(swSource).toContain("mint");
    expect(swSource).toContain("url");
  });

  it("processPushDeliveriesWithWebPush uses transport without real network", async () => {
    const client = await setup();
    const { decision, tokenCase } = await seedPassDecision(client);
    await savePushSubscription(client, {
      endpoint: "https://push.example/live",
      p256dh: "p256",
      auth: "auth",
    });

    const sendNotification = vi.fn(async () => undefined);
    const summary = await processPushDeliveriesWithWebPush({
      client,
      env: VAPID,
      transport: {
        sendNotification,
        setVapidDetails: vi.fn(),
      },
      now: () => BASE + 900_000,
    });

    expect(summary.delivered).toBe(1);
    expect(sendNotification).toHaveBeenCalledOnce();
    expect(await hasPushDelivery(client, decision.id)).toBe(true);

    const call = sendNotification.mock.calls[0] as unknown as [
      unknown,
      string,
    ];
    expect(JSON.parse(call[1]).url).toBe(`/cases/${tokenCase.id}`);
  });

  it("parseBrowserPushSubscription accepts flat and nested keys", () => {
    expect(
      parseBrowserPushSubscription({
        endpoint: "https://push.example/flat",
        p256dh: "p",
        auth: "a",
      }),
    ).toEqual({
      endpoint: "https://push.example/flat",
      p256dh: "p",
      auth: "a",
      userAgent: null,
    });

    expect(
      parseBrowserPushSubscription({
        endpoint: "https://push.example/nested",
        keys: { p256dh: "np", auth: "na" },
      }),
    ).toMatchObject({
      endpoint: "https://push.example/nested",
      p256dh: "np",
      auth: "na",
    });

    expect(parseBrowserPushSubscription({ endpoint: "x" })).toBeNull();
  });

  it("processPushDeliveries still accepts injected sendPush", async () => {
    const client = await setup();
    await seedPassDecision(client);
    const sendPush = vi.fn(async (_payload: PushPayload) => undefined);
    const summary = await processPushDeliveries({ client, sendPush });
    expect(summary.delivered).toBe(1);
    expect(sendPush).toHaveBeenCalledOnce();
  });
});
