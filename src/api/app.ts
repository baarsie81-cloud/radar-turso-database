import { Hono } from "hono";
import type { Client } from "@libsql/client";
import { getDecisionReplay } from "../db/repositories/decisions";
import { getCaseSummary, listCaseSummaries } from "../db/repositories/tokenCases";
import {
  LIFECYCLE_STAGES,
  SNAPSHOT_STAGES,
  type CaseStatus,
  type LifecycleStage,
  type SnapshotStage,
} from "../domain/types";

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

export function createApiApp(client: Client): Hono {
  const app = new Hono();

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

  return app;
}
