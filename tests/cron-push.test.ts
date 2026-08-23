import { afterEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@libsql/client";
import { handlePushCron } from "../src/push/cronPush";
import type { PushDeliverySummary } from "../src/push/types";

const SECRET = "test-cron-secret";

function authRequest(secret: string = SECRET): Request {
  return new Request("http://localhost/api/cron/push", {
    method: "GET",
    headers: { authorization: `Bearer ${secret}` },
  });
}

function bareRequest(): Request {
  return new Request("http://localhost/api/cron/push", { method: "GET" });
}

const emptySummary: PushDeliverySummary = {
  candidates: 2,
  delivered: 1,
  skipped: 1,
  errors: [{ decisionId: 9, message: "send failed" }],
  unknown: [],
};

describe("GET /api/cron/push", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects unauthorized requests", async () => {
    const processPushDeliveriesWithWebPushFn = vi.fn(async () => emptySummary);

    const missing = await handlePushCron(bareRequest(), {
      env: {
        CRON_SECRET: SECRET,
        RADAR24_PUSH_ENABLED: "true",
        TURSO_DATABASE_URL: "libsql://test",
      },
      processPushDeliveriesWithWebPushFn,
    });
    expect(missing.status).toBe(401);
    expect(await missing.json()).toEqual({ error: "Unauthorized" });

    const wrong = await handlePushCron(authRequest("wrong"), {
      env: {
        CRON_SECRET: SECRET,
        RADAR24_PUSH_ENABLED: "true",
        TURSO_DATABASE_URL: "libsql://test",
      },
      processPushDeliveriesWithWebPushFn,
    });
    expect(wrong.status).toBe(401);
    expect(processPushDeliveriesWithWebPushFn).not.toHaveBeenCalled();
  });

  it("rejects when CRON_SECRET is not configured", async () => {
    const processPushDeliveriesWithWebPushFn = vi.fn(async () => emptySummary);
    const response = await handlePushCron(authRequest(), {
      env: {
        CRON_SECRET: "",
        RADAR24_PUSH_ENABLED: "true",
        TURSO_DATABASE_URL: "libsql://test",
      },
      processPushDeliveriesWithWebPushFn,
    });

    expect(response.status).toBe(401);
    expect(processPushDeliveriesWithWebPushFn).not.toHaveBeenCalled();
  });

  it("disabled push does not send", async () => {
    const processPushDeliveriesWithWebPushFn = vi.fn(async () => emptySummary);
    const createClient = vi.fn(async () => {
      throw new Error("should not create client when disabled");
    });

    const response = await handlePushCron(authRequest(), {
      env: {
        CRON_SECRET: SECRET,
        RADAR24_PUSH_ENABLED: "false",
        TURSO_DATABASE_URL: "libsql://test",
      },
      createClient,
      processPushDeliveriesWithWebPushFn,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      enabled: false,
      message: "push disabled",
    });
    expect(createClient).not.toHaveBeenCalled();
    expect(processPushDeliveriesWithWebPushFn).not.toHaveBeenCalled();
  });

  it("treats unset RADAR24_PUSH_ENABLED as disabled", async () => {
    const processPushDeliveriesWithWebPushFn = vi.fn(async () => emptySummary);
    const response = await handlePushCron(authRequest(), {
      env: {
        CRON_SECRET: SECRET,
        TURSO_DATABASE_URL: "libsql://test",
      },
      processPushDeliveriesWithWebPushFn,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ enabled: false });
    expect(processPushDeliveriesWithWebPushFn).not.toHaveBeenCalled();
  });

  it("enabled push calls processPushDeliveriesWithWebPush and returns summary", async () => {
    const processPushDeliveriesWithWebPushFn = vi.fn(async () => emptySummary);
    const close = vi.fn();
    const fakeClient = { close } as unknown as Client;
    const createClient = vi.fn(async () => fakeClient);

    const response = await handlePushCron(authRequest(), {
      env: {
        CRON_SECRET: SECRET,
        RADAR24_PUSH_ENABLED: "true",
        TURSO_DATABASE_URL: "libsql://test",
        VAPID_PUBLIC_KEY: "pub",
        VAPID_PRIVATE_KEY: "priv",
        VAPID_SUBJECT: "mailto:test@example.com",
      },
      createClient,
      processPushDeliveriesWithWebPushFn,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      enabled: true,
      candidates: 2,
      sent: 1,
      failed: 1,
      skipped: 1,
      unknown: 0,
      errors: [{ decisionId: 9, message: "send failed" }],
      unknownErrors: [],
    });

    expect(createClient).toHaveBeenCalledOnce();
    expect(processPushDeliveriesWithWebPushFn).toHaveBeenCalledOnce();
    expect(processPushDeliveriesWithWebPushFn).toHaveBeenCalledWith(
      expect.objectContaining({
        client: fakeClient,
        env: {
          VAPID_PUBLIC_KEY: "pub",
          VAPID_PRIVATE_KEY: "priv",
          VAPID_SUBJECT: "mailto:test@example.com",
        },
      }),
    );
    expect(close).toHaveBeenCalledOnce();
  });
});
