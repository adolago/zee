/**
 * Shared gateway supervisor state.
 *
 * This module provides a lightweight state container that both the daemon
 * (GatewaySupervisor) and server routes can access without pulling in
 * CLI dependencies. The daemon writes state here; routes read it.
 */

export interface GatewayHealthState {
  running: boolean
  enabled: boolean
  error?: string
}

let current: GatewayHealthState = { running: false, enabled: false }

export function getGatewayHealthState(): GatewayHealthState {
  return { ...current }
}

export function setGatewayHealthState(state: GatewayHealthState): void {
  current = { ...state }
}
