import { loginQwenWeb } from "../providers/qwen-web-auth.js";
import type { ApplyAuthChoiceParams, ApplyAuthChoiceResult } from "./auth-choice.apply.js";
import { applyQwenWebConfig } from "./onboard-auth.config-core.js";
import { setQwenWebCredentials } from "./onboard-auth.credentials.js";
import { openUrl } from "./onboard-helpers.js";

export async function applyAuthChoiceQwenWeb(
  params: ApplyAuthChoiceParams,
): Promise<ApplyAuthChoiceResult | null> {
  if (params.authChoice !== "qwen-web") {
    return null;
  }

  const { prompter, runtime, config, agentDir, opts } = params;

  let cookie = opts?.qwenWebCookie?.trim();
  let xsrfToken = "";
  let ut = "";

  if (!cookie) {
    const mode = await prompter.select({
      message: "Qwen Auth Mode",
      options: [
        {
          value: "auto",
          label: "Automated Login (Recommended)",
          hint: "Opens browser to capture login automatically",
        },
        {
          value: "manual",
          label: "Manual Paste",
          hint: "Paste Cookie and XSRF token manually",
        },
      ],
    });

    if (mode === "auto") {
      const spin = prompter.progress("Preparing automated login...");
      try {
        const result = await loginQwenWeb({
          onProgress: (msg) => spin.update(msg),
          openUrl: async (url) => {
            await openUrl(url);
            return true;
          },
        });
        spin.stop("Login captured successfully!");
        cookie = result.cookie;
        xsrfToken = result.xsrfToken;
        ut = result.ut || "";

        await setQwenWebCredentials(
          { cookie, xsrfToken, userAgent: result.userAgent, ut },
          agentDir,
        );
      } catch (err) {
        spin.stop("Automated login failed.");
        runtime.error(String(err));
        const retryManual = await prompter.confirm({
          message: "Would you like to try manual paste instead?",
          initialValue: true,
        });
        if (!retryManual) {
          throw err;
        }
        // Fall through to manual
      }
    }

    if (!cookie) {
      await prompter.note(
        [
          "To use Qwen Browser manually, you need a session cookie from qianwen.com.",
          "1. Login to https://www.qianwen.com",
          "2. Open DevTools (F12) -> Network tab",
          "3. Look for a request to '/api/v2/chat'",
          "4. Copy the 'Cookie' and 'x-xsrf-token' headers.",
        ].join("\n"),
        "Qwen Login",
      );

      const rawInput = await prompter.text({
        message: "Paste Cookie / Headers",
        placeholder: "tongyi_sso_ticket=...; x-xsrf-token=...",
        validate: (value) => (value.trim().length > 0 ? undefined : "Required"),
      });

      // Smart-ish parsing
      const lines = rawInput.split("\n");
      for (const line of lines) {
        const lower = line.toLowerCase();
        if (lower.startsWith("cookie:")) {
          cookie = line.slice(7).trim();
        } else if (lower.startsWith("x-xsrf-token:")) {
          xsrfToken = line.slice(13).trim();
        } else if (line.includes("=") && line.includes(";")) {
          if (!cookie) {
            cookie = line.trim();
          }
        }
      }

      if (!cookie) {
        cookie = rawInput.trim();
      }

      if (cookie && !ut) {
        const match = cookie.match(/(?:^|;\s*)b-user-id=([^;]+)/i);
        if (match) {
          ut = match[1];
        }
      }

      if (!xsrfToken) {
        xsrfToken = await prompter.text({
          message: "XSRF Token",
          placeholder: "tokenValue",
          validate: (value) => (value.trim().length > 0 ? undefined : "Required"),
        });
      }

      await setQwenWebCredentials({ cookie, xsrfToken, ut }, agentDir);
    }
  } else {
    // If cookie was provided via opts (not common but possible)
    // We might need to ask for xsrfToken if it's missing
    if (!xsrfToken) {
      xsrfToken = await prompter.text({
        message: "XSRF Token",
        validate: (value) => (value.trim().length > 0 ? undefined : "Required"),
      });
    }
    await setQwenWebCredentials({ cookie, xsrfToken, ut }, agentDir);
  }

  const nextConfig = await applyQwenWebConfig(config);

  return { config: nextConfig };
}
