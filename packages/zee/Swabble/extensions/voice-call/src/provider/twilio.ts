/**
 * Twilio Voice Call Provider
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

interface TwilioCallResponse {
  sid: string;
  status: string;
  from: string;
  to: string;
  date_created: string;
  date_updated?: string;
  start_time?: string;
  end_time?: string;
  duration?: string;
}

export class TwilioProvider implements VoiceCallProviderInterface {
  readonly name = "twilio" as const;
  private config: NonNullable<VoiceCallConfig["twilio"]>;
  private fromNumber: string;
  private baseUrl = "https://api.twilio.com/2010-04-01";

  constructor(config: VoiceCallConfig) {
    if (!config.twilio?.accountSid || !config.twilio?.authToken) {
      throw new Error("Twilio requires accountSid and authToken");
    }
    this.config = config.twilio;
    this.fromNumber = config.fromNumber;
  }

  private get auth(): string {
    return Buffer.from(`${this.config.accountSid}:${this.config.authToken}`).toString("base64");
  }

  private async apiCall<T>(path: string, method: string, body?: URLSearchParams): Promise<T> {
    const url = `${this.baseUrl}/Accounts/${this.config.accountSid}${path}`;
    
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Basic ${this.auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body?.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Twilio API error (${response.status}): ${error}`);
    }

    return await response.json() as T;
  }

  async initiateCall(request: InitiateCallRequest): Promise<InitiateCallResponse> {
    const params = new URLSearchParams({
      To: request.to,
      From: request.from || this.fromNumber,
      Twiml: this.buildTwiml(request.message),
    });

    if (request.record) {
      params.append("Record", "true");
    }

    // Status callback webhook
    if (request.webhookUrl) {
      params.append("StatusCallback", request.webhookUrl);
      params.append("StatusCallbackEvent", "initiated ringing answered completed");
    }

    const result = await this.apiCall<TwilioCallResponse>("/Calls.json", "POST", params);

    return {
      callId: result.sid,
      providerCallId: result.sid,
      status: this.mapStatus(result.status),
    };
  }

  async endCall(callId: string): Promise<void> {
    const params = new URLSearchParams({
      Status: "completed",
    });
    await this.apiCall<TwilioCallResponse>(`/Calls/${callId}.json", "POST", params);
  }

  async getCallStatus(callId: string): Promise<CallStatusResponse> {
    const result = await this.apiCall<TwilioCallResponse>(`/Calls/${callId}.json", "GET");

    return {
      callId: result.sid,
      providerCallId: result.sid,
      status: this.mapStatus(result.status),
      duration: result.duration ? parseInt(result.duration, 10) : undefined,
    };
  }

  async speak(request: SpeakRequest): Promise<void> {
    // For Twilio, we use the update API to modify the live call with new TwiML
    const params = new URLSearchParams({
      Twiml: this.buildSpeakTwiml(request.message),
    });

    await this.apiCall<TwilioCallResponse>(`/Calls/${request.callId}.json", "POST", params);
  }

  private buildTwiml(message?: string): string {
    if (!message) {
      return "<Response><Pause length="60"/></Response>";
    }
    // Escape XML special characters
    const escaped = message
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
    
    return `<Response><Say>${escaped}</Say><Pause length="5"/><Gather input="speech" speechTimeout="auto"/></Response>`;
  }

  private buildSpeakTwiml(message: string): string {
    const escaped = message
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
    
    return `<Response><Say>${escaped}</Say></Response>`;
  }

  private mapStatus(twilioStatus: string): VoiceCallStatus {
    const statusMap: Record<string, VoiceCallStatus> = {
      queued: "initiating",
      ringing: "ringing",
      in_progress: "in-progress",
      completed: "completed",
      busy: "busy",
      failed: "failed",
      no_answer: "no-answer",
      canceled: "canceled",
    };
    return statusMap[twilioStatus] || "failed";
  }

  // Webhook handler for status callbacks
  handleWebhook(payload: Record<string, string>): { callId: string; status: VoiceCallStatus; recordingUrl?: string } {
    return {
      callId: payload.CallSid,
      status: this.mapStatus(payload.CallStatus),
      recordingUrl: payload.RecordingUrl,
    };
  }
}
