import { describe, expect, it } from "vitest";
import { handlePushPublicKey } from "../src/push/publicKeyRoute";
import { readVapidPublicKey } from "../src/push/publicKey";
import {
  browserSubscriptionToPayload,
  isPushSupported,
  statusFromNotificationPermission,
  urlBase64ToUint8Array,
} from "../src/push/browserSubscribe";
import { parseBrowserPushSubscription } from "../src/push/subscription";

describe("push public key route", () => {
  it("returns only publicKey", async () => {
    const response = await handlePushPublicKey({
      env: { VAPID_PUBLIC_KEY: "BPublicTestKey" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ publicKey: "BPublicTestKey" });
  });

  it("never includes private key fields", async () => {
    const response = await handlePushPublicKey({
      env: { VAPID_PUBLIC_KEY: "only-public" },
    });
    const json = await response.json() as Record<string, unknown>;
    expect(json).toEqual({ publicKey: "only-public" });
    expect(json).not.toHaveProperty("privateKey");
    expect(json).not.toHaveProperty("VAPID_PRIVATE_KEY");
    expect(json).not.toHaveProperty("subject");
  });

  it("returns 503 when public key is missing", async () => {
    const response = await handlePushPublicKey({ env: { VAPID_PUBLIC_KEY: "" } });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "VAPID public key is not configured",
    });
  });

  it("readVapidPublicKey ignores private key presence", () => {
    expect(
      readVapidPublicKey({
        VAPID_PUBLIC_KEY: "pub",
        VAPID_PRIVATE_KEY: "secret-must-not-leak",
      }),
    ).toBe("pub");
  });
});

describe("browser subscribe permission + payload", () => {
  it("maps notification permission to UI status", () => {
    expect(statusFromNotificationPermission("unsupported")).toBe("unsupported");
    expect(statusFromNotificationPermission("denied")).toBe("denied");
    expect(statusFromNotificationPermission("default")).toBe("idle");
    expect(statusFromNotificationPermission("granted")).toBe("idle");
  });

  it("detects unsupported environments", () => {
    expect(isPushSupported(undefined, undefined, undefined)).toBe(false);
    expect(isPushSupported({}, {}, {})).toBe(true);
  });

  it("builds subscribe payload from PushSubscription JSON", () => {
    const payload = browserSubscriptionToPayload({
      endpoint: "https://push.example/sub",
      keys: {
        p256dh: "p256-value",
        auth: "auth-value",
      },
    });

    expect(payload).toEqual({
      endpoint: "https://push.example/sub",
      keys: {
        p256dh: "p256-value",
        auth: "auth-value",
      },
    });

    const parsed = parseBrowserPushSubscription(payload);
    expect(parsed).toEqual({
      endpoint: "https://push.example/sub",
      p256dh: "p256-value",
      auth: "auth-value",
      userAgent: null,
    });
  });

  it("rejects incomplete subscribe payloads", () => {
    expect(
      browserSubscriptionToPayload({
        endpoint: "https://push.example/sub",
        keys: { p256dh: "only" },
      }),
    ).toBeNull();
    expect(browserSubscriptionToPayload({ endpoint: "" })).toBeNull();
  });

  it("decodes url-safe base64 VAPID keys", () => {
    // "hi" in url-safe base64 without padding
    const bytes = urlBase64ToUint8Array("aGk");
    expect(Array.from(bytes)).toEqual([104, 105]);
  });
});
