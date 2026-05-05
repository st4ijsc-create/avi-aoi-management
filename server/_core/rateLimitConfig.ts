import rateLimit from "express-rate-limit";

export const API_RATE_LIMIT = {
  windowMs: 60 * 1000,
  max: 100,
};

export const AUTH_RATE_LIMIT = {
  windowMs: 15 * 60 * 1000,
  max: 30,
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
