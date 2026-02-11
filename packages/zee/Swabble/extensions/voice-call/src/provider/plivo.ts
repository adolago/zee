/**
 * Plivo Voice Call Provider
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

interface PlivoCallResponse {
  api_id: string;
  message: string;
  request_uuid: string;
}

interface PlivoCallDetails {
  api_id: string;
  call_uuid: string;
  from_number: string;
  to_number: string;
  call_status: string;
  call_duration?: number;
  total_amount?: string;
  answer_time?: string;
  end_time?: string;
}

export class PlivoProvider implements VoiceCallProviderInterface {
  readonly name = "plivo" as const;
  private config: NonNullable<VoiceCallConfig["plivo"]>;
  private fromNumber: string;
  private baseUrl = "https://api.plivo.com/v1";

  constructor(config: VoiceCallConfig) {
    if (!config.plivo?.authId || !config.plivo?.authToken) {
      throw new Error("Plivo requires authId and authToken");
    }
    this.config = config.plivo;
    this.fromNumber = config.fromNumber;
  }

  private get auth(): string {
    return Buffer.from(`${this.config.authId}:${this.config.authToken}`).toString("base64");
  }

  private async apiCall<T>(path: string, method: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}/Account/${this.config.authId}${path}`;
    
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Basic ${this.auth}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Plivo API error (${response.status}): ${error}`);
    }

    return await response.json() as T;
  }

  async initiateCall(request: InitiateCallRequest): Promise<InitiateCallResponse> {
    const body: Record<string, unknown> = {
      from: this.fromNumber,
      to: request.to,
      answer_url: request.webhookUrl || this.buildAnswerUrl(request.message),
      hangup_url: request.webhookUrl,
      fallback_url: request.webhookUrl,
    };

    if (request.record) {
      body.record = true;
      body.record_url = request.webhookUrl;
    }

    const result = await this.apiCall<PlivoCallResponse>("/Call/", "POST", body);

    return {
      callId: result.request_uuid,
      providerCallId: result.request_uuid,
      status: "initiating",
    };
  }

  async endCall(callId: string): Promise<void> {
    await this.apiCall(`/Call/${callId}/`, "DELETE");
  }

  async getCallStatus(callId: string): Promise<CallStatusResponse> {
    const result = await this.apiCall<PlivoCallDetails>(`/Call/${callId}/`, "GET");

    return {
      callId: result.call_uuid,
      providerCallId: result.call_uuid,
      status: this.mapStatus(result.call_status),
      duration: result.call_duration,
    };
  }

  async speak(request: SpeakRequest): Promise<void> {
    await this.apiCall(`/Call/${request.callId}/Speak/`, "POST", {
      text: request.message,
      voice: "WOMAN", // or MAN
      language: "en-US",
    });
  }

  private buildAnswerUrl(message?: string): string {
    // In production, you'd have a proper URL that returns Plivo XML
    // For now, return a placeholder
    return "https://example.com/plivo/answer";
  }

  private mapStatus(plivoStatus: string): VoiceCallStatus {
    const statusMap: Record<string, VoiceCallStatus> = {
      ringing: "ringing",
      in_progress: "in-progress",
      completed: "completed",
      busy: "busy",
      failed: "failed",
      no_answer: "no-answer",
      canceled: "canceled",
      queued: "initiating",
    };
    return statusMap[plivoStatus] || "failed";
  }

  // Webhook handler for call events
  handleWebhook(payload: Record<string, unknown>): { callId: string; status: VoiceCallStatus; recordingUrl?: string } {
    return {
      callId: (payload.CallUUID || payload.call_uuid) as string,
      status: this.mapStatus((payload.CallStatus || payload.call_status) as string),
      recordingUrl: payload.RecordingUrl as string,
    };
  }
}
