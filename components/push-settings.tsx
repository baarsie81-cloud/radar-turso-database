"use client";

import { useCallback, useEffect, useState } from "react";
import {
  browserSubscriptionToPayload,
  isPushSupported,
  resolveInitialPushStatus,
  urlBase64ToUint8Array,
  type PushUiStatus,
} from "../src/push/browserSubscribe";

const STATUS_LABEL: Record<PushUiStatus, string> = {
  unsupported: "Notifications not supported in this browser",
  idle: "Notifications not enabled",
  denied: "Permission denied",
  enabled: "Notifications enabled",
  error: "Error",
  loading: "Working…",
};

type Props = {
  /** Injectable fetch for tests. */
  fetchFn?: typeof fetch;
};

async function detectExistingSubscription(): Promise<{
  supported: boolean;
  permission: NotificationPermission | "unsupported";
  hasSubscription: boolean;
}> {
  if (
    !isPushSupported(
      typeof navigator !== "undefined" ? navigator.serviceWorker : undefined,
      typeof window !== "undefined" ? window.PushManager : undefined,
      typeof window !== "undefined" ? window.Notification : undefined,
    )
  ) {
    return {
      supported: false,
      permission: "unsupported",
      hasSubscription: false,
    };
  }

  const permission = Notification.permission;
  if (permission === "denied") {
    return { supported: true, permission, hasSubscription: false };
  }

  let hasSubscription = false;
  try {
    const registration =
      (await navigator.serviceWorker.getRegistration())
      ?? (await navigator.serviceWorker.getRegistration("/"));
    if (registration) {
      const existing = await registration.pushManager.getSubscription();
      hasSubscription = existing != null;
    }
  } catch {
    hasSubscription = false;
  }

  return { supported: true, permission, hasSubscription };
}

/** Browser opt-in for V24 push — stores subscription only; does not send. */
export function PushSettings({ fetchFn = fetch }: Props) {
  const [status, setStatus] = useState<PushUiStatus>("loading");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const detected = await detectExistingSubscription();
      if (cancelled) {
        return;
      }
      setStatus(resolveInitialPushStatus(detected));
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const enableNotifications = useCallback(async () => {
    setStatus("loading");
    setMessage(null);

    try {
      if (
        !isPushSupported(
          navigator.serviceWorker,
          window.PushManager,
          window.Notification,
        )
      ) {
        setStatus("unsupported");
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission === "denied") {
        setStatus("denied");
        return;
      }
      if (permission !== "granted") {
        setStatus("idle");
        setMessage("Permission was not granted.");
        return;
      }

      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      const existing = await registration.pushManager.getSubscription();
      if (existing) {
        const existingPayload = browserSubscriptionToPayload(existing.toJSON());
        if (existingPayload) {
          await fetchFn("/api/push/subscribe", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(existingPayload),
          });
        }
        setStatus("enabled");
        setMessage(null);
        return;
      }

      const keyResponse = await fetchFn("/api/push/public-key");
      if (!keyResponse.ok) {
        throw new Error("Could not load VAPID public key");
      }
      const keyJson = (await keyResponse.json()) as { publicKey?: string };
      if (!keyJson.publicKey) {
        throw new Error("VAPID public key missing");
      }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(
          keyJson.publicKey,
        ) as BufferSource,
      });

      const payload = browserSubscriptionToPayload(subscription.toJSON());
      if (!payload) {
        throw new Error("Invalid PushSubscription");
      }

      const saveResponse = await fetchFn("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!saveResponse.ok) {
        throw new Error("Failed to save subscription");
      }

      setStatus("enabled");
      setMessage(null);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, [fetchFn]);

  return (
    <section
      data-testid="push-settings"
      style={{
        marginTop: "1.25rem",
        marginBottom: "1.25rem",
        padding: "0.85rem 1rem",
        border: "1px solid #ddd",
        borderRadius: "4px",
        background: "#fafafa",
        maxWidth: "32rem",
      }}
    >
      <h2 style={{ margin: "0 0 0.35rem", fontSize: "1rem" }}>
        Browser notifications
      </h2>
      <p style={{ margin: "0 0 0.75rem", fontSize: "0.85rem", color: "#555" }}>
        Opt in to store a push subscription for Radar V24 PASS signals.
        Delivery stays off until push is enabled server-side.
      </p>

      <p
        data-testid="push-settings-status"
        style={{ margin: "0 0 0.75rem", fontSize: "0.9rem" }}
      >
        Status: <strong>{STATUS_LABEL[status]}</strong>
      </p>

      {message != null ? (
        <p
          role="alert"
          style={{ margin: "0 0 0.75rem", fontSize: "0.85rem", color: "#666" }}
        >
          {message}
        </p>
      ) : null}

      {status !== "unsupported"
        && status !== "enabled"
        && status !== "denied"
        && status !== "loading" ? (
        <button
          type="button"
          onClick={() => {
            void enableNotifications();
          }}
          style={{
            padding: "0.4rem 0.75rem",
            fontSize: "0.85rem",
            border: "1px solid #bbb",
            borderRadius: "3px",
            background: "#fff",
            cursor: "pointer",
          }}
        >
          Enable notifications
        </button>
      ) : null}
    </section>
  );
}
