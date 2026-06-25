/** The settings form model: a normalized view over the flat SetupValues, and
 *  the serializer back to the /api/setup body. Numbers stay numbers in the UI;
 *  everything is stringified on save (the server writes them into .env). */
import type { SetupValues } from "../../lib/api.ts";
import type { Tone } from "../../components/Toast.tsx";

export interface Form {
  // Persona
  name: string;
  owner: string;
  preset: string;
  persona: string;
  // Mind (LLM)
  provider: string;
  model: string;
  ollamaUrl: string;
  baseUrl: string;
  apiKey: string;
  temperature: number;
  numCtx: number;
  maxTokens: number;
  think: string;
  timeoutMs: number;
  historyLimit: number;
  // Channels (Telegram)
  telegramToken: string;
  telegramAllowedIds: string;
  telegramReplySplit: boolean;
  // Voice (STT)
  sttProvider: string;
  sttApiUrl: string;
  sttApiKey: string;
  sttModel: string;
  sttLocalModel: string;
  sttLanguage: string;
  // Web access
  webEnabled: boolean;
  webSearchProvider: string;
  tavilyKey: string;
  webSteps: number;
  webResults: number;
  webPageChars: number;
  webSearchTimeoutMs: number;
  webFetchTimeoutMs: number;
  webMaxReqs: number;
  // Weather
  weatherLat: string;
  weatherLon: string;
  weatherLocationName: string;
  // Rhythm (chat batching + memory)
  chatBatchIdleMs: number;
  chatBatchStepMs: number;
  chatBatchMaxMs: number;
  memoryContextDays: number;
  memoryLimit: number;
  memorySummaryCron: string;
  // System
  timezone: string;
  dataDir: string;
  port: number;
  autoRestartOnSave: boolean;
  webAuthPassword: string;
}

export interface SectionProps {
  form: Form;
  set: <K extends keyof Form>(k: K, v: Form[K]) => void;
  values: SetupValues;
  toast: (text: string, tone?: Tone) => void;
}

export function formFromValues(v: SetupValues): Form {
  return {
    name: v.name,
    owner: v.owner,
    preset: v.preset || "companion",
    persona: v.persona,
    provider: v.provider,
    model: v.model,
    ollamaUrl: v.ollamaUrl,
    baseUrl: v.baseUrl,
    apiKey: "",
    temperature: v.temperature,
    numCtx: v.numCtx,
    maxTokens: v.maxTokens,
    think: v.think || "false",
    timeoutMs: v.timeoutMs,
    historyLimit: v.historyLimit,
    telegramToken: "",
    telegramAllowedIds: v.telegramAllowedIds,
    telegramReplySplit: v.telegramReplySplit,
    sttProvider: v.sttProvider,
    sttApiUrl: v.sttApiUrl,
    sttApiKey: "",
    sttModel: v.sttModel,
    sttLocalModel: v.sttLocalModel,
    sttLanguage: v.sttLanguage,
    webEnabled: v.webEnabled,
    webSearchProvider: v.webSearchProvider,
    tavilyKey: "",
    webSteps: v.webSteps,
    webResults: v.webResults,
    webPageChars: v.webPageChars,
    webSearchTimeoutMs: v.webSearchTimeoutMs,
    webFetchTimeoutMs: v.webFetchTimeoutMs,
    webMaxReqs: v.webMaxReqs,
    weatherLat: v.weatherLat,
    weatherLon: v.weatherLon,
    weatherLocationName: v.weatherLocationName,
    chatBatchIdleMs: v.chatBatchIdleMs,
    chatBatchStepMs: v.chatBatchStepMs,
    chatBatchMaxMs: v.chatBatchMaxMs,
    memoryContextDays: v.memoryContextDays,
    memoryLimit: v.memoryLimit,
    memorySummaryCron: v.memorySummaryCron,
    timezone: v.timezone,
    dataDir: v.dataDir,
    port: v.port,
    autoRestartOnSave: v.autoRestartOnSave,
    webAuthPassword: "",
  };
}

const s = (n: number | string) => String(n);
const b = (x: boolean) => (x ? "true" : "false");

/** Serialize the whole form to the /api/setup body. Blank secrets are sent as
 *  empty strings, which the server leaves untouched (never wiping a saved one). */
export function bodyFromForm(f: Form): Record<string, string> {
  return {
    name: f.name,
    owner: f.owner,
    preset: f.preset,
    persona: f.persona,
    provider: f.provider,
    model: f.model,
    ollamaUrl: f.ollamaUrl,
    baseUrl: f.baseUrl,
    apiKey: f.apiKey,
    temperature: s(f.temperature),
    numCtx: s(f.numCtx),
    maxTokens: s(f.maxTokens),
    think: f.think,
    timeoutMs: s(f.timeoutMs),
    historyLimit: s(f.historyLimit),
    telegramToken: f.telegramToken,
    telegramAllowedIds: f.telegramAllowedIds,
    telegramReplySplit: b(f.telegramReplySplit),
    sttProvider: f.sttProvider,
    sttApiUrl: f.sttApiUrl,
    sttApiKey: f.sttApiKey,
    sttModel: f.sttModel,
    sttLocalModel: f.sttLocalModel,
    sttLanguage: f.sttLanguage,
    webEnabled: b(f.webEnabled),
    webSearchProvider: f.webSearchProvider,
    tavilyKey: f.tavilyKey,
    webSteps: s(f.webSteps),
    webResults: s(f.webResults),
    webPageChars: s(f.webPageChars),
    webSearchTimeoutMs: s(f.webSearchTimeoutMs),
    webFetchTimeoutMs: s(f.webFetchTimeoutMs),
    webMaxReqs: s(f.webMaxReqs),
    weatherLat: f.weatherLat,
    weatherLon: f.weatherLon,
    weatherLocationName: f.weatherLocationName,
    chatBatchIdleMs: s(f.chatBatchIdleMs),
    chatBatchStepMs: s(f.chatBatchStepMs),
    chatBatchMaxMs: s(f.chatBatchMaxMs),
    memoryContextDays: s(f.memoryContextDays),
    memoryLimit: s(f.memoryLimit),
    memorySummaryCron: f.memorySummaryCron,
    timezone: f.timezone,
    dataDir: f.dataDir,
    port: s(f.port),
    autoRestartOnSave: b(f.autoRestartOnSave),
    webAuthPassword: f.webAuthPassword,
  };
}

/** Just the fields the live model-connection test needs. */
export function testBodyFromForm(f: Form): Record<string, string> {
  return {
    provider: f.provider,
    model: f.model,
    ollamaUrl: f.ollamaUrl,
    baseUrl: f.baseUrl,
    apiKey: f.apiKey,
  };
}
