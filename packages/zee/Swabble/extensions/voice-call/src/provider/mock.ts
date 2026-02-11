/**
 * Mock Voice Call Provider
 * 
 * For development and testing without real phone calls.
 */

import type {
  VoiceCallProviderInterface,
  InitiateCallRequest,
  InitiateCallResponse,
  CallStatusResponse,
  SpeakRequest,
  VoiceCallStatus,
} from "../types.js";

export class MockProvider implements VoiceCallProviderInterface {
  readonly name = "mock" as const;
  private calls = new Map<string, MockCall>();
  private callCounter = 0;

  async initiateCall(request: InitiateCallRequest): Promise<InitiateCallResponse> {
    this.callCounter++;
    const callId = `mock-${Date.now()}-${this.callCounter}`;
    const providerCallId = `CA${Date.now()}${this.callCounter}`;
    
    const mockCall: MockCall = {
      callId,
      providerCallId,
      to: request.to,
      from: request.from || "+15550000000",
      status: "initiating",
      createdAt: new Date(),
      message: request.message,
    };

    this.calls.set(callId, mockCall);

    // Simulate call progression
    setTimeout(() => {
      mockCall.status = "ringing";
    }, 500);

    setTimeout(() => {
      mockCall.status = "in-progress";
      mockCall.answeredAt = new Date();
    }, 2000);

    return {
      callId,
      providerCallId,
      status: "initiating",
    };
  }

  async endCall(callId: string): Promise<void> {
    const call = this.calls.get(callId);
    if (!call) {
      throw new Error(`Call not found: ${callId}`);
    }

    call.status = "completed";
    call.endedAt = new Date();
    
    if (call.answeredAt) {
      call.duration = Math.floor((call.endedAt.getTime() - call.answeredAt.getTime()) / 1000);
    }
  }

  async getCallStatus(callId: string): Promise<CallStatusResponse> {
    const call = this.calls.get(callId);
    if (!call) {
      throw new Error(`Call not found: ${callId}`);
    }

    return {
      callId,
      providerCallId: call.providerCallId,
      status: call.status,
      duration: call.duration,
      transcript: call.transcript,
    };
  }

  async speak(request: SpeakRequest): Promise<void> {
    const call = this.calls.get(request.callId);
    if (!call) {
      throw new Error(`Call not found: ${request.callId}`);
    }

    if (call.status !== "in-progress") {
      throw new Error(`Call is not in progress: ${call.status}`);
    }

    // In mock mode, just accumulate transcript
    const existingTranscript = call.transcript || "";
    call.transcript = existingTranscript + `[AI]: ${request.message}\n`;

    console.log(`[Mock Voice Call ${request.callId}]: ${request.message}`);
  }

  // For testing: simulate user response
  simulateUserResponse(callId: string, message: string): void {
    const call = this.calls.get(callId);
    if (!call) return;

    const existingTranscript = call.transcript || "";
    call.transcript = existingTranscript + `[User]: ${message}\n`;
  }

  // Get all calls (for testing/debugging)
  getAllCalls(): MockCall[] {
    return Array.from(this.calls.values());
  }
}

interface MockCall {
  callId: string;
  providerCallId: string;
  to: string;
  from: string;
  status: VoiceCallStatus;
  createdAt: Date;
  answeredAt?: Date;
  endedAt?: Date;
  duration?: number;
  message?: string;
  transcript?: string;
}
