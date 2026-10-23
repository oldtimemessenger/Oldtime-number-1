import express, { type Express } from "express";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { applyHttpSecurity, publicApiErrorHandler } from "./lib/http-security";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
applyHttpSecurity(app);

app.use("/api", router);
app.use(publicApiErrorHandler(errorType => {
  logger.error({ errorType }, "API request failed");
}));

export default app;
