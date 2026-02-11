/**
 * Voice Call Runtime
 */

import type {
  VoiceCallConfig,
  VoiceCall,
  InitiateCallRequest,
  InitiateCallResponse,
  CallStatusResponse,
  SpeakRequest,
  VoiceCallStatus,
} from "./types.js";
import { createProvider } from "./provider/index.js";
import type { VoiceCallProviderInterface } from "./types.js";

export class VoiceCallRuntime {
  private config: VoiceCallConfig;
  private provider: VoiceCallProviderInterface;
  private activeCalls = new Map<string, VoiceCall>();
  private callHistory: VoiceCall[] = [];
  private maxHistory = 100;

  constructor(config: VoiceCallConfig) {
    this.config = config;
    this.provider = createProvider(config);
  }

  /**
   * Initiate a new voice call
   */
  async initiateCall(request: InitiateCallRequest): Promise<InitiateCallResponse> {
    const response = await this.provider.initiateCall(request);

    const call: VoiceCall = {
      callId: response.callId,
      providerCallId: response.providerCallId,
      provider: this.config.provider,
      from: this.config.fromNumber,
      to: request.to,
      status: response.status,
      direction: "outbound",
      createdAt: new Date(),
    };

    this.activeCalls.set(response.callId, call);
    this.addToHistory(call);

    return response;
  }

  /**
   * End an active call
   */
  async endCall(callId: string): Promise<void> {
    await this.provider.endCall(callId);

    const call = this.activeCalls.get(callId);
    if (call) {
      call.status = "completed";
      call.endedAt = new Date();
      this.activeCalls.delete(callId);
    }
  }

  /**
   * Get call status
   */
  async getCallStatus(callId: string): Promise<CallStatusResponse> {
    const status = await this.provider.getCallStatus(callId);

    // Update local call record
    const call = this.activeCalls.get(callId);
    if (call) {
      call.status = status.status;
      if (status.duration) {
        call.duration = status.duration;
      }
    }

    return status;
  }

  /**
   * Speak a message during an active call
   */
  async speak(request: SpeakRequest): Promise<void> {
    const call = this.activeCalls.get(request.callId);
    if (!call) {
      throw new Error(`Call not found: ${request.callId}`);
    }

    if (call.status !== "in-progress") {
      throw new Error(`Call is not in progress: ${call.status}`);
    }

    await this.provider.speak(request);

    // Update transcript
    const transcript = call.transcript || "";
    call.transcript = transcript + `[AI]: ${request.message}\n`;
  }

  /**
   * Continue a call with a new message (alias for speak)
   */
  async continueCall(callId: string, message: string): Promise<void> {
    await this.speak({ callId, message });
  }

  /**
   * Get an active call by ID
   */
  getCall(callId: string): VoiceCall | undefined {
    return this.activeCalls.get(callId);
  }

  /**
   * Get a call by provider call ID
   */
  getCallByProviderCallId(providerCallId: string): VoiceCall | undefined {
    for (const call of this.activeCalls.values()) {
      if (call.providerCallId === providerCallId) {
        return call;
      }
    }
    // Also check history
    return this.callHistory.find(c => c.providerCallId === providerCallId);
  }

  /**
   * Get all active calls
   */
  getActiveCalls(): VoiceCall[] {
    return Array.from(this.activeCalls.values());
  }

  /**
   * Get call history
   */
  getCallHistory(): VoiceCall[] {
    return [...this.callHistory];
  }

  /**
   * Handle webhook from provider
   */
  async handleWebhook(payload: Record<string, unknown>): Promise<void> {
    if (!this.provider.handleWebhook) {
      return;
    }

    const result = this.provider.handleWebhook(payload);
    if (!result) return;

    const { callId, status, recordingUrl } = result;

    // Update active call
    const call = this.activeCalls.get(callId);
    if (call) {
      call.status = status;
      if (recordingUrl) {
        call.recordingUrl = recordingUrl;
      }

      // If call ended, move to history
      if (["completed", "busy", "failed", "no-answer", "canceled"].includes(status)) {
        call.endedAt = new Date();
        this.activeCalls.delete(callId);
      }
    }
  }

  /**
   * Stop the runtime and clean up
   */
  async stop(): Promise<void> {
    // End all active calls
    const endPromises = Array.from(this.activeCalls.keys()).map(id => 
      this.endCall(id).catch(() => {})
    );
    await Promise.all(endPromises);
    this.activeCalls.clear();
  }

  private addToHistory(call: VoiceCall): void {
    this.callHistory.unshift(call);
    if (this.callHistory.length > this.maxHistory) {
      this.callHistory.pop();
    }
  }
}

// Singleton runtime instance
let runtime: VoiceCallRuntime | null = null;

export function initializeVoiceCallRuntime(config: VoiceCallConfig): VoiceCallRuntime {
  runtime = new VoiceCallRuntime(config);
  return runtime;
}

export function getVoiceCallRuntime(): VoiceCallRuntime {
  if (!runtime) {
    throw new Error("Voice call runtime not initialized");
  }
  return runtime;
}

export function stopVoiceCallRuntime(): Promise<void> {
  if (!runtime) {
    return Promise.resolve();
  }
  return runtime.stop();
}
