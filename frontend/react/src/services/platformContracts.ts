export type CommandState = 'QUEUED' | 'SENT' | 'GATEWAY_RECEIVED' | 'DEVICE_CONFIRMED' | 'REJECTED' | 'EXPIRED';
export interface GatewayRecord { id: number; node_id: string; site_id: number; active: boolean; credential_version: number; credentials_installed: boolean }
export interface DiscoveryRecord { id: number; gateway_id: number; hardware_id: string; sender_id: string; last_seen: string; version: number }
export interface CommandRecord { id: string; node_id: string; gateway_id: number; kind: 'PROVISION' | 'DIAGNOSTIC'; state: CommandState; expires_at: string }
export interface DiagnosticDevice { node_id: string; hardware_id: string | null; version: number; role: string }
export interface GatewaysResponse { gateways: GatewayRecord[]; discoveries: DiscoveryRecord[]; commands: CommandRecord[]; devices: DiagnosticDevice[] }
export interface GatewayMutationResult { gateway_id?: number; node_id?: string; credentials_installed?: boolean; status?: string; notice?: string }
export interface CommandMutationResult { command_id: string; state: CommandState }
