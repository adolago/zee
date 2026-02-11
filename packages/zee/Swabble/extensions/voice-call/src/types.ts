/**
 * Voice Call Extension Types
 */

export type VoiceCallProvider = "twilio" | "telnyx" | "plivo" | "mock";

export interface VoiceCallConfig {
  provider: VoiceCallProvider;
  fromNumber: string;
  
  // Twilio config
  twilio?: {
    accountSid: string;
    authToken: string;
  };
  
  // Telnyx config
  telnyx?: {
    apiKey: string;
    connectionId?: string;
  };
  
  // Plivo config
  plivo?: {
    authId: string;
    authToken: string;
  };
  
  // Webhook config (for incoming calls)
  webhookUrl?: string;
  
  // TTS config for voice
  tts?: {
    provider: "elevenlabs" | "openai" | "edge";
    voiceId?: string;
    modelId?: string;
  };
}

export interface VoiceCall {
  callId: string;
  providerCallId?: string;
  provider: VoiceCallProvider;
  from: string;
  to: string;
  status: VoiceCallStatus;
  direction: "inbound" | "outbound";
  createdAt: Date;
  answeredAt?: Date;
  endedAt?: Date;
  duration?: number; // seconds
  transcript?: string;
  recordingUrl?: string;
}

export type VoiceCallStatus = 
  | "initiating"
  | "ringing"
  | "in-progress"
  | "completed"
  | "busy"
  | "failed"
  | "no-answer"
  | "canceled";

export interface InitiateCallRequest {
  to: string;
  from?: string;
  message?: string;
  webhookUrl?: string;
  record?: boolean;
}

export interface InitiateCallResponse {
  callId: string;
  providerCallId: string;
  status: VoiceCallStatus;
}

export interface CallStatusResponse {
  callId: string;
  providerCallId: string;
  status: VoiceCallStatus;
  duration?: number;
  transcript?: string;
}

export interface SpeakRequest {
  callId: string;
  message: string;
  voice?: string;
}

export interface VoiceCallProviderInterface {
  readonly name: VoiceCallProvider;
  
  initiateCall(request: InitiateCallRequest): Promise<InitiateCallResponse>;
  endCall(callId: string): Promise<void>;
  getCallStatus(callId: string): Promise<CallStatusResponse>;
  speak(request: SpeakRequest): Promise<void>;
  
  // Webhook handlers for async events
  handleWebhook?(payload: unknown): Promise<void>;
}

// Runtime state
export interface VoiceCallRuntime {
  config: VoiceCallConfig;
  provider: VoiceCallProviderInterface;
  activeCalls: Map<string, VoiceCall>;
  callHistory: VoiceCall[];
}
