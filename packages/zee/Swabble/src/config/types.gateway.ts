export type GatewayAuthRateLimitConfig = {
  enabled?: boolean;
  windowMs?: number;
  maxAttemptsPerIp?: number;
  maxAttemptsPerToken?: number;
  lockoutMs?: number;
};

export type GatewayControlUiAuthMode = "token" | "password" | "none";

export type GatewayControlUiAuthConfig = {
  required?: boolean;
  mode?: GatewayControlUiAuthMode;
  allowPasswordOnly?: boolean;
  allowInsecureHttp?: boolean;
  breakGlassAck?: string;
};

export type GatewayControlUiConfig = {
  auth?: GatewayControlUiAuthConfig;
  trustedOrigins?: string[];
};

export type GatewayChannelActionPackConfig = {
  enabled?: boolean;
  messageActions?: boolean;
  moderationActions?: boolean;
  metadataActions?: boolean;
};

export type GatewayNodeClientSecurityMode = "deny" | "allowlist" | "full";

export type GatewayNodeClientConfig = {
  enabled?: boolean;
  securityMode?: GatewayNodeClientSecurityMode;
  allowRemotePairing?: boolean;
  toolAllowlist?: string[];
  maxPairedNodes?: number;
};

export type GatewayConfig = {
  controlUi?: GatewayControlUiConfig;
  nodeClient?: GatewayNodeClientConfig;
  actionPacks?: {
    telegram?: GatewayChannelActionPackConfig;
    [channel: string]: GatewayChannelActionPackConfig | undefined;
  };
  authRateLimit?: GatewayAuthRateLimitConfig;
};
