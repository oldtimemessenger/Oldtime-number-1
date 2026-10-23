import { Router, type IRouter } from "express";
import { UpdateAccountProfessionalBody } from "@workspace/api-zod";
import { pool } from "@workspace/db";
import { requireAuth, getAuthContext } from "../lib/auth";
import { accountTools, creatorCategories, businessCategories } from "../lib/account-professional";
const router: IRouter = Router();
const input = UpdateAccountProfessionalBody.strict().refine(s => !s.website || (() => {
  try { const u=new URL(s.website); return u.protocol==="https:"&&!u.username&&!u.password; } catch { return false; }
})());
router.use("/account/professional", requireAuth);
router.get("/account/professional", async (_req,res) => {
  res.setHeader("Cache-Control","no-store"); res.json(await accountTools(getAuthContext(res).userId));
});
router.put("/account/professional", async (req,res) => {
  const parsed = input.safeParse(req.body);
  if (!parsed.success || parsed.data.accountType === "creator" && !parsed.data.creatorCategory ||
    parsed.data.accountType === "business" && !parsed.data.businessCategory) {
    res.status(400).json({ error: "Choose a valid account type and category. Website must be an ordinary HTTPS URL. Verification, privacy, payments and roles cannot be changed here." }); return;
  }
  const { accountType, ...metadata } = parsed.data;
  // Updates only classification/explicit professional fields. No replacement
  // identity, profile privacy, financial status, approval or roles mutation.
  await pool.query("UPDATE users SET account_type=$2,professional_profile=$3::jsonb WHERE id=$1",
    [getAuthContext(res).userId, accountType, JSON.stringify(metadata)]);
  res.setHeader("Cache-Control","no-store"); res.json(await accountTools(getAuthContext(res).userId));
});
export default router;
