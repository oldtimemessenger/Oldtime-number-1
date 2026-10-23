import { Router, type IRouter } from "express";
import { RegisterOwnAnalyticsContentBody,StartAnalyticsViewBody,UpdateAnalyticsPlaybackBody,RecordAnalyticsActivityBody } from "@workspace/api-zod";
import { pool } from "@workspace/db";
import { requireAuth, getAuthContext, createRateLimiter } from "../lib/auth";
import { analyticsTransaction, recordAnalyticsEvent } from "../lib/analytics-events";
const router: IRouter = Router();
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const resourceInput = RegisterOwnAnalyticsContentBody.strict().refine(r=>r.publishedAt>=0&&r.publishedAt<=Date.now()+300000);
router.use("/analytics",requireAuth);
router.post("/analytics/resources",createRateLimiter("analytics-resource",120),async(req,res)=>{
  const parsed=resourceInput.safeParse(req.body);
  if(!parsed.success){res.status(400).json({error:"Invalid content registration."});return;}
  const r=parsed.data,owner=getAuthContext(res).userId;
  const {rows}=await pool.query(`INSERT INTO analytics_resources(owner_id,source_id,kind,title,is_public,duration_ms,published_at)
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(owner_id,source_id) DO UPDATE SET
    title=excluded.title,is_public=excluded.is_public,duration_ms=excluded.duration_ms
    WHERE analytics_resources.deleted_at IS NULL RETURNING id`,
    [owner,r.sourceId,r.kind,r.title,r.isPublic,r.durationMs,new Date(r.publishedAt)]);
  res.json({id:rows[0]?.id||null});
});
router.delete("/analytics/resources/:sourceId",async(req,res)=>{
  await pool.query("UPDATE analytics_resources SET deleted_at=now(),is_public=false WHERE owner_id=$1 AND source_id=$2",
    [getAuthContext(res).userId,String(req.params.sourceId)]);
  res.json({deleted:true});
});
async function resource(owner:string,sourceId:string){
  // Existing persisted public posts are authoritative public resources.
  await pool.query(`INSERT INTO analytics_resources(owner_id,source_id,kind,title,is_public,published_at)
    SELECT author_id,id::text,'text',left(text,100),true,created_at FROM posts WHERE id::text=$2 AND author_id=$1
    ON CONFLICT(owner_id,source_id) DO NOTHING`,[owner,sourceId]);
  const {rows}=await pool.query("SELECT * FROM analytics_resources WHERE owner_id=$1 AND source_id=$2 AND deleted_at IS NULL",[owner,sourceId]);
  return rows[0];
}
router.post("/analytics/sessions",createRateLimiter("analytics-session",120),async(req,res)=>{
  const p=StartAnalyticsViewBody.strict().safeParse(req.body);
  if(!p.success){res.status(400).json({error:"Invalid playback request."});return;}
  const actor=getAuthContext(res).userId,input=p.data;
  if(actor===input.ownerId){res.json({id:null});return;}
  const r=await resource(input.ownerId,input.sourceId);
  if(!r||!r.is_public||r.kind==="story"&&Date.now()-new Date(r.published_at).getTime()>86400000){
    res.status(404).json({error:"Content is not available for shared analytics."});return;
  }
  const {rows}=await pool.query(`INSERT INTO analytics_sessions(resource_id,actor_id,nonce,source) VALUES($1,$2,$3,$4)
    ON CONFLICT(actor_id,nonce) DO UPDATE SET nonce=excluded.nonce WHERE analytics_sessions.resource_id=excluded.resource_id RETURNING id`,[r.id,actor,input.nonce,input.source]);
  if(!rows.length){res.status(409).json({error:"View session nonce already used for another item."});return;}
  res.json({id:rows[0].id});
});
router.put("/analytics/sessions/:id",createRateLimiter("analytics-progress",240),async(req,res)=>{
  const p=UpdateAnalyticsPlaybackBody.strict().safeParse(req.body);
  if(!uuid.test(String(req.params.id))||!p.success){res.status(400).json({error:"Invalid playback progress."});return;}
  const actor=getAuthContext(res).userId;
  const result=await analyticsTransaction(async client=>{
    const {rows}=await client.query(`SELECT s.*,r.owner_id,r.kind,r.duration_ms,r.is_public,r.deleted_at,r.published_at FROM analytics_sessions s
      JOIN analytics_resources r ON r.id=s.resource_id WHERE s.id=$1 AND s.actor_id=$2 FOR UPDATE OF s`,[req.params.id,actor]);
    const s=rows[0];if(!s||!s.is_public||s.deleted_at||s.kind==="story"&&Date.now()-new Date(s.published_at).getTime()>86400000)return null;
    const elapsed=Math.min(600000,Date.now()-new Date(s.started_at).getTime()+300);
    const visible=Math.max(s.visible_ms,Math.min(p.data.visibleMs,elapsed));
    const watched=Math.max(s.watched_ms,Math.min(p.data.watchedMs,visible));
    const video=s.kind==="video"||s.duration_ms!==null||watched>0;
    const threshold=video?Math.min(3000,s.duration_ms||3000):2000;
    const complete=video&&s.duration_ms>0&&p.data.ended&&watched>=s.duration_ms*.95;
    const qualified=video?(watched>=threshold||s.duration_ms<=3000&&complete):visible>=threshold;
    if(qualified&&!s.qualified){
      const bucket=s.kind==="story"?"story":Math.floor(new Date(s.started_at).getTime()/1800000);
      await recordAnalyticsEvent(client,{ownerId:s.owner_id,actorId:actor,resourceId:s.resource_id,kind:"view",source:s.source,dedupKey:`view:${s.resource_id}:${bucket}`});
    }
    // Retention measures watched duration fractions, not guessed playhead positions.
    const progress=video&&s.duration_ms?Math.min(1,watched/s.duration_ms):0;
    await client.query("UPDATE analytics_sessions SET visible_ms=$2,watched_ms=$3,progress=$4,qualified=$5,completed=$6 WHERE id=$1",
      [s.id,visible,watched,progress,qualified||s.qualified,complete||s.completed]);
    return {qualified:qualified||s.qualified};
  });
  if(!result){res.status(404).json({error:"Playback session not available."});return;}res.json(result);
});
router.post("/analytics/events",createRateLimiter("analytics-event",120),async(req,res)=>{
  const p=RecordAnalyticsActivityBody.strict().safeParse(req.body);
  if(!p.success){res.status(400).json({error:"Unsupported activity. Financial events cannot be submitted by clients."});return;}
  const actor=getAuthContext(res).userId,e=p.data;
  if(actor===e.ownerId){res.json({recorded:false});return;}
  const owner=await pool.query("SELECT id FROM users WHERE id=$1",[e.ownerId]);
  if(!owner.rows.length){res.status(404).json({error:"Account not found."});return;}
  const r=e.sourceId?await resource(e.ownerId,e.sourceId):null;
  if(!["profile_visit","follow","unfollow"].includes(e.kind)&&(!r||!r.is_public||r.deleted_at)){
    res.status(404).json({error:"Content is not available for shared analytics."});return;
  }
  const recorded=await analyticsTransaction(async client=>{
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[e.ownerId+actor]);
    const prior=await client.query("SELECT id FROM analytics_events WHERE owner_id=$1 AND actor_id=$2 AND dedup_key=$3",[e.ownerId,actor,`event:${e.nonce}`]);
    if(prior.rows.length)return false;
    if(e.kind==="follow"){
      const inserted=await client.query("INSERT INTO analytics_follows(owner_id,actor_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING owner_id",[e.ownerId,actor]);
      if(!inserted.rows.length)return false;
    }else if(e.kind==="unfollow"){
      const removed=await client.query("DELETE FROM analytics_follows WHERE owner_id=$1 AND actor_id=$2 RETURNING owner_id",[e.ownerId,actor]);
      if(!removed.rows.length)return false;
    }
    const bucket=e.kind==="profile_visit"?Math.floor(Date.now()/1800000):new Date().toISOString().slice(0,10);
    const dedupKey=["follow","unfollow"].includes(e.kind)?`event:${e.nonce}`:`${e.kind}:${r?.id||"profile"}:${bucket}`;
    return recordAnalyticsEvent(client,{ownerId:e.ownerId,actorId:actor,resourceId:r?.id,kind:e.kind,source:e.source,dedupKey});
  });
  res.json({recorded});
});
export default router;
