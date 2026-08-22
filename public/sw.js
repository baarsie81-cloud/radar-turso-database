/* Radar V24 service worker — receive PASS push notifications. */

self.addEventListener("push", (event) => {
  let data = {
    title: "Radar V24 Signal",
    body: "",
    url: "/radar",
    mint: "",
  };

  try {
    if (event.data) {
      const parsed = event.data.json();
      data = {
        title: typeof parsed.title === "string" ? parsed.title : data.title,
        body: typeof parsed.body === "string" ? parsed.body : data.body,
        url: typeof parsed.url === "string" ? parsed.url : data.url,
        mint: typeof parsed.mint === "string" ? parsed.mint : data.mint,
      };
    }
  } catch {
    // Keep defaults when payload is not JSON.
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      data: {
        url: data.url,
        mint: data.mint,
      },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl =
    event.notification.data && typeof event.notification.data.url === "string"
      ? event.notification.data.url
      : "/radar";

  event.waitUntil(
    self.clients.openWindow
      ? self.clients.openWindow(targetUrl)
      : Promise.resolve(),
  );
});
