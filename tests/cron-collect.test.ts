import { afterEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@libsql/client";
import { handleCollectCron } from "../src/collector/cronCollect";
import type { CollectionSummary } from "../src/collector/run";

const SECRET = "test-cron-secret";

function authRequest(secret: string = SECRET): Request {
  return new Request("http://localhost/api/cron/collect", {
    method: "GET",
    headers: { authorization: `Bearer ${secret}` },
  });
}

function bareRequest(): Request {
  return new Request("http://localhost/api/cron/collect", { method: "GET" });
}

const emptySummary: CollectionSummary = {
  offered: 3,
  discovered: 1,
  skipped: 2,
  jobsProcessed: 3,
  snapshotsWritten: 3,
  decisionsCreated: 1,
  casesClosed: 0,
  errors: [],
};

describe("GET /api/cron/collect", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects unauthorized requests", async () => {
    const discoverTokens = vi.fn(async () => []);
    const fetchMarket = vi.fn(async () => ({
      price: 1,
      capturedAt: Date.now(),
    }));
    const runCollectionFn = vi.fn(async () => emptySummary);

    const missing = await handleCollectCron(bareRequest(), {
      env: {
        CRON_SECRET: SECRET,
        RADAR24_COLLECT_ENABLED: "true",
        TURSO_DATABASE_URL: "libsql://test",
      },
      discoverTokens,
      fetchMarket,
      runCollectionFn,
    });
    expect(missing.status).toBe(401);
    expect(await missing.json()).toEqual({ error: "Unauthorized" });

    const wrong = await handleCollectCron(authRequest("wrong"), {
      env: {
        CRON_SECRET: SECRET,
        RADAR24_COLLECT_ENABLED: "true",
        TURSO_DATABASE_URL: "libsql://test",
      },
      discoverTokens,
      fetchMarket,
      runCollectionFn,
    });
    expect(wrong.status).toBe(401);

    expect(discoverTokens).not.toHaveBeenCalled();
    expect(fetchMarket).not.toHaveBeenCalled();
    expect(runCollectionFn).not.toHaveBeenCalled();
  });

  it("rejects when CRON_SECRET is not configured", async () => {
    const runCollectionFn = vi.fn(async () => emptySummary);
    const response = await handleCollectCron(authRequest(), {
      env: {
        CRON_SECRET: "",
        RADAR24_COLLECT_ENABLED: "true",
        TURSO_DATABASE_URL: "libsql://test",
      },
      runCollectionFn,
    });

    expect(response.status).toBe(401);
    expect(runCollectionFn).not.toHaveBeenCalled();
  });

  it("disabled collection does not call providers or runCollection", async () => {
    const discoverTokens = vi.fn(async () => []);
    const fetchMarket = vi.fn(async () => ({
      price: 1,
      capturedAt: Date.now(),
    }));
    const runCollectionFn = vi.fn(async () => emptySummary);
    const createClient = vi.fn(async () => {
      throw new Error("should not create client when disabled");
    });

    const response = await handleCollectCron(authRequest(), {
      env: {
        CRON_SECRET: SECRET,
        RADAR24_COLLECT_ENABLED: "false",
        TURSO_DATABASE_URL: "libsql://test",
      },
      createClient,
      discoverTokens,
      fetchMarket,
      runCollectionFn,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      enabled: false,
      message: "collection disabled",
    });
    expect(createClient).not.toHaveBeenCalled();
    expect(discoverTokens).not.toHaveBeenCalled();
    expect(fetchMarket).not.toHaveBeenCalled();
    expect(runCollectionFn).not.toHaveBeenCalled();
  });

  it("treats unset RADAR24_COLLECT_ENABLED as disabled", async () => {
    const runCollectionFn = vi.fn(async () => emptySummary);
    const response = await handleCollectCron(authRequest(), {
      env: {
        CRON_SECRET: SECRET,
        TURSO_DATABASE_URL: "libsql://test",
      },
      runCollectionFn,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ enabled: false });
    expect(runCollectionFn).not.toHaveBeenCalled();
  });

  it("enabled collection calls runCollection and returns summary", async () => {
    const discoverTokens = vi.fn(async () => []);
    const fetchMarket = vi.fn(async () => ({
      price: 1.5,
      capturedAt: 1_700_000_000_000,
    }));
    const runCollectionFn = vi.fn(async () => emptySummary);
    const close = vi.fn();
    const fakeClient = { close } as unknown as Client;
    const createClient = vi.fn(async () => fakeClient);

    const response = await handleCollectCron(authRequest(), {
      env: {
        CRON_SECRET: SECRET,
        RADAR24_COLLECT_ENABLED: "true",
        TURSO_DATABASE_URL: "libsql://test",
      },
      createClient,
      discoverTokens,
      fetchMarket,
      runCollectionFn,
      owner: "test-owner",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      enabled: true,
      offered: 3,
      discovered: 1,
      skipped: 2,
      jobsProcessed: 3,
      snapshotsWritten: 3,
      decisionsCreated: 1,
      casesClosed: 0,
      errors: [],
    });

    expect(createClient).toHaveBeenCalledOnce();
    expect(runCollectionFn).toHaveBeenCalledOnce();
    expect(runCollectionFn).toHaveBeenCalledWith(
      expect.objectContaining({
        client: fakeClient,
        owner: "test-owner",
        discoverTokens,
        fetchMarket,
      }),
    );
    // Providers are passed through to runCollection; not invoked by the route itself.
    expect(discoverTokens).not.toHaveBeenCalled();
    expect(fetchMarket).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });
});
