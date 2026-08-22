import type { PushPayload } from "./types";

/** Minimal JSON body delivered to the service worker. */
export type ServiceWorkerPushData = {
  title: string;
  body: string;
  url: string;
  mint: string;
};

/**
 * Map a Radar push payload to the service-worker notification data shape.
 * Does not recalculate metrics or call the decision engine.
 */
export function toServiceWorkerPushData(
  payload: PushPayload,
): ServiceWorkerPushData {
  return {
    title: payload.title,
    body: payload.body,
    url: payload.url,
    mint: payload.mint,
  };
}
