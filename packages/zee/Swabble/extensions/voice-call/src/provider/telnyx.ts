/**
 * Telnyx Voice Call Provider
 */

import type {
  VoiceCallProviderInterface,
  InitiateCallRequest,
  InitiateCallResponse,
  CallStatusResponse,
  SpeakRequest,
  VoiceCallConfig,
  VoiceCallStatus,
} from "../types.js";

interface TelnyxCallResponse {
  data: {
    id: string;
    call_control_id: string;
    connection_id: string;
    call_leg_id: string;
    call_session_id: string;
    state: string;
    from: string;
    to: string;
    created_at: string;
    answered_at?: string;
    ended_at?: string;
    duration?: number;
  };
}

export class TelnyxProvider implements VoiceCallProviderInterface {
  readonly name = "telnyx" as const;
  private config: NonNullable<VoiceCallConfig["telnyx"]>;
  private fromNumber: string;
  private baseUrl = "https://api.telnyx.com/v2";

  constructor(config: VoiceCallConfig) {
    if (!config.telnyx?.apiKey) {
      throw new Error("Telnyx requires apiKey");
    }
    this.config = config.telnyx;
    this.fromNumber = config.fromNumber;
  }

  private async apiCall<T>(path: string, method: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Telnyx API error (${response.status}): ${error}`);
    }

    return await response.json() as T;
  }

  async initiateCall(request: InitiateCallRequest): Promise<InitiateCallResponse> {
    const body: Record<string, unknown> = {
      to: request.to,
      from: this.fromNumber,
      connection_id: this.config.connectionId,
      audio_url: request.message ? undefined : undefined, // Would need TTS URL
    };

    // Use text-to-speech if message provided
    if (request.message) {
      body.tts = {
        text: request.message,
        voice: "female", // Default
        language: "en-US",
      };
    }

    // Webhook for call control
    if (request.webhookUrl) {
      body.webhook_url = request.webhookUrl;
    }

    const result = await this.apiCall<TelnyxCallResponse>("/calls", "POST", body);

    return {
      callId: result.data.call_control_id,
      providerCallId: result.data.id,
      status: this.mapStatus(result.data.state),
    };
  }

  async endCall(callId: string): Promise<void> {
    await this.apiCall(`/calls/${callId}/actions/hangup`, "POST", {});
  }

  async getCallStatus(callId: string): Promise<CallStatusResponse> {
    const result = await this.apiCall<TelnyxCallResponse>(`/calls/${callId}`, "GET");

    return {
      callId: result.data.call_control_id,
      providerCallId: result.data.id,
      status: this.mapStatus(result.data.state),
      duration: result.data.duration,
    };
  }

  async speak(request: SpeakRequest): Promise<void> {
    await this.apiCall(`/calls/${request.callId}/actions/speak`, "POST", {
      text: request.message,
      voice: "female",
      language: "en-US",
      payload_type: "tts",
    });
  }

  private mapStatus(telnyxState: string): VoiceCallStatus {
    const statusMap: Record<string, VoiceCallStatus> = {
      initializing: "initiating",
      ringing: "ringing",
      answered: "in-progress",
      bridged: "in-progress",
      parked: "in-progress",
      hanging_up: "completed",
      hung_up: "completed",
      completed: "completed",
      busy: "busy",
      failed: "failed",
      no_answer: "no-answer",
      canceled: "canceled",
    };
    return statusMap[telnyxState] || "failed";
  }

  // Webhook handler for call events
  handleWebhook(payload: Record<string, unknown>): { callId: string; status: VoiceCallStatus; recordingUrl?: string } {
    const data = payload.data as Record<string, unknown> || payload;
    return {
      callId: (data.call_control_id || data.id) as string,
      status: this.mapStatus((data.state || data.event_type) as string),
      recordingUrl: data.recording_url as string,
    };
  }
}
