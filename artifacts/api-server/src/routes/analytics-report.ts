import { Router, type IRouter } from "express";
import { requireAuth,getAuthContext } from "../lib/auth";
import { accountTools } from "../lib/account-professional";
import { reportRange,dashboardReport,contentReport } from "../lib/analytics-report";
const router:IRouter=Router();
router.get("/analytics/me",requireAuth,async(req,res)=>{
  const owner=getAuthContext(res).userId,tools=await accountTools(owner),mode=String(req.query.mode||"personal");
  if(!["personal","creator","business"].includes(mode)||mode!=="personal"&&tools.accountType!==mode){
    res.status(403).json({error:"This dashboard is not available for your account type."});return;
  }
  const range=reportRange(req.query.from,req.query.to);
  if(!range){res.status(400).json({error:"Choose an actual past/current date range of 1–90 days."});return;}
  res.setHeader("Cache-Control","no-store");
  res.json(await dashboardReport(owner,tools.accountType,range,{...req.query,mode}));
});
router.get("/analytics/content/:id",requireAuth,async(req,res)=>{
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(req.params.id))){res.status(400).json({error:"Invalid content ID."});return;}
  const range=reportRange(req.query.from,req.query.to);
  if(!range){res.status(400).json({error:"Choose a valid range of 1–90 days."});return;}
  const r=await contentReport(getAuthContext(res).userId,String(req.params.id),range.from,range.to);
  if(!r){res.status(404).json({error:"Content not found."});return;}
  res.setHeader("Cache-Control","no-store");res.json(r);
});
export default router;
