import { pool } from "@workspace/db";
export function reportRange(from: unknown,to: unknown) {
  const valid=(v:unknown)=>typeof v==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(new Date(v).getTime())&&new Date(v).toISOString().slice(0,10)===v;
  const end=valid(to)?String(to):new Date().toISOString().slice(0,10);
  const start=valid(from)?String(from):new Date(new Date(end).getTime()-27*86400000).toISOString().slice(0,10);
  const days=(new Date(end).getTime()-new Date(start).getTime())/86400000+1;
  if((from!==undefined&&!valid(from))||(to!==undefined&&!valid(to))||days<1||days>90||end>new Date().toISOString().slice(0,10))return null;
  return {from:start,to:end,days};
}
const number=(v:unknown)=>Number(v||0);
const metricsSql=`count(*) FILTER(WHERE kind='view') AS views,
 count(DISTINCT actor_id) FILTER(WHERE kind='view') AS unique_viewers,
 count(*) FILTER(WHERE kind='profile_visit') AS profile_visits,
 count(*) FILTER(WHERE kind='follow') AS follows,count(*) FILTER(WHERE kind='unfollow') AS unfollows,
 count(*) FILTER(WHERE kind='like') AS likes,count(*) FILTER(WHERE kind='comment') AS comments,
 count(*) FILTER(WHERE kind='share') AS shares,count(*) FILTER(WHERE kind='save') AS saves`;
function metrics(r:Record<string,unknown>={}) {
  return {views:number(r.views),uniqueViewers:number(r.unique_viewers),profileVisits:number(r.profile_visits),
    newFollowers:number(r.follows),unfollows:number(r.unfollows),netFollowers:number(r.follows)-number(r.unfollows),
    likes:number(r.likes),comments:number(r.comments),shares:number(r.shares),saves:number(r.saves)};
}
async function playback(owner:string,from:string,to:string,resourceId?:string) {
  const {rows}=await pool.query(`SELECT count(*) FILTER(WHERE s.watched_ms>0) AS starts,
   count(*) FILTER(WHERE s.watched_ms>0 AND r.duration_ms>0) AS known_starts,
   count(*) FILTER(WHERE s.completed) AS complete,coalesce(sum(s.watched_ms) FILTER(WHERE s.watched_ms>0),0) AS watch,
   count(*) FILTER(WHERE s.progress>=0.25) AS q25,count(*) FILTER(WHERE s.progress>=0.5) AS q50,
   count(*) FILTER(WHERE s.progress>=0.75) AS q75,count(*) FILTER(WHERE s.completed) AS q100
   FROM analytics_sessions s JOIN analytics_resources r ON r.id=s.resource_id
   WHERE r.owner_id=$1 AND s.started_at >= $2::date AND s.started_at < $3::date+interval '1 day'
   AND ($4::uuid IS NULL OR r.id=$4::uuid)`,[owner,from,to,resourceId||null]);
  const r=rows[0],starts=number(r.starts),knownStarts=number(r.known_starts);
  return {watchTimeMs:starts?number(r.watch):null,averageWatchTimeMs:starts?number(r.watch)/starts:null,
    completionRate:knownStarts?number(r.complete)/knownStarts:null,
    retention:knownStarts>=10?[{percent:0,value:1},...[25,50,75,100].map(p=>({percent:p,value:number(r[`q${p}`])/knownStarts}))]:[]};
}
export async function contentReport(owner:string,id:string,from:string,to:string) {
  const resource=await pool.query("SELECT * FROM analytics_resources WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL",[id,owner]);
  const r=resource.rows[0];if(!r)return null;
  const stats=await pool.query(`SELECT ${metricsSql} FROM analytics_events WHERE owner_id=$1 AND resource_id=$2
    AND created_at >= $3::date AND created_at < $4::date+interval '1 day'`,[owner,id,from,to]);
  const source=await pool.query(`SELECT source,count(*)::int AS views FROM analytics_events
    WHERE resource_id=$1 AND kind='view' AND created_at >= $2::date AND created_at < $3::date+interval '1 day'
    GROUP BY source ORDER BY views DESC`,[id,from,to]);
  const m=metrics(stats.rows[0]);
  return {id:r.id,sourceId:r.source_id,title:r.title||"Untitled content",kind:r.kind,createdAt:new Date(r.published_at).getTime(),
    ...m,follows:m.newFollowers,...await playback(owner,from,to,id),sources:source.rows};
}
export async function dashboardReport(owner:string,accountType:string,range:{from:string;to:string;days:number},query:Record<string,unknown>) {
  await pool.query(`INSERT INTO analytics_resources(owner_id,source_id,kind,title,is_public,published_at)
    SELECT author_id,id::text,'text',left(text,100),true,created_at FROM posts WHERE author_id=$1
    ON CONFLICT(owner_id,source_id) DO NOTHING`,[owner]);
  const {from,to,days}=range;
  const stats=await pool.query(`SELECT ${metricsSql} FROM analytics_events WHERE owner_id=$1
    AND created_at >= $2::date AND created_at < $3::date+interval '1 day'`,[owner,from,to]);
  const m=metrics(stats.rows[0]),engagement=m.likes+m.comments+m.shares+m.saves;
  const follows=await pool.query("SELECT count(*)::int AS total FROM analytics_follows WHERE owner_id=$1",[owner]);
  const daily=await pool.query(`SELECT day,
    coalesce(sum(value) FILTER(WHERE kind='view'),0)::int AS views,
    coalesce(sum(value) FILTER(WHERE kind='profile_visit'),0)::int AS "profileVisits",
    coalesce(sum(value) FILTER(WHERE kind='follow'),0)::int AS follows,
    coalesce(sum(value) FILTER(WHERE kind IN ('like','comment','share','save')),0)::int AS engagement
    FROM analytics_daily WHERE owner_id=$1 AND day BETWEEN $2 AND $3 GROUP BY day ORDER BY day`,[owner,from,to]);
  const series=Array.from({length:days},(_,i)=>{
    const day=new Date(new Date(from).getTime()+i*86400000).toISOString().slice(0,10);
    return daily.rows.find(r=>r.day===day)||{day,views:0,profileVisits:0,follows:0,engagement:0};
  });
  const first=await pool.query("SELECT min(created_at) AS first FROM analytics_resources WHERE owner_id=$1",[owner]);
  const previousStart=new Date(new Date(from).getTime()-days*86400000).toISOString().slice(0,10);
  const previousEnd=new Date(new Date(from).getTime()-86400000).toISOString().slice(0,10);
  const previous=await pool.query(`SELECT ${metricsSql} FROM analytics_events WHERE owner_id=$1 AND created_at >= $2::date AND created_at < $3::date+interval '1 day'`,[owner,previousStart,previousEnd]);
  const pm=metrics(previous.rows[0]),pe=pm.likes+pm.comments+pm.shares+pm.saves;
  const compare=(a:number,b:number)=>b>=10&&first.rows[0].first&&new Date(first.rows[0].first)<=new Date(previousStart)?(a-b)/b*100:null;
  const comparison={views:compare(m.views,pm.views),profileVisits:compare(m.profileVisits,pm.profileVisits),newFollowers:compare(m.newFollowers,pm.newFollowers),engagement:compare(engagement,pe)};
  const page=Math.max(1,Math.min(500,Number(query.page)||1)),type=String(query.type||"all");
  const sort=query.sort==="views"?"view_count DESC":query.sort==="engagement"?"engagement_count DESC":"r.published_at DESC";
  const resources=await pool.query(`SELECT r.id,count(e.id) FILTER(WHERE e.kind='view') AS view_count,
    count(e.id) FILTER(WHERE e.kind IN ('like','comment','share','save')) AS engagement_count FROM analytics_resources r
    LEFT JOIN analytics_events e ON e.resource_id=r.id AND e.created_at >= $2::date AND e.created_at < $3::date+interval '1 day'
    WHERE r.owner_id=$1 AND r.deleted_at IS NULL AND ($4='all' OR r.kind=$4)
    GROUP BY r.id ORDER BY ${sort},r.id LIMIT 21 OFFSET $5`,[owner,from,to,type,(Math.floor(page)-1)*20]);
  const content=await Promise.all(resources.rows.slice(0,20).map(r=>contentReport(owner,r.id,from,to)));
  const activity=query.mode==="personal"?{rows:[]}:await pool.query(`SELECT extract(dow FROM created_at AT TIME ZONE 'UTC')::int AS day,
    extract(hour FROM created_at AT TIME ZONE 'UTC')::int AS hour,count(*)::int AS events
    FROM analytics_events e WHERE owner_id=$1 AND created_at >= $2::date AND created_at < $3::date+interval '1 day'
    AND EXISTS(SELECT 1 FROM analytics_follows f WHERE f.owner_id=e.owner_id AND f.actor_id=e.actor_id)
    GROUP BY day,hour HAVING count(DISTINCT actor_id)>=10`,[owner,from,to]);
  const growth:Array<{text:string;reason:string}>=[];
  if(comparison.views!==null)growth.push({text:`Content views ${comparison.views>=0?"increased":"decreased"} ${Math.abs(comparison.views).toFixed(1)}%.`,reason:"Compared with the preceding equal-length period; previous period has at least 10 qualifying views."});
  const ranked=content.filter(Boolean).filter(c=>c!.views>=10).sort((a,b)=>b!.views-a!.views);
  if(ranked.length>=3)growth.push({text:`“${ranked[0]!.title}” has the most views among the content shown.`,reason:"Ranks the current page of measured content, not all content or predicted future performance."});
  const pb=await playback(owner,from,to);const {retention:_retention,...watch}=pb;
  return {accountType,range:{from,to},overview:{...m,totalFollowers:follows.rows[0].total,engagementRate:m.views?engagement/m.views:null,...watch},
    comparison,series,content:content.filter(Boolean),hasMore:resources.rows.length>20,
    audience:{activity:activity.rows,demographicsAvailable:false},growth:query.mode==="personal"?[]:growth,
    earnings:{available:false,reason:"Creator earnings, gifts, subscriptions and payouts are not operating yet. Blue Badge membership is separate and purchases will be available only in the future mobile app."},
    unavailable:["Historical device counters are not imported as real analytics. These totals cover recorded online activity only.","Private and Close Friends content stays private. Shared server playback analytics is unavailable for device-only private content.","Identifiable profile visitors and demographic reports are not enabled.","Watch-duration retention needs at least 10 measured playback starts; it is not a precise playhead retention measurement.","Follower totals include only online follow relationships recorded since tracking began."],
    definitions:{views:"Self-views excluded. Public image/text views require 2 visible seconds; videos require 3 seconds of actual playback, or the full duration if shorter. One qualifying view per viewer/content/30-minute window; Stories count once per viewer per Story.",
      uniqueViewers:"Distinct signed-in viewers of qualifying views during the selected UTC date range. No visitor identities are exposed.",
      engagementRate:"Positive likes, comments, shares and saves received divided by qualifying views. Each actor/content/action is counted at most once per UTC day; removals do not erase historical interactions.",
      profileVisits:"One visit per signed-in visitor/profile/30-minute window, excluding self-visits. Only actual profile navigation is attributed; identities remain private."},
    trackingSince:first.rows[0].first?new Date(first.rows[0].first).getTime():Date.now()};
}
