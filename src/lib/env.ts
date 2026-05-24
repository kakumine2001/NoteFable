export function requireEnv(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is not configured.`);
  }

  return value;
}

export function optionalEnv(name: string) {
  const value = process.env[name]?.trim();
  return value || undefined;
}

export function getCookieSecret() {
  const secret = optionalEnv("COOKIE_SECRET");

  if (secret) {
    return secret;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("COOKIE_SECRET is not configured.");
  }

  return "studymate-dev-cookie-secret";
}
