import rateLimit from "express-rate-limit";

const envInt = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const API_PER_MIN = envInt("RATE_LIMIT_PER_MINUTE", 300);
const AUTH_PER_15MIN = envInt("AUTH_RATE_LIMIT_PER_15MIN", 30);

export const API_RATE_LIMIT = {
  windowMs: 60 * 1000,
  max: API_PER_MIN,
};

export const AUTH_RATE_LIMIT = {
  windowMs: 15 * 60 * 1000,
  max: AUTH_PER_15MIN,
};

export function createApiLimiter() {
  return rateLimit({
    ...API_RATE_LIMIT,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later" },
  });
}

export function createAuthLimiter() {
  return rateLimit({
    ...AUTH_RATE_LIMIT,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many login attempts, please try again later" },
  });
}
