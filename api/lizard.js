// api/lizard.js — fetch-only, auto-scrapes Pixabay lizard page
// Streams image/* bytes so it works directly in Discord embeds.

export const config = { api: { bodyParser: false } };

const FALLBACKS = [
  "https://cdn.pixabay.com/photo/2024/11/07/03/12/lizard-9179598_1280.jpg",
  "https://cdn.pixabay.com/photo/2024/02/22/00/27/iguana-8588842_1280.jpg",
  "https://upload.wikimedia.org/wikipedia/commons/5/50/Common_lizard.jpg",
  "https://upload.wikimedia.org/wikipedia/commons/f/f4/Anolis_carolinensis.jpg"
];

function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
function setCORS(res){
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type");
}
function setCache(res){ 
  res.setHeader("Cache-Control","public, s-maxage=3600, stale-while-revalidate=43200");
}

async function fetchAsImage(url){
  const r = await fetch(url, {
    redirect:"follow",
    headers:{
      "user-agent":"Mozilla/5.0",
      "accept":"image/*,*/*;q=0.8"
    }
  });
  if(!r.ok) return null;
  const ct=(r.headers.get("content-type")||"").toLowerCase();
  if(!ct.startsWith("image/")) return null;
  const buf=Buffer.from(await r.arrayBuffer());
  let ext="jpg";
  if(ct.includes("png")) ext="png";
  else if(ct.includes("jpeg")) ext="jpg";
  else if(ct.includes("gif")) ext="gif";
  else if(ct.includes("webp")) ext="webp";
  return {buf,ct,ext};
}

async function getPixabayImageUrls(query="lizard"){
  // Scrape public HTML search result page for CDN links
  const url=`https://pixabay.com/images/search/${encodeURIComponent(query)}/`;
  const resp=await fetch(url,{headers:{"user-agent":"Mozilla/5.0"}});
  if(!resp.ok) return [];
  const html=await resp.text();

  // regex for cdn.pixabay.com/photo/..._1280.(jpg|jpeg|png)
  const matches=[...html.matchAll(/https:\/\/cdn\.pixabay\.com\/photo\/[^\s"']+_1280\.(?:jpg|jpeg|png)/gi)];
  return matches.map(m=>m[0]);
}

export default async function handler(req,res){
  setCORS(res);
  if(req.method==="OPTIONS") return res.status(204).end();
  setCache(res);

  const q=(req.query.q||"lizard").toString().trim().toLowerCase();

  // 1) try scraping Pixabay
  let urls=[];
  try{
    urls=await getPixabayImageUrls(q);
  }catch{/* ignore */}

  // 2) pick candidate or fallback
  const chosen = urls.length ? pick(urls) : pick(FALLBACKS);

  try{
    const data=await fetchAsImage(chosen);
    if(!data) throw new Error("not image");

    if((req.query.format||"").toString().toLowerCase()==="json"){
      return res.status(200).json({
        ok:true,
        source: chosen.includes("cdn.pixabay.com") ? "pixabay_cdn" : "static_fallback",
        image:chosen,
        content_type:data.ct
      });
    }

    res.setHeader("Content-Type",data.ct);
    res.setHeader("Content-Disposition",`inline; filename="lizard.${data.ext}"`);
    return res.status(200).send(data.buf);
  }catch{
    // fallback bytes
    const alt=pick(FALLBACKS);
    const data=await fetchAsImage(alt);
    if(!data) return res.status(404).json({ok:false,error:"no_usable_lizard_image"});
    res.setHeader("Content-Type",data.ct);
    res.setHeader("Content-Disposition",`inline; filename="lizard.${data.ext}"`);
    return res.status(200).send(data.buf);
  }
}
