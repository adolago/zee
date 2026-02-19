export type GatewayAuthRateLimitConfig = {
  enabled?: boolean;
  windowMs?: number;
  maxAttemptsPerIp?: number;
  maxAttemptsPerToken?: number;
  lockoutMs?: number;
};

