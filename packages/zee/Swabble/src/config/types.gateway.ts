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

export type GatewayConfig = {
  controlUi?: GatewayControlUiConfig;
  authRateLimit?: GatewayAuthRateLimitConfig;
};
