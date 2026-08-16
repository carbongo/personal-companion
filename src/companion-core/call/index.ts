/**
 * The call engine's public surface — everything a transport (or a test) needs,
 * and nothing about how any particular transport works. A channel adapter should
 * be able to import from here alone: if it needs to reach past this file into an
 * internal, that is a sign the seam is in the wrong place.
 *
 * See docs/decisions/discord-voice-calls.md.
 */

export { isBackchannelOnly } from "./backchannel.ts";
export {
	createHeuristicEndpointer,
	type EndpointDecision,
	type Endpointer,
	type HeuristicEndpointerOptions,
} from "./endpointing.ts";
export {
	type FramingOptions,
	type UtteranceEvent,
	UtteranceFramer,
} from "./framing.ts";
export { isLikelyHallucination } from "./hallucination-gate.ts";
export {
	CallAudioResampler,
	Decimator48to16,
	downmixToMono,
	ENGINE_SAMPLE_RATE,
	FrameAccumulator,
	VAD_FRAME_SIZE,
} from "./resample.ts";
export {
	CallSession,
	type CallSessionDeps,
	type CallSessionOptions,
	type CallState,
	detectAudioFormat,
	encodeWav,
	FRAME_MS,
	startCallSession,
} from "./session.ts";
export type {
	AudioFormat,
	CallTransport,
	PcmFrame,
	PlaybackResult,
	VoiceActivityDetector,
} from "./types.ts";
export {
	createVad,
	EnergyVad,
	SileroVad,
	type VadOptions,
	type VadProviderName,
} from "./vad.ts";
