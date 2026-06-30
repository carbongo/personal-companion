/**
 * Typed client for the companion's JSON API (see src/server/web/api.ts).
 * Every call is cookie-authenticated; a 401 means the session lapsed, so we
 * bounce to the server-rendered /login and come back.
 */

export interface BrainInfo {
  provider: string;
  model: string;
  endpoint?: string;
}

export interface AppState {
  setupComplete: boolean;
  app: { name: string; owner: string; timezone: string };
  brain: BrainInfo;
  companionConfigured: boolean;
  channels: { telegram: boolean };
  web: { enabled: boolean };
  auth?: { enabled: boolean };
  chat: {
    batchIdleMs: number;
    batchStepMs: number;
    batchMaxMs: number;
    voice: boolean;
  };
}

export interface ChatMessage {
  id: number;
  role: "user" | "assistant" | string;
  kind: "text" | "voice" | "photo" | string;
  content: string;
  mediaUrls: string[];
  createdAt: string;
}

export interface Memory {
  id: number;
  content: string;
  tags: string | null;
  createdAt: string;
}

export interface DailySummary {
  day: string;
  summary: string;
  createdAt?: string;
}

export interface SetupValues {
  name: string;
  owner: string;
  preset: string;
  persona: string;
  timezone: string;
  dataDir: string;
  port: number;
  webAuthConfigured: boolean;
  autoRestartOnSave: boolean;
  provider: string;
  model: string;
  visionModel: string;
  ollamaUrl: string;
  baseUrl: string;
  temperature: number;
  numCtx: number;
  maxTokens: number;
  think: string;
  timeoutMs: number;
  historyLimit: number;
  chatBatchIdleMs: number;
  chatBatchStepMs: number;
  chatBatchMaxMs: number;
  telegramConfigured: boolean;
  telegramAllowedIds: string;
  telegramReplySplit: boolean;
  memoryContextDays: number;
  memoryLimit: number;
  memorySummaryCron: string;
  memoryRollupExtract: boolean;
  webEnabled: boolean;
  webSearchProvider: string;
  tavilyConfigured: boolean;
  webSteps: number;
  webResults: number;
  webPageChars: number;
  webSearchTimeoutMs: number;
  webFetchTimeoutMs: number;
  webMaxReqs: number;
  sttProvider: string;
  sttApiUrl: string;
  sttConfigured: boolean;
  sttModel: string;
  sttLocalModel: string;
  sttLanguage: string;
  weatherLat: string;
  weatherLon: string;
  weatherLocationName: string;
}

export interface GeocodeResult {
  name: string;
  admin1: string;
  country: string;
  latitude: number;
  longitude: number;
  timezone: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (res.status === 401) {
    window.location.href = "/login";
    throw new ApiError("Session expired", 401);
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new ApiError(data?.error ?? `Request failed (${res.status})`, res.status);
  }
  return data as T;
}

const body = (v: unknown) => JSON.stringify(v);

export const api = {
  state: () => req<AppState>("/api/state"),

  messages: (day?: string) =>
    req<{ day: string; messages: ChatMessage[] }>(
      `/api/messages${day ? `?day=${encodeURIComponent(day)}` : ""}`,
    ),
  days: () => req<{ days: string[] }>("/api/days"),
  send: (payload: { text?: string; images?: string[]; kind?: string }) =>
    req<{ reply: string }>("/api/chat", { method: "POST", body: body(payload) }),

  /**
   * Streaming chat: POSTs the turn and reads newline-delimited JSON back,
   * calling `onParagraph` for each finished paragraph as it arrives. Resolves
   * with the full reply once the stream closes.
   */
  sendStream: async (
    payload: { text?: string; images?: string[]; kind?: string },
    onParagraph: (text: string) => void,
  ): Promise<{ reply: string }> => {
    const res = await fetch("/api/chat/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body(payload),
    });
    if (res.status === 401) {
      window.location.href = "/login";
      throw new ApiError("Session expired", 401);
    }
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      let message = `Request failed (${res.status})`;
      try {
        message = (JSON.parse(text) as { error?: string })?.error ?? message;
      } catch {
        /* non-JSON body */
      }
      throw new ApiError(message, res.status);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let reply = "";
    const handle = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let obj: { type?: string; text?: string; reply?: string; error?: string };
      try {
        obj = JSON.parse(trimmed);
      } catch {
        return;
      }
      if (obj.type === "paragraph" && obj.text) onParagraph(obj.text);
      else if (obj.type === "done") reply = obj.reply ?? reply;
      else if (obj.type === "error")
        throw new ApiError(obj.error ?? "The companion couldn't reply.", 500);
    };
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      // biome-ignore lint/suspicious/noAssignInExpressions: line scan
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        handle(line);
      }
    }
    if (buf) handle(buf);
    return { reply };
  },
  transcribe: (file: Blob, filename = "voice.webm") => {
    const form = new FormData();
    form.append("file", file, filename);
    return req<{ text: string }>("/api/transcribe", { method: "POST", body: form });
  },
  geocode: (q: string) =>
    req<{ results: GeocodeResult[] }>(`/api/geocode?q=${encodeURIComponent(q)}`),

  getCore: () => req<{ contentMd: string }>("/api/core"),
  setCore: (contentMd: string) =>
    req<{ ok: true }>("/api/core", { method: "PUT", body: body({ contentMd }) }),
  memories: (q = "") => req<{ memories: Memory[] }>(`/api/memories?q=${encodeURIComponent(q)}`),
  addMemory: (content: string, tags: string | null = null) =>
    req<{ memory: Memory }>("/api/memories", { method: "POST", body: body({ content, tags }) }),
  deleteMemory: (id: number) =>
    req<{ ok: true }>(`/api/memories/${id}`, { method: "DELETE" }),
  summaries: () => req<{ summaries: DailySummary[] }>("/api/summaries"),
  rollup: () => req<{ summarized: number }>("/api/rollup", { method: "POST" }),

  getSetup: () => req<{ setupComplete: boolean; values: SetupValues }>("/api/setup"),
  testModel: (payload: Record<string, string>) =>
    req<{ ok: boolean; detail: string }>("/api/setup/test", { method: "POST", body: body(payload) }),
  saveSetup: (payload: Record<string, string>) =>
    req<{ ok: boolean; restartNeeded: boolean; restarting: boolean }>("/api/setup", {
      method: "POST",
      body: body(payload),
    }),
};
