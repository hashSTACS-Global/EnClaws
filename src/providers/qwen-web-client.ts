import type { ModelDefinitionConfig } from "../config/types.models.js";

export interface QwenChatSession {
  session_id: string;
  title?: string;
}

export interface QwenWebClientOptions {
  cookie: string;
  xsrfToken: string;
  userAgent?: string;
  deviceId?: string;
  ut?: string;
}

export class QwenWebClient {
  private cookie: string;
  private xsrfToken: string;
  private userAgent: string;
  private deviceId: string;
  private ut: string;

  constructor(options: QwenWebClientOptions | string) {
    let finalOptions: QwenWebClientOptions;
    if (typeof options === "string") {
      try {
        finalOptions = JSON.parse(options);
      } catch {
        finalOptions = { cookie: options, xsrfToken: "" };
      }
    } else {
      finalOptions = options;
    }

    this.cookie = finalOptions.cookie || "";
    this.xsrfToken = finalOptions.xsrfToken || "";
    this.userAgent =
      finalOptions.userAgent ||
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    this.ut = finalOptions.ut || "";

    if (!this.ut && this.cookie) {
      const match = this.cookie.match(/(?:^|;\s*)b-user-id=([^;]+)/i);
      if (match) {
        this.ut = match[1];
      }
    }
    this.deviceId =
      finalOptions.deviceId || this.ut || "random-" + Math.random().toString(36).slice(2);
  }

  private async fetchHeaders(accept: string = "application/json") {
    return {
      Cookie: this.cookie,
      "User-Agent": this.userAgent,
      "Content-Type": "application/json",
      Accept: accept,
      "x-xsrf-token": this.xsrfToken,
      Referer: "https://chat2.qianwen.com/",
      Origin: "https://chat2.qianwen.com",
      "x-deviceid": this.deviceId,
      "x-platform": "pc_tongyi",
    };
  }

  async createChatSession(): Promise<QwenChatSession> {
    // Note: Based on browser research, the session ID is a 32-character hex string.
    // It appears to be initialized upon the first message send or via api/v1/session/get.
    // For simplicity and to avoid 404s, we generate one locally.
    const sessionId = Array.from({ length: 32 }, () =>
      Math.floor(Math.random() * 16).toString(16),
    ).join("");
    return {
      session_id: sessionId,
      title: "New Chat",
    };
  }

  async chatCompletions(params: {
    sessionId: string;
    message: string;
    model?: string;
    parentMessageId?: string;
    deepSearch?: boolean;
    aiToolScene?: string;
    bizData?: string;
    signal?: AbortSignal;
  }) {
    const modelId = params.model || "Qwen3.5-Plus";
    // If it's a thinking model, ensure deepSearch is enabled
    const isThinking = modelId.toLowerCase().includes("thinking");
    const deepSearchFlag = params.deepSearch || isThinking ? "1" : "0";

    const timestamp = Date.now();
    const nonce = Math.random().toString(36).slice(2);
    // Use chat2.qianwen.com and ensure biz_id and ut are present
    const url = `https://chat2.qianwen.com/api/v2/chat?biz_id=ai_qwen&chat_client=h5&device=pc&fr=pc&pr=qwen&nonce=${nonce}&timestamp=${timestamp}&ut=${this.ut}`;

    const headersList = await this.fetchHeaders("text/event-stream, text/plain, */*");

    const bodyObj: Record<string, unknown> = {
      model: modelId,
      messages: [
        {
          content: params.message,
          mime_type: "text/plain",
          meta_data: {
            ori_query: params.message,
          },
        },
      ],
      session_id: params.sessionId,
      parent_req_id: params.parentMessageId || "0",
      deep_search: deepSearchFlag,
      req_id: "req-" + Math.random().toString(36).slice(2),
      scene: "chat",
      sub_scene: "chat",
      temporary: false,
      from: "default",
      scene_param: params.parentMessageId ? "continue_chat" : "first_turn",
      chat_client: "h5",
      client_tm: timestamp.toString(),
      protocol_version: "v2",
      biz_id: "ai_qwen",
    };

    if (params.aiToolScene) {
      bodyObj.ai_tool_scene = params.aiToolScene;
    }
    if (params.bizData) {
      bodyObj.biz_data = params.bizData;
    }

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: headersList,
        body: JSON.stringify(bodyObj),
        signal: params.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        console.error(`Qwen Web API error (${res.status}):`, text);
        throw new Error(`Chat completion failed: ${res.status} ${text}`);
      }

      return res.body;
    } catch (error) {
      console.error("[QwenWebClient] Fetch threw an exception:", error);
      throw error;
    }
  }

  async discoverModels(): Promise<ModelDefinitionConfig[]> {
    return [
      {
        id: "Qwen3.5-Plus",
        name: "Qwen 3.5 Plus (Assistant)",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 4096,
      },
      {
        id: "Qwen3.5-Plus-Thinking",
        name: "Qwen 3.5 Plus (Deep Thinking)",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 4096,
      },
      {
        id: "Qwen-Deep-Research",
        name: "Qwen (Deep Research)",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 4096,
      },
      {
        id: "Qwen-Code-Agent",
        name: "Qwen (Code Assistant)",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 4096,
      },
      {
        id: "Qwen-Image-Gen",
        name: "Qwen (Image Generation)",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 4096,
      },
    ];
  }
}
