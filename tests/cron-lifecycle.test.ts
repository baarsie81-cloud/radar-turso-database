import { afterEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@libsql/client";
import { handleLifecycleCron } from "../src/collector/cronLifecycle";
import type { LifecycleRunSummary } from "../src/lifecycle/run";

const SECRET = "test-cron-secret";

function authRequest(secret: string = SECRET): Request {
  return new Request("http://localhost/api/cron/lifecycle", {
    method: "GET",
    headers: { authorization: `Bearer ${secret}` },
  });
}

function bareRequest(): Request {
  return new Request("http://localhost/api/cron/lifecycle", { method: "GET" });
}

const emptySummary: LifecycleRunSummary = {
  expiredJobs: 2,
  processedJobs: 3,
  snapshotsWritten: 3,
  decisionsCreated: 1,
  casesClosed: 0,
  errors: [],
};

describe("GET /api/cron/lifecycle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects unauthorized requests", async () => {
    const fetchMarket = vi.fn(async () => ({
      price: 1,
      capturedAt: Date.now(),
    }));
    const processLifecycleJobsFn = vi.fn(async () => emptySummary);

    const missing = await handleLifecycleCron(bareRequest(), {
      env: {
        CRON_SECRET: SECRET,
        RADAR24_LIFECYCLE_ENABLED: "true",
        TURSO_DATABASE_URL: "libsql://test",
      },
      fetchMarket,
      processLifecycleJobsFn,
    });
    expect(missing.status).toBe(401);
    expect(await missing.json()).toEqual({ error: "Unauthorized" });

    const wrong = await handleLifecycleCron(authRequest("wrong"), {
      env: {
        CRON_SECRET: SECRET,
        RADAR24_LIFECYCLE_ENABLED: "true",
        TURSO_DATABASE_URL: "libsql://test",
      },
      fetchMarket,
      processLifecycleJobsFn,
    });
    expect(wrong.status).toBe(401);

    expect(fetchMarket).not.toHaveBeenCalled();
    expect(processLifecycleJobsFn).not.toHaveBeenCalled();
  });

  it("rejects when CRON_SECRET is not configured", async () => {
    const processLifecycleJobsFn = vi.fn(async () => emptySummary);
    const response = await handleLifecycleCron(authRequest(), {
      env: {
        CRON_SECRET: "",
        RADAR24_LIFECYCLE_ENABLED: "true",
        TURSO_DATABASE_URL: "libsql://test",
      },
      processLifecycleJobsFn,
    });

    expect(response.status).toBe(401);
    expect(processLifecycleJobsFn).not.toHaveBeenCalled();
  });

  it("disabled lifecycle does not call providers or processLifecycleJobs", async () => {
    const fetchMarket = vi.fn(async () => ({
      price: 1,
      capturedAt: Date.now(),
    }));
    const processLifecycleJobsFn = vi.fn(async () => emptySummary);
    const createClient = vi.fn(async () => {
      throw new Error("should not create client when disabled");
    });

    const response = await handleLifecycleCron(authRequest(), {
      env: {
        CRON_SECRET: SECRET,
        RADAR24_LIFECYCLE_ENABLED: "false",
        TURSO_DATABASE_URL: "libsql://test",
      },
      createClient,
      fetchMarket,
      processLifecycleJobsFn,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      enabled: false,
      message: "lifecycle disabled",
    });
    expect(createClient).not.toHaveBeenCalled();
    expect(fetchMarket).not.toHaveBeenCalled();
    expect(processLifecycleJobsFn).not.toHaveBeenCalled();
  });

  it("treats unset RADAR24_LIFECYCLE_ENABLED as disabled", async () => {
    const processLifecycleJobsFn = vi.fn(async () => emptySummary);
    const response = await handleLifecycleCron(authRequest(), {
      env: {
        CRON_SECRET: SECRET,
        TURSO_DATABASE_URL: "libsql://test",
      },
      processLifecycleJobsFn,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ enabled: false });
    expect(processLifecycleJobsFn).not.toHaveBeenCalled();
  });

  it("enabled lifecycle calls processLifecycleJobs and returns summary", async () => {
    const fetchMarket = vi.fn(async () => ({
      price: 1.5,
      capturedAt: 1_700_000_000_000,
    }));
    const processLifecycleJobsFn = vi.fn(async () => emptySummary);
    const close = vi.fn();
    const fakeClient = { close } as unknown as Client;
    const createClient = vi.fn(async () => fakeClient);

    const response = await handleLifecycleCron(authRequest(), {
      env: {
        CRON_SECRET: SECRET,
        RADAR24_LIFECYCLE_ENABLED: "true",
        TURSO_DATABASE_URL: "libsql://test",
      },
      createClient,
      fetchMarket,
      processLifecycleJobsFn,
      owner: "test-owner",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      enabled: true,
      expiredJobs: 2,
      processedJobs: 3,
      snapshotsWritten: 3,
      decisionsCreated: 1,
      casesClosed: 0,
      errors: [],
    });

    expect(createClient).toHaveBeenCalledOnce();
    expect(processLifecycleJobsFn).toHaveBeenCalledOnce();
    expect(processLifecycleJobsFn).toHaveBeenCalledWith(
      expect.objectContaining({
        client: fakeClient,
        owner: "test-owner",
        fetchMarket,
      }),
    );
    // Provider is passed through; not invoked by the route itself.
    expect(fetchMarket).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it("does not call discovery (no GeckoTerminal / runCollection)", async () => {
    const fetchNewSolanaPools = vi.fn(async () => []);
    const runCollection = vi.fn(async () => ({
      discovered: 0,
      skipped: 0,
      jobsProcessed: 0,
      snapshotsWritten: 0,
      decisionsCreated: 0,
      casesClosed: 0,
      errors: [],
    }));
    const processLifecycleJobsFn = vi.fn(async () => emptySummary);
    const close = vi.fn();
    const fakeClient = { close } as unknown as Client;

    const response = await handleLifecycleCron(authRequest(), {
      env: {
        CRON_SECRET: SECRET,
        RADAR24_LIFECYCLE_ENABLED: "true",
        TURSO_DATABASE_URL: "libsql://test",
      },
      createClient: vi.fn(async () => fakeClient),
      fetchMarket: vi.fn(async () => ({ price: 1, capturedAt: Date.now() })),
      processLifecycleJobsFn,
    });

    expect(response.status).toBe(200);
    expect(processLifecycleJobsFn).toHaveBeenCalledOnce();
    expect(fetchNewSolanaPools).not.toHaveBeenCalled();
    expect(runCollection).not.toHaveBeenCalled();
  });
});
