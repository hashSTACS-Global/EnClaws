import { chromium } from "playwright-core";
import { getHeadersWithAuth } from "../browser/cdp.helpers.js";
import {
  launchOpenClawChrome,
  stopOpenClawChrome,
  getChromeWebSocketUrl,
} from "../browser/chrome.js";
import { resolveBrowserConfig, resolveProfile } from "../browser/config.js";

export async function loginQwenWeb(params: {
  onProgress: (msg: string) => void;
  openUrl: (url: string) => Promise<boolean>;
}) {
  const browserConfig = resolveBrowserConfig(undefined);
  const profile = resolveProfile(browserConfig, "openclaw");
  if (!profile) {
    throw new Error(`Could not resolve browser profile 'openclaw'`);
  }

  params.onProgress("Launching browser...");
  const qwenUrl = "https://www.qianwen.com/";
  const running = await launchOpenClawChrome(browserConfig, profile, { initialUrl: qwenUrl });

  try {
    const cdpUrl = `http://127.0.0.1:${running.cdpPort}`;
    let wsUrl: string | null = null;

    params.onProgress("Waiting for browser debugger...");
    for (let i = 0; i < 15; i++) {
      wsUrl = await getChromeWebSocketUrl(cdpUrl, 2000);
      if (wsUrl) {
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    if (!wsUrl) {
      throw new Error(`Failed to resolve Chrome WebSocket URL from ${cdpUrl} after retries.`);
    }

    params.onProgress("Connecting to browser...");
    const browser = await chromium.connectOverCDP(wsUrl, {
      headers: getHeadersWithAuth(wsUrl),
    });
    const context = browser.contexts()[0];
    const page = context.pages()[0] || (await context.newPage());

    if (page.url() === "about:blank") {
      await page.goto(qwenUrl);
    }
    const userAgent = await page.evaluate(() => navigator.userAgent);

    params.onProgress("Please login to Tongyi Qianwen in the opened browser window...");

    return await new Promise<{ cookie: string; xsrfToken: string; userAgent: string; ut?: string }>(
      (resolve, reject) => {
        let capturedXsrfToken: string | undefined;
        let capturedUt: string | undefined;
        let resolved = false;

        const timeout = setTimeout(() => {
          if (!resolved) {
            reject(new Error("Login timed out (5 minutes)."));
          }
        }, 300000);

        const tryResolve = async () => {
          if (resolved) {
            return;
          }

          try {
            const cookies = await context.cookies();
            const cookieString = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

            if (!capturedXsrfToken) {
              const xsrfCookie = cookies.find(
                (c) =>
                  c.name.toLowerCase() === "xsrf-token" || c.name.toLowerCase() === "x-xsrf-token",
              );
              if (xsrfCookie) {
                capturedXsrfToken = xsrfCookie.value;
              }
            }

            if (!capturedUt) {
              const utCookie = cookies.find((c) => c.name.toLowerCase() === "b-user-id");
              if (utCookie) {
                capturedUt = utCookie.value;
              }
            }

            const hasSsoTicket = cookieString.includes("tongyi_sso_ticket=");
            const hasSsoHash = cookieString.includes("tongyi_sso_ticket_hash=");

            if (hasSsoTicket && hasSsoHash && capturedXsrfToken && capturedUt) {
              resolved = true;
              clearTimeout(timeout);
              clearInterval(pollingInterval);
              console.log(`[Qwen Web] Credentials captured (including ut)!`);
              resolve({
                cookie: cookieString,
                xsrfToken: capturedXsrfToken,
                userAgent,
                ut: capturedUt,
              });
            }
          } catch (e: unknown) {
            console.error(`[Qwen Web] Failed to fetch cookies: ${String(e)}`);
          }
        };

        // Check every 2 seconds in case no new requests are triggering the listener
        const pollingInterval = setInterval(tryResolve, 2000);

        page.on("request", async (request) => {
          const url = request.url();
          // Match any qianwen.com API
          if (url.includes("qianwen.com") && (url.includes("/api/") || url.includes("/v2/"))) {
            const headers = request.headers();
            const xsrf = headers["x-xsrf-token"];
            if (xsrf) {
              capturedXsrfToken = xsrf;
              await tryResolve();
            }
          }
        });

        page.on("close", () => {
          clearInterval(pollingInterval);
          reject(new Error("Browser window closed before login was captured."));
        });
      },
    );
  } finally {
    await stopOpenClawChrome(running);
  }
}
