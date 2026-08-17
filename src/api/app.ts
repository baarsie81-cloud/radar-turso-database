import { Hono } from "hono";
import type { Client } from "@libsql/client";
import { getDecisionReplay } from "../db/repositories/decisions";
import {
  createPushDelivery,
  deletePushSubscription,
  getPushSubscriptions,
  hasPushDelivery,
  upsertPushSubscription,
} from "../db/repositories/push";
import { getCaseSummary, listCaseSummaries } from "../db/repositories/tokenCases";
import {
  LIFECYCLE_STAGES,
  SNAPSHOT_STAGES,
  type CaseStatus,
  type LifecycleStage,
  type SnapshotStage,
} from "../domain/types";

export type ApiAppOptions = {
  radarApiSecret?: string;
};

const CASE_STATUSES: readonly CaseStatus[] = ["OPEN", "CLOSED"];

function isCaseStatus(value: string): value is CaseStatus {
  return (CASE_STATUSES as readonly string[]).includes(value);
}

function isLifecycleStage(value: string): value is LifecycleStage {
  return (LIFECYCLE_STAGES as readonly string[]).includes(value);
}

function isSnapshotStage(value: string): value is SnapshotStage {
  return (SNAPSHOT_STAGES as readonly string[]).includes(value);
}

function parseCaseId(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) {
    return null;
  }
  return Number(value);
}

function isAuthorized(header: string | undefined, secret: string | undefined): boolean {
  return Boolean(secret && header === `Bearer ${secret}`);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function readSubscriptionBody(value: unknown): {
  endpoint: string;
  p256dh?: string;
  auth?: string;
  userAgent: string | null;
} | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Record<string, unknown>;
  if (!isNonEmptyString(row.endpoint)) {
    return null;
  }
  return {
    endpoint: row.endpoint,
    p256dh: isNonEmptyString(row.p256dh) ? row.p256dh : undefined,
    auth: isNonEmptyString(row.auth) ? row.auth : undefined,
    userAgent: typeof row.userAgent === "string" ? row.userAgent : null,
  };
}

export function createApiApp(client: Client, options: ApiAppOptions = {}): Hono {
  const app = new Hono();
  const radarApiSecret = options.radarApiSecret;

  app.get("/health", (c) => c.json({ ok: true }));

  app.get("/cases", async (c) => {
    const caseStatus = c.req.query("case_status");
    const stage = c.req.query("stage");
    const mint = c.req.query("mint");

    if (caseStatus != null && caseStatus !== "" && !isCaseStatus(caseStatus)) {
      return c.json({ error: "Invalid case_status" }, 400);
    }
    if (stage != null && stage !== "" && !isLifecycleStage(stage)) {
      return c.json({ error: "Invalid stage" }, 400);
    }

    const cases = await listCaseSummaries(client, {
      caseStatus: caseStatus && isCaseStatus(caseStatus) ? caseStatus : undefined,
      stage: stage && isLifecycleStage(stage) ? stage : undefined,
      mint: mint || undefined,
    });
    return c.json(cases);
  });

  app.get("/cases/:id", async (c) => {
    const id = parseCaseId(c.req.param("id"));
    if (id == null) {
      return c.json({ error: "Invalid case id" }, 400);
    }

    const summary = await getCaseSummary(client, id);
    if (!summary) {
      return c.json({ error: "Case not found" }, 404);
    }
    return c.json(summary);
  });

  app.get("/cases/:id/decisions/:stage", async (c) => {
    const id = parseCaseId(c.req.param("id"));
    if (id == null) {
      return c.json({ error: "Invalid case id" }, 400);
    }

    const stage = c.req.param("stage");
    if (!isSnapshotStage(stage)) {
      return c.json({ error: "Invalid stage" }, 400);
    }

    const radarVersion = c.req.query("radar_version");
    const replay = await getDecisionReplay(client, {
      tokenCaseId: id,
      decisionStage: stage,
      radarVersion: radarVersion || undefined,
    });
    if (!replay) {
      return c.json({ error: "Decision not found" }, 404);
    }
    return c.json(replay);
  });

  app.put("/push/subscriptions", async (c) => {
    if (!isAuthorized(c.req.header("authorization"), radarApiSecret)) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid subscription" }, 400);
    }

    const parsed = readSubscriptionBody(body);
    if (!parsed || parsed.p256dh == null || parsed.auth == null) {
      return c.json({ error: "Invalid subscription" }, 400);
    }

    const subscription = await upsertPushSubscription(client, {
      endpoint: parsed.endpoint,
      p256dh: parsed.p256dh,
      auth: parsed.auth,
      userAgent: parsed.userAgent,
    });
    return c.json(subscription);
  });

  app.get("/push/subscriptions", async (c) => {
    if (!isAuthorized(c.req.header("authorization"), radarApiSecret)) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    return c.json(await getPushSubscriptions(client));
  });

  app.delete("/push/subscriptions", async (c) => {
    if (!isAuthorized(c.req.header("authorization"), radarApiSecret)) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid subscription" }, 400);
    }

    const parsed = readSubscriptionBody(body);
    if (!parsed) {
      return c.json({ error: "Invalid subscription" }, 400);
    }

    const deleted = await deletePushSubscription(client, parsed.endpoint);
    if (!deleted) {
      return c.json({ error: "Subscription not found" }, 404);
    }
    return c.json({ ok: true });
  });

  app.get("/push/deliveries/:decisionId", async (c) => {
    if (!isAuthorized(c.req.header("authorization"), radarApiSecret)) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const decisionId = parseCaseId(c.req.param("decisionId"));
    if (decisionId == null) {
      return c.json({ error: "Invalid decision id" }, 400);
    }
    return c.json({ delivered: await hasPushDelivery(client, decisionId) });
  });

  app.put("/push/deliveries", async (c) => {
    if (!isAuthorized(c.req.header("authorization"), radarApiSecret)) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid delivery" }, 400);
    }
    if (!body || typeof body !== "object") {
      return c.json({ error: "Invalid delivery" }, 400);
    }
    const row = body as Record<string, unknown>;
    const decisionId = typeof row.decisionId === "number" && Number.isInteger(row.decisionId) && row.decisionId >= 1
      ? row.decisionId
      : null;
    const tokenCaseId = typeof row.tokenCaseId === "number" && Number.isInteger(row.tokenCaseId) && row.tokenCaseId >= 1
      ? row.tokenCaseId
      : null;
    if (decisionId == null || tokenCaseId == null) {
      return c.json({ error: "Invalid delivery" }, 400);
    }

    const delivery = await createPushDelivery(client, { decisionId, tokenCaseId });
    return c.json(delivery);
  });

  return app;
}
