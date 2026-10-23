import type { RequestHandler } from "express";
import { pool } from "@workspace/db";
import { getAuthContext } from "./auth";
export const creatorCategories = ["Creator","Artist","Musician","Public Figure","Streamer","Writer","Athlete","Community Leader"];
export const businessCategories = ["Business","Local Service","Retail","Restaurant","Brand","Other"];
export async function accountTools(userId: string) {
  const { rows } = await pool.query("SELECT account_type,professional_profile FROM users WHERE id=$1", [userId]);
  if (!rows[0]) throw new Error("Account not found");
  return { accountType: rows[0].account_type, creatorCategory: null, businessCategory: null, website: "", location: "", contact: "", showCategory: true, showContact: false, ...rows[0].professional_profile };
}
export const requireCreatorAccount: RequestHandler = async (_req,res,next) => {
  const profile = await accountTools(getAuthContext(res).userId);
  if (profile.accountType !== "creator") { res.status(403).json({ error: "Creator tools require a Creator account. Switch account type in Settings; switching is free and preserves your account." }); return; }
  next();
};
