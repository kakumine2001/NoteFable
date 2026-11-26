import { optionalEnv } from "@/lib/env";

export const IOS_BUNDLE_ID = "com.kakumine.notefable";

export function appleIdentityConfig() {
  const secret = optionalEnv("AUTH_SECRET");
  const team = optionalEnv("AUTH_APPLE_TEAM_ID");
  const keyId = optionalEnv("AUTH_APPLE_KEY_ID");
  const key = optionalEnv("AUTH_APPLE_KEY_P8_B64");
  return secret && team && keyId && key ? { secret, team, keyId, key } : null;
}

export function isAppleLoginConfigured() {
  return Boolean(appleIdentityConfig());
}
