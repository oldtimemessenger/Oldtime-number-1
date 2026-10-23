import { Router, type IRouter } from "express";
import { ExchangeCognitoSessionBody } from "@workspace/api-zod";
import { cognitoConfig, CognitoError, exchangeCognitoCode } from "../lib/cognito";
import { createCognitoAccountSession } from "../lib/cognito-accounts";
import { createRateLimiter, getAuthContext, requireAuth } from "../lib/auth";

const router: IRouter = Router();
router.get("/auth/cognito/config", (_req, res) => {
  try {
    const config = cognitoConfig();
    if (!config) { res.json({ enabled: false }); return; }
    res.json({ enabled: true, clientId: config.clientId,
      authorizationEndpoint: `${config.domain}/oauth2/authorize`,
      logoutEndpoint: `${config.domain}/logout`, scope: "openid email",
      redirectUris: config.redirectUris });
  } catch (error) {
    if (error instanceof CognitoError) { res.status(error.status).json({ error: error.message }); return; }
    throw error;
  }
});
router.post("/auth/cognito/exchange", createRateLimiter("cognito-exchange", 10),
  async (req, res, next) => {
    if (req.body?.intent === "link") { await requireAuth(req, res, next); return; }
    next();
  }, async (req, res): Promise<void> => {
    const parsed = ExchangeCognitoSessionBody.strict().safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "The sign-in request is invalid. Start again." }); return; }
    try {
      const config = cognitoConfig();
      if (!config) throw new CognitoError(503, "Secure sign-in is unavailable.");
      const identity = await exchangeCognitoCode(config, parsed.data);
      const owner = parsed.data.intent === "link" ? getAuthContext(res).userId : undefined;
      res.json(await createCognitoAccountSession(identity, owner));
    } catch (error) {
      if (error instanceof CognitoError) { res.status(error.status).json({ error: error.message }); return; }
      throw error;
    }
  });
export default router;
