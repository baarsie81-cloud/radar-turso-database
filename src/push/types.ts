import type { UndeliveredPassDecisionRow } from "../db/repositories/push";

export const PUSH_NOTIFICATION_TITLE = "Radar V24 Signal";

export type PushCandidate = UndeliveredPassDecisionRow;

export type PushPayload = {
  title: string;
  body: string;
  url: string;
  mint: string;
  decisionId: number;
  tokenCaseId: number;
  decisionStatus: "PASS";
  decisionStage: "PLUS_10";
  plus10RoiPct: number | null;
  momentum5To10Pct: number | null;
  symbol: string | null;
};

export type PushSendFn = (payload: PushPayload) => Promise<void>;

export type PushDeliveryError = {
  decisionId: number;
  message: string;
};

export type PushDeliverySummary = {
  candidates: number;
  delivered: number;
  skipped: number;
  errors: PushDeliveryError[];
};
