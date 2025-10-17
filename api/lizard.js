// api/lizard.js — SerpAPI Google Images, streams image/* bytes
// Env: SERPAPI_KEY (if missing -> Wikimedia fallbacks)

export const config = { api: { bodyParser: false } };

const BLOCK_SITES = [
  "pinterest.", "etsy.", "redbubble.", "aliexpress.", "temu.",
  "vectorstock.", "shutterstock.", "adobe.", "istockphoto.", "123rf.",
  "dreamstime.", "depositphotos.", "freepik.", "pngtree."
];

// keep this lighter than raccoon to avoid over-filtering
const BLOCK_WORDS = [
  "sticker","clipart","svg","logo","vector","icon",
  "plush","plushie","toy","merch","tattoo","drawing",
  "ai","midjourney","dalle","generated","meme","cartoon"
];

const QUERIES = [
  "lizard wildlife photo",
  "lizard macro photo",
  "gecko close up nature photo",
  "anole close up photo",
  "iguana portrait wildlife photo",
  "lizard basking on rock photo",
  "reptile macro eyes photo",
  "lizard nature photography outdoors"
];

const FALLBACKS = [
  "https://upload.wikimedia.org/wikipedia/commons/5/50/Common_lizard.jpg",
  "https://upload.wikimedia.org/wikipedia/commons/f/f4/Anolis_carolinensis.jpg",
  "https://upload.wikimedia.org/wikipedia/commons/3/32/Agama_agama_male.jpg",
  "https://upload.wikimedia.org/wikipedia/commons/2/28/Iguana_iguana_1.jpg"
];

function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
function setCORS(res){
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type");
}
function setCache(res){
  // shorter cache while debugging; bump later if you want
  res.setHeader("Cache-Control","public, s-maxage=300, stale-while-revalidate=3600");
}
function blockedSite(url){
  try {
    const h = new URL(url).hostname.toLowerCase();
    return BLOCK_SITES.some(d=>h.includes(d));
  } catch {
    // don't nuke candidates just because URL parsing failed
    return false;
  }
}
function blockedWords(text=""){
  const s = String(text).toLowerCase();
  return BLOCK_WORDS.some(w=>s.includes(w));
}
async function fetchJSON(url){
  const r = await fetch(url, { redirect:"follow" });
  if(!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
async function fetchAsImage(url){
  const r = await fetch(url, {
    redirect:"follow",
    headers: { "user-agent":"Mozilla/5.0", "accept":"image/*,*/*;q=0.8" }
  });
  if(!r.ok) return null;
  const ct = (r.headers.get("content-type")||"").toLowerCase();
  if(!ct.startsWith("image/")) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  let ext = "jpg";
  if(ct.includes("png")) ext = "png";
  else if(ct.includes("jpeg")) ext = "jpg";
  else if(ct.includes("gif")) ext = "gif";
  else if(ct.includes("webp")) ext = "webp";
  return { buf, ct, ext };
}

export default async function handler(req,res){
  setCORS(res);
  if(req.method==="OPTIONS") return res.status(204).end();

  const serpKey = process.env.SERPAPI_KEY;
  const userQ = (req.query.q||"").toString().trim();
  const baseQuery = userQ || pick(QUERIES);
  const debug = ((req.query.format||"").toString().toLowerCase()==="json");

  // No key → serve Wikimedia fallback as bytes
  if(!serpKey){
    setCache(res);
    const url = pick(FALLBACKS);
    const data = await fetchAsImage(url);
    if(!data) return res.status(500).json({ ok:false, error:"no_key_and_fallback_failed" });

    if(debug) return res.status(200).json({ ok:true, source:"static_fallback", image:url, content_type:data.ct });
    res.setHeader("Content-Type", data.ct);
    res.setHeader("Content-Disposition", `inline; filename="lizard.${data.ext}"`);
    return res.status(200).send(data.buf);
  }

  // Try multiple pages 0..5 and collect candidates
  const all = [];
  for (let ijn = 0; ijn < 6; ijn++) {
    try {
      const params = new URLSearchParams({
        engine:"google_images",
        q: `${baseQuery} -plush -toy -merch -clipart -sticker -logo -vector -cartoon`,
        tbm:"isch",
        tbs:"itp:photo,isz:l",
        safe:"active",
        ijn:String(ijn),
        api_key:serpKey
      });
      const data = await fetchJSON(`https://serpapi.com/search.json?${params.toString()}`);
      const list = Array.isArray(data.images_results) ? data.images_results : [];
      for (const r of list) {
        const url = r?.original || r?.thumbnail || "";
        const title = r?.title || "";
        if (!url) continue;
        if (url.toLowerCase().endsWith(".svg")) continue;
        if (blockedSite(url)) continue;
        if (blockedWords(title)) continue;
        all.push({ url, title });
      }
      // Stop early if we have enough
      if (all.length >= 30) break;
    } catch {
      // keep going; we have fallbacks
    }
  }

  // Shuffle
  for(let i=all.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [all[i],all[j]]=[all[j],all[i]];
  }

  setCache(res);

  // Try up to 15 candidates
  const tries = Math.min(15, all.length);
  for(let i=0;i<tries;i++){
    const url = all[i]?.url;
    try{
      const data = await fetchAsImage(url);
      if(!data) continue;

      if(debug){
        return res.status(200).json({
          ok:true,
          source:"serpapi",
          candidates: all.length,
          picked: url,
          content_type: data.ct
        });
      }

      res.setHeader("Content-Type", data.ct);
      res.setHeader("Content-Disposition", `inline; filename="lizard.${data.ext}"`);
      return res.status(200).send(data.buf);
    }catch{/* next */}
  }

  // Final static fallback
  try{
    const url = pick(FALLBACKS);
    const data = await fetchAsImage(url);
    if(!data) throw new Error("fallback failed");

    if(debug) return res.status(200).json({ ok:true, source:"static_fallback", image:url, content_type:data.ct });
    res.setHeader("Content-Type", data.ct);
    res.setHeader("Content-Disposition", `inline; filename="lizard.${data.ext}"`);
    return res.status(200).send(data.buf);
  }catch{
    return res.status(404).json({ ok:false, error:"no_usable_lizard_found", candidates: all.length });
  }
}
