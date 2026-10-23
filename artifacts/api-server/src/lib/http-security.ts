import express, { type ErrorRequestHandler, type Express } from "express";
import cors from "cors";
import helmet from "helmet";

type SecurityOptions = {
  production?: boolean;
  allowedOrigins?: ReadonlySet<string>;
};

export function applyHttpSecurity(app: Express, options: SecurityOptions = {}) {
  const production = options.production ?? process.env.NODE_ENV === "production";
  const allowedOrigins = options.allowedOrigins ?? new Set(
    (process.env.CORS_ALLOWED_ORIGINS ?? "").split(",").map(value => value.trim()).filter(Boolean),
  );

  app.disable("x-powered-by");
  app.use(helmet({
    // This service serves JSON and authorized media, not the application's HTML.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "same-site" },
  }));
  app.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use(cors({
    origin: (origin, callback) => callback(null,
      Boolean(origin && (!production || allowedOrigins.has(origin)))),
    credentials: false,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "Idempotency-Key"],
  }));
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false, limit: "32kb" }));
}

export function publicApiErrorHandler(report: (errorType: string) => void): ErrorRequestHandler {
  return (failure, _req, res, next) => {
    if (res.headersSent) { next(failure); return; }
    const status = Number.isInteger(failure?.status) && failure.status >= 400 && failure.status < 500
      ? failure.status : 500;
    // Error messages, stacks and database parameters can contain credentials or
    // personal data. Log only the error class, never the untrusted error object.
    if (status === 500) report(failure instanceof Error ? failure.name : "UnknownError");
    res.status(status).json({
      error: status === 413 ? "Request is too large."
        : status < 500 ? "Invalid request."
        : "The service could not complete this request. Please try again.",
    });
  };
}
