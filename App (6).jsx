import { useState, useEffect, useRef, useCallback } from "react";

const API = "http://localhost:3001";

/* ─── DESIGN TOKENS ─────────────────────────────────────────────── */
const C = {
  navy: "#0B1F3A", navyMid: "#1A3558", blue: "#1D4ED8",
  teal: "#0EA5E9", slateLight: "#F1F5F9", border: "#E2E8F0",
  text: "#0F172A", textMuted: "#64748B",
};

const CATEGORIES = [
  { id: "water",       label: "Water Leak",        icon: "💧", color: "#0EA5E9", bg: "#E0F2FE" },
  { id: "electricity", label: "Electricity Fault",  icon: "⚡", color: "#F59E0B", bg: "#FEF3C7" },
  { id: "pothole",     label: "Pothole",             icon: "🛣️", color: "#8B5CF6", bg: "#EDE9FE" },
  { id: "sewage",      label: "Sewage Blockage",     icon: "🚰", color: "#10B981", bg: "#D1FAE5" },
  { id: "facility",    label: "Public Facility",     icon: "🏛️", color: "#EF4444", bg: "#FEE2E2" },
];

const PRIORITIES = {
  Low:      { color: "#10B981", bg: "#D1FAE5" },
  Medium:   { color: "#F59E0B", bg: "#FEF3C7" },
  High:     { color: "#EF4444", bg: "#FEE2E2" },
  Critical: { color: "#7C3AED", bg: "#EDE9FE" },
};

const STATUS_STEPS = ["Submitted","Classified","Assigned","In Progress","Resolved"];

/* ─── AI CLASSIFIER ─────────────────────────────────────────────── */

// ── Readability validator ─────────────────────────────────────────
const validateReadability = (text) => {
  const t = text.trim();
  if (!t) return { readable: false, reason: "Please enter a description." };
  if (t.length < 15) return { readable: false, reason: "Too short — please describe the issue in at least 15 characters." };

  // Check for random keyboard mashing: high ratio of non-letter chars or no real words
  const words = t.split(/\s+/).filter(w => w.length > 0);
  if (words.length < 3) return { readable: false, reason: "Please use at least 3 words to describe the issue." };

  // Check that majority of words contain actual letters (not just numbers/symbols)
  const realWords = words.filter(w => /[a-zA-Z]{2,}/.test(w));
  if (realWords.length / words.length < 0.5) return { readable: false, reason: "Your description appears to contain too many symbols or numbers. Please use plain language." };

  // Detect repeated characters (e.g. "aaaaaaa", "hhhhhh")
  if (/(..)\1{4,}/.test(t.toLowerCase())) return { readable: false, reason: "Your description looks like repeated characters. Please describe the actual issue." };

  // Detect all-caps screaming beyond a threshold
  const letters = t.replace(/[^a-zA-Z]/g,"");
  const upperRatio = letters.length > 0 ? (t.replace(/[^A-Z]/g,"").length / letters.length) : 0;
  if (upperRatio > 0.8 && t.length > 10) return { readable: false, reason: "Please avoid writing in ALL CAPS. Describe the issue normally." };

  // Check for recognisable English / municipal words — at least some must exist
  const meaningfulWords = /water|leak|pipe|electric|power|light|road|pothole|sewage|drain|crack|broken|flood|burst|smell|building|park|fence|sign|lamp|street|pavement|tar|wall|roof|window|door|rubbish|waste|fire|smoke|tree|wire|cable|manhole|bridge|pavement|sidewalk|block|meter|pump|pump|tank|valve|motor|geyser|pool|dam|river|storm|sewer|toilet|toilet|tap|tap|gate|gate|grass|grass|animal|animal|noise|noise|vandal|graffiti|spray|paint|burn|collapse|fallen|unsafe|danger|hazard|urgent|report|complaint|issue|problem|fault|damage/;
  if (!meaningfulWords.test(t.toLowerCase())) return { readable: false, reason: "Your description doesn\'t seem to relate to a municipal issue. Please describe a specific problem (e.g. water leak, pothole, electricity fault)." };

  return { readable: true, reason: "" };
};

// ── Duplicate / similarity detector ──────────────────────────────
// Returns 0.0–1.0 similarity score between two strings using word overlap (Jaccard)
const textSimilarity = (a, b) => {
  const tokenise = s => new Set(
    s.toLowerCase().replace(/[^a-z0-9\s]/g,"").split(/\s+/).filter(w => w.length > 2)
  );
  const setA = tokenise(a);
  const setB = tokenise(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  const intersection = [...setA].filter(w => setB.has(w)).length;
  const union = new Set([...setA, ...setB]).size;
  return parseFloat((intersection / union).toFixed(3));
};

// Find similar existing complaints (threshold 0.45 = ~45% word overlap)
const findSimilarComplaints = (description, existingComplaints, threshold = 0.45) => {
  return existingComplaints
    .map(c => ({ ...c, similarity: textSimilarity(description, c.description || "") }))
    .filter(c => c.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 3);
};

// ── Enhanced keyword classifier ────────────────────────────────────
const aiClassify = (description) => {
  const text = description.toLowerCase();

  // ── Category detection (ordered by specificity) ──────────────────
  let category = "facility";
  let categoryScore = 0;

  const categoryRules = [
    {
      id: "sewage",
      patterns: [/sewage|sewer|blockage|blocked drain|overflow|overflowing|smell|stench|manhole|raw sewage|waste water|wastewater|toilet overflow|drain overflow|drain blocked/],
      score: 3,
    },
    {
      id: "water",
      patterns: [/water|leak|leaking|pipe|burst pipe|burst main|no water|water outage|water cut|drip|dripping|flood|flooding|flooded|broken pipe|water meter|tap|standpipe|water pressure|no pressure/],
      score: 2,
    },
    {
      id: "electricity",
      patterns: [/electric|electricity|power|light|street light|streetlight|outage|blackout|no power|power cut|fault|spark|sparking|wire|cable|exposed wire|trip|tripped|meter|prepaid|transformer|overhead line|pylon/],
      score: 2,
    },
    {
      id: "pothole",
      patterns: [/pothole|pot hole|road|crack|cracked road|bump|tar|tarmac|asphalt|pavement|roadway|street damage|sunken road|damaged road|road surface|road sign|traffic light|traffic signal|speed bump|storm drain|gutter/],
      score: 2,
    },
    {
      id: "facility",
      patterns: [/park|bench|playground|building|broken|vandal|vandalism|graffiti|rubbish|refuse|waste|litter|dump|illegal dump|fence|wall|gate|sign|notice|community hall|sports field|library|clinic|toilet|public toilet|grass|overgrown|tree|fallen tree|animal|stray|noise|fire|smoke|abandoned/],
      score: 1,
    },
  ];

  for (const rule of categoryRules) {
    for (const pattern of rule.patterns) {
      if (pattern.test(text)) {
        if (rule.score > categoryScore) {
          category = rule.id;
          categoryScore = rule.score;
        }
        break;
      }
    }
  }

  // ── Priority scoring system (additive points) ─────────────────────
  let priorityScore = 0;

  const priorityRules = [
    // Critical signals (+10 each)
    { pattern: /danger|dangerous|life.?threatening|injury|injured|death|collapsed|collapse|explosion|exploded|fire|burning|emergency|electrocution|electrocuted|sparking wire|exposed wire|raw sewage|flooding street|main road|primary road/, points: 10 },
    // Critical signals (+8)
    { pattern: /urgent|critical|hazard|accident|burst main|burst pipe|major flood|road closed|no access|hospital|school|clinic|blocked access/, points: 8 },
    // High signals (+5)
    { pattern: /large|major|severe|bad|serious|significant|multiple|several|many|week|weeks|days|months|long time|spreading|getting worse|worsening|escalating|affecting many|whole street|whole area|neighbourhood/, points: 5 },
    // High signals (+4)
    { pattern: /no water|no electricity|no power|complete|entire|whole block|main road|busy road|traffic/, points: 4 },
    // Medium signals (+2)
    { pattern: /moderate|medium|some|occasional|intermittent|sometimes|slow|building up/, points: 2 },
    // Low signals (-3)
    { pattern: /small|minor|slight|little|tiny|hairline|surface|cosmetic|not urgent|low priority/, points: -3 },
  ];

  for (const rule of priorityRules) {
    if (rule.pattern.test(text)) {
      priorityScore += rule.points;
    }
  }

  // Map score to priority level
  let priority;
  if (priorityScore >= 10)      priority = "Critical";
  else if (priorityScore >= 5)  priority = "High";
  else if (priorityScore >= 1)  priority = "Medium";
  else                          priority = "Low";

  // ── Confidence: how many keyword patterns matched ─────────────────
  const totalMatches = categoryRules.reduce((acc, rule) =>
    acc + rule.patterns.filter(p => p.test(text)).length, 0
  );
  const confidence = Math.min(0.97, 0.62 + (totalMatches * 0.08) + (priorityScore > 0 ? 0.05 : 0));

  // ── Human-readable explanation of why this classification was made ─
  const reasons = [];
  if (category === "water")       reasons.push("water-related keywords detected");
  if (category === "sewage")      reasons.push("sewage/drainage keywords detected");
  if (category === "electricity") reasons.push("electrical fault keywords detected");
  if (category === "pothole")     reasons.push("road/pavement damage keywords detected");
  if (category === "facility")    reasons.push("public facility keywords detected");
  if (priorityScore >= 10)        reasons.push("critical safety/emergency language used");
  else if (priorityScore >= 5)    reasons.push("severity/impact language used");
  else if (priorityScore <= -2)   reasons.push("minor/low-severity language used");

  return {
    category,
    priority,
    confidence: parseFloat(confidence.toFixed(4)),
    priorityScore,
    reasons,
  };
};

/* ─── SHARED COMPONENTS ─────────────────────────────────────────── */
function Notif({ msg, type, onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 4000); return () => clearTimeout(t); }, [onDone]);
  const bg = type === "error" ? "#DC2626" : type === "info" ? C.blue : type === "warning" ? "#D97706" : "#059669";
  return (
    <div style={{ position:"fixed", top:20, right:20, zIndex:3000, background:bg, color:"#fff", padding:"13px 20px", borderRadius:12, fontSize:14, fontWeight:500, boxShadow:"0 8px 30px rgba(0,0,0,.25)", maxWidth:380, animation:"slideIn .3s ease" }}>
      {msg}
    </div>
  );
}

function Badge({ text, priority }) {
  const p = PRIORITIES[priority] || PRIORITIES.Medium;
  return <span style={{ fontSize:11, fontWeight:600, padding:"2px 8px", borderRadius:20, background:p.bg, color:p.color }}>{text || priority}</span>;
}

function StatusBar({ status }) {
  const cur = STATUS_STEPS.indexOf(status);
  return (
    <div style={{ display:"flex", alignItems:"center", marginTop:10 }}>
      {STATUS_STEPS.map((step, i) => {
        const done = i < cur, active = i === cur;
        return (
          <div key={step} style={{ display:"flex", alignItems:"center", flex: i < STATUS_STEPS.length-1 ? 1 : "none" }}>
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center" }}>
              <div style={{ width:24, height:24, borderRadius:"50%", background: done ? C.teal : active ? C.blue : "#E5E7EB", display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:700, color: done||active ? "#fff" : "#9CA3AF", border: active ? "3px solid #BFDBFE" : "none", boxSizing:"border-box", flexShrink:0 }}>
                {done ? "✓" : i+1}
              </div>
              <span style={{ fontSize:8, color: active ? C.blue : "#9CA3AF", marginTop:2, textAlign:"center", maxWidth:44 }}>{step}</span>
            </div>
            {i < STATUS_STEPS.length-1 && <div style={{ flex:1, height:2, background: done ? C.teal : "#E5E7EB", margin:"0 2px", marginBottom:14 }} />}
          </div>
        );
      })}
    </div>
  );
}

function StatCard({ icon, label, value, color }) {
  return (
    <div style={{ background:"#fff", borderRadius:14, padding:"18px 16px", border:`1px solid ${C.border}`, display:"flex", alignItems:"center", gap:12 }}>
      <div style={{ width:44, height:44, borderRadius:12, background:color+"20", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22 }}>{icon}</div>
      <div>
        <div style={{ fontSize:28, fontWeight:800, color:C.text, lineHeight:1 }}>{value}</div>
        <div style={{ fontSize:11, color:C.textMuted, marginTop:4 }}>{label}</div>
      </div>
    </div>
  );
}

/* ─── STATUS / CATEGORY MAPS ────────────────────────────────────── */
const STATUS_COLORS = {
  "Submitted":   "#888780",
  "Classified":  "#888780",
  "Assigned":    "#378ADD",
  "In Progress": "#EF9F27",
  "Resolved":    "#639922",
  "Escalated":   "#D85A30",
};

/* ─── LIVE TRACKING MAP ─────────────────────────────────────────── */
function LiveTrackingMap({ complaints=[], technicians=[], selected, onSelect, height=320, title="Live Complaint Map" }) {
  const [visibleStatuses, setVisibleStatuses] = React.useState(
    new Set(["Submitted","Classified","Assigned","In Progress","Resolved","Escalated"])
  );
  const [tooltip, setTooltip] = React.useState(null);
  const [techCard, setTechCard] = React.useState(null);
  const [footerMsg, setFooterMsg] = React.useState(null);
  const [tick, setTick] = React.useState(0);
  const svgRef = React.useRef(null);
  // Live clock tick
  React.useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const now = new Date();
  const clock = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}:${String(now.getSeconds()).padStart(2,"0")}`;

  // Map bounds (Johannesburg area)
  const bounds = { minLat:-26.38, maxLat:-26.10, minLng:27.85, maxLng:28.18 };
  const W = 660, H = height;

  const toXY = (lat, lng) => ({
    x: ((lng - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * W,
    y: ((bounds.maxLat - lat)  / (bounds.maxLat - bounds.minLat)) * H,
  });

  const fallbackCoord = (item, idx) => ({
    lat: parseFloat(item.lat || item.latitude)  || (-26.22 + (idx * 0.03) % 0.22),
    lng: parseFloat(item.lng || item.longitude) || (27.92  + (idx * 0.05) % 0.24),
  });

  const visible = complaints.filter(c => visibleStatuses.has(c.status));
  const plotted  = visible.length;

  const toggleStatus = (s) => {
    setVisibleStatuses(prev => {
      const n = new Set(prev);
      n.has(s) ? n.delete(s) : n.add(s);
      return n;
    });
  };

  const handlePinClick = (c) => {
    onSelect && onSelect(c.id || c.ref_id);
    const tech = technicians.find(t => t.complaint_id === (c.dbId || c.id));
    setFooterMsg(tech
      ? { id: c.id||c.ref_id, msg: `${tech.name} is ${tech.status_label||"en route"}` }
      : { id: c.id||c.ref_id, msg: `${c.status} · ${c.priority} priority` }
    );
  };

  // SVG teardrop pin path centered at (cx, cy)
  const pinPath = (cx, cy, scale=1) =>
    `M${cx},${cy+16*scale} C${cx-13*scale},${cy+4*scale} ${cx-13*scale},${cy-13*scale} ${cx},${cy-13*scale} C${cx+13*scale},${cy-13*scale} ${cx+13*scale},${cy+4*scale} ${cx},${cy+16*scale}Z`;

  const LEGEND_STATUSES = ["Submitted","Assigned","In Progress","Resolved","Escalated"];

  return (
    <div style={{ borderRadius:14, overflow:"hidden", border:`1px solid ${C.border}`, background:"#fff", fontFamily:"'Segoe UI',system-ui,sans-serif" }}>

      {/* ── Header ── */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 14px", borderBottom:`1px solid ${C.border}`, background:"#fff" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:28, height:28, borderRadius:7, background:"#EFF6FF", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14 }}>🗺️</div>
          <div>
            <div style={{ fontSize:13, fontWeight:700, color:C.text }}>{title}</div>
            <div style={{ fontSize:10, color:C.textMuted }}>UC6 · Real-time status &amp; technician location</div>
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ display:"flex", alignItems:"center", gap:5, background:"#F0FDF4", border:"1px solid #BBF7D0", borderRadius:20, padding:"3px 9px" }}>
            <span style={{ width:7, height:7, background:"#16a34a", borderRadius:"50%", display:"inline-block", animation:"liveblink 1s infinite" }}/>
            <span style={{ fontSize:10, fontWeight:600, color:"#16a34a" }}>Live</span>
          </div>
          <span style={{ fontSize:11, color:C.textMuted, fontVariantNumeric:"tabular-nums" }}>Updated {clock}</span>
        </div>
      </div>

      {/* ── Legend / filter row ── */}
      <div style={{ display:"flex", alignItems:"center", gap:10, padding:"6px 14px", borderBottom:`1px solid ${C.border}`, background:C.slateLight, flexWrap:"wrap" }}>
        <span style={{ fontSize:10, fontWeight:700, color:C.textMuted, textTransform:"uppercase", letterSpacing:".5px", whiteSpace:"nowrap" }}>Status:</span>
        {LEGEND_STATUSES.map(s => (
          <label key={s} style={{ display:"flex", alignItems:"center", gap:4, cursor:"pointer", userSelect:"none" }}>
            <input type="checkbox" checked={visibleStatuses.has(s)} onChange={() => toggleStatus(s)} style={{ margin:0, cursor:"pointer" }}/>
            <span style={{ width:8, height:8, background:STATUS_COLORS[s], borderRadius:"50%", display:"inline-block" }}/>
            <span style={{ fontSize:10, color:C.textMuted }}>{s}</span>
          </label>
        ))}
        {technicians.length > 0 && (
          <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:5 }}>
            <span style={{ width:9, height:9, background:"#378ADD", borderRadius:"50%", display:"inline-block", outline:"2px solid #BFDBFE", outlineOffset:1 }}/>
            <span style={{ fontSize:10, fontWeight:600, color:"#1E40AF" }}>Technician (live)</span>
          </div>
        )}
      </div>

      {/* ── SVG Map ── */}
      <div style={{ position:"relative", background:"#EDF4F8" }}>
        <svg ref={svgRef} width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display:"block", cursor:"crosshair" }}>

          {/* Grid */}
          {Array.from({length:17}, (_,i) => (
            <line key={`gv${i}`} x1={i*W/16} y1={0} x2={i*W/16} y2={H} stroke="#C8DCE8" strokeWidth="0.4"/>
          ))}
          {Array.from({length:Math.ceil(H/40)+1}, (_,i) => (
            <line key={`gh${i}`} x1={0} y1={i*40} x2={W} y2={i*40} stroke="#C8DCE8" strokeWidth="0.4"/>
          ))}

          {/* Roads — main */}
          {[
            [["-26.22","27.85"],["-26.22","28.18"]],
            [["-26.28","27.85"],["-26.28","28.18"]],
            [["-26.15","27.85"],["-26.15","28.18"]],
            [["-26.38","27.95"],["-26.10","27.95"]],
            [["-26.38","28.05"],["-26.10","28.05"]],
            [["-26.38","28.14"],["-26.10","28.14"]],
          ].map((road, ri) => {
            const pts = road.map(([lat,lng]) => toXY(parseFloat(lat), parseFloat(lng)));
            return (
              <g key={`road${ri}`}>
                <line x1={pts[0].x} y1={pts[0].y} x2={pts[1].x} y2={pts[1].y} stroke="#fff" strokeWidth="7" opacity="0.7"/>
                <line x1={pts[0].x} y1={pts[0].y} x2={pts[1].x} y2={pts[1].y} stroke="#B8D0DC" strokeWidth="5" opacity="0.5"/>
              </g>
            );
          })}
          {/* Secondary roads */}
          {[
            [["-26.33","27.85"],["-26.33","28.18"]],
            [["-26.38","27.90"],["-26.10","27.90"]],
            [["-26.38","28.10"],["-26.10","28.10"]],
          ].map((road, ri) => {
            const pts = road.map(([lat,lng]) => toXY(parseFloat(lat), parseFloat(lng)));
            return <line key={`sroad${ri}`} x1={pts[0].x} y1={pts[0].y} x2={pts[1].x} y2={pts[1].y} stroke="#C8DCE8" strokeWidth="2" opacity="0.6"/>;
          })}

          {/* City blocks */}
          {[
            [20,15,100,50],[130,15,100,50],[240,15,140,50],[390,15,120,50],[520,15,120,50],
            [20,75,100,55],[130,75,100,55],[240,75,140,55],[390,75,120,55],[520,75,120,55],
            [20,145,195,Math.max(10,H-165)],[220,145,160,Math.max(10,H-165)],[390,145,250,Math.max(10,H-165)],
            [20,Math.max(145,H-105),195,80],[220,Math.max(145,H-105),160,80],[390,Math.max(145,H-105),250,80],
          ].filter(([x,y,w,h])=>y>=0&&h>0&&y+h<=H+20).map(([x,y,w,h], i) => (
            <rect key={`blk${i}`} x={x} y={y} width={w} height={h} rx="3" fill="#C8DCE8" opacity="0.25"/>
          ))}

          {/* Place names */}
          {[
            ["Soweto", -26.26, 27.88],
            ["eMalahleni CBD", -26.20, 27.99],
            ["Sandton", -26.11, 28.06],
            ["Alexandra", -26.11, 28.10],
            ["Roodepoort", -26.16, 27.87],
            ["Midrand", -26.32, 28.13],
          ].map(([name, lat, lng]) => {
            const {x,y} = toXY(lat, lng);
            return <text key={name} x={x} y={y} textAnchor="middle" fontSize="9" fill="#90A4B4" fontFamily="'Segoe UI',sans-serif" fontWeight="600" letterSpacing=".3">{name}</text>;
          })}

          {/* Street labels */}
          {[
            ["Voortrekker Rd", -26.22, 27.86],
            ["Main Reef Rd",   -26.28, 27.86],
            ["N1 Highway",     -26.15, 27.86],
          ].map(([name, lat, lng]) => {
            const {x,y} = toXY(lat, lng);
            return <text key={name} x={x+4} y={y-3} fontSize="8" fill="#7090A4" fontFamily="'Segoe UI',sans-serif">{name}</text>;
          })}

          {/* Technician scan lines (dashed, to their assigned complaint) */}
          {technicians.map((tech, ti) => {
            const tc = fallbackCoord(tech, ti + 50);
            const tp = toXY(tc.lat, tc.lng);
            const comp = complaints.find(c => (c.dbId||c.id) === tech.complaint_id || (c.id||c.ref_id) === tech.complaint_id);
            if (!comp) return null;
            const cc = fallbackCoord(comp, complaints.indexOf(comp));
            const cp = toXY(cc.lat, cc.lng);
            return (
              <line key={`scanline${ti}`}
                x1={tp.x} y1={tp.y} x2={cp.x} y2={cp.y-12}
                stroke={tech.color||"#378ADD"} strokeWidth="1" strokeDasharray="4 3" opacity="0.5"
                style={{ animation:"scanline 1.4s linear infinite" }}
              />
            );
          })}

          {/* Complaint pins */}
          {visible.map((c, i) => {
            const coords = fallbackCoord(c, i);
            const {x,y} = toXY(coords.lat, coords.lng);
            const color = STATUS_COLORS[c.status] || "#888";
            const cat = CATEGORIES.find(k => k.id === c.category);
            const isSel = selected === (c.id||c.ref_id);
            const scale = isSel ? 1.25 : 1;
            const isActive = c.status === "In Progress" || c.status === "Escalated";
            return (
              <g key={c.id||c.ref_id} style={{ cursor:"pointer" }}
                onClick={() => handlePinClick(c)}
                onMouseEnter={() => setTooltip({c, x, y})}
                onMouseLeave={() => setTooltip(null)}>
                {/* Ripple for active */}
                {isActive && (
                  <circle cx={x} cy={y-2} r="14" fill={color} opacity="0.25"
                    style={{ animation:"ripple 1.6s ease-out infinite", transformOrigin:`${x}px ${(y-2)}px` }}/>
                )}
                {/* Glow */}
                <circle cx={x} cy={y-2} r={isSel ? 22 : 14} fill={color} opacity="0.15"/>
                {/* Pin body */}
                <path d={pinPath(x, y, scale)} fill={color} stroke="#fff" strokeWidth="1.5"/>
                {/* Inner circle */}
                <circle cx={x} cy={y-2*scale} r={5*scale} fill="white" opacity="0.9"/>
                <circle cx={x} cy={y-2*scale} r={2.5*scale} fill={color}/>
                {/* Category emoji label */}
                <text x={x} y={y+32*scale} textAnchor="middle" fontSize="9" fill={C.textMuted} fontFamily="'Segoe UI',sans-serif">{c.id||c.ref_id}</text>
              </g>
            );
          })}

          {/* Technician dots */}
          {technicians.map((tech, ti) => {
            const tc = fallbackCoord(tech, ti + 50);
            const {x,y} = toXY(tc.lat, tc.lng);
            const color = tech.color || "#378ADD";
            return (
              <g key={`tech${ti}`} style={{ cursor:"pointer" }}
                onMouseEnter={() => setTechCard(tech)}
                onMouseLeave={() => setTechCard(null)}>
                <circle cx={x} cy={y} r="16" fill={color} opacity="0.18"/>
                <circle cx={x} cy={y} r="10" fill={color} stroke="#fff" strokeWidth="2"
                  style={{ animation:"techpulse 1.4s ease-in-out infinite", transformOrigin:"center" }}/>
                <text x={x} y={y+1} textAnchor="middle" dominantBaseline="central" fontSize="8" fill="white" fontFamily="'Segoe UI',sans-serif" fontWeight="600">T</text>
              </g>
            );
          })}

          {/* Tooltip */}
          {tooltip && (() => {
            try {
            const {c, x, y} = tooltip;
            if (!c) return null;
            const cat = CATEGORIES.find(k => k.id === c.category);
            const color = STATUS_COLORS[c.status] || "#888";
            const tx = Math.min(x + 16, W - 200);
            const ty = Math.max(y - 75, 8);
            return (
              <g>
                <rect x={tx} y={ty} width="195" height="60" rx="8" fill="white" stroke={C.border} strokeWidth="0.8"
                  style={{ filter:"drop-shadow(0 2px 8px rgba(0,0,0,.12))" }}/>
                <rect x={tx} y={ty} width="4" height="60" rx="2" fill={color}/>
                <text x={tx+14} y={ty+16} fontSize="12" fontWeight="700" fill={C.text} fontFamily="'Segoe UI',sans-serif">{c.id||c.ref_id}</text>
                <text x={tx+14} y={ty+30} fontSize="10" fill={C.textMuted} fontFamily="'Segoe UI',sans-serif">{cat?.icon} {cat?.label}</text>
                <text x={tx+14} y={ty+44} fontSize="10" fill={color} fontFamily="'Segoe UI',sans-serif" fontWeight="600">{c.status} · {c.priority}</text>
                <text x={tx+14} y={ty+57} fontSize="9" fill="#94A3B8" fontFamily="'Segoe UI',sans-serif">{(c.address||"").slice(0,30)}{(c.address||"").length>30?"…":""}</text>
              </g>
            );
            } catch(e) { return null; }
          })()}
        </svg>

        {/* Technician hover card */}
        {techCard && (
          <div style={{ position:"absolute", top:8, left:8, background:"#fff", border:`1px solid ${C.border}`, borderRadius:10, padding:"9px 13px", fontSize:12, minWidth:170, boxShadow:"0 4px 16px rgba(0,0,0,.1)", animation:"fadein .15s ease" }}>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <span style={{ width:10, height:10, borderRadius:"50%", background:techCard.color||"#378ADD", display:"inline-block", flexShrink:0 }}/>
              <span style={{ fontWeight:700, color:C.text }}>{techCard.name}</span>
            </div>
            <div style={{ fontSize:11, color:C.textMuted, marginTop:3, paddingLeft:18 }}>{techCard.role || "Technician"} · {techCard.status_label||"En route"}</div>
          </div>
        )}

        {/* Map controls */}
        <div style={{ position:"absolute", top:8, right:8, display:"flex", flexDirection:"column", gap:4 }}>
          {["＋","－","⊞"].map((icon, i) => (
            <div key={i} style={{ width:28, height:28, background:"rgba(255,255,255,.92)", border:`1px solid ${C.border}`, borderRadius:6, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", fontSize:14, color:C.textMuted }}>
              {icon}
            </div>
          ))}
        </div>
      </div>

      {/* ── Footer ── */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"7px 14px", borderTop:`1px solid ${C.border}`, background:"#fff" }}>
        <div style={{ fontSize:11, color:C.textMuted }}>📍 {plotted} complaint{plotted!==1?"s":""} plotted</div>
        <div style={{ fontSize:11, fontWeight:600, color: footerMsg ? "#D97706" : C.textMuted }}>
          {footerMsg ? `⚡ ${footerMsg.id} — ${footerMsg.msg}` : "Emalahleni Local Municipality"}
        </div>
        <div style={{ fontSize:11, color:C.textMuted }}>Ward 8</div>
      </div>

      <style>{`
        @keyframes liveblink { 0%,100%{opacity:1} 50%{opacity:.25} }
        @keyframes ripple { 0%{r:10;opacity:.5} 100%{r:26;opacity:0} }
        @keyframes techpulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.3)} }
        @keyframes scanline { 0%{stroke-dashoffset:0} 100%{stroke-dashoffset:-28} }
        @keyframes fadein { from{opacity:0;transform:translateY(3px)} to{opacity:1;transform:translateY(0)} }
      `}</style>
    </div>
  );
}


/* ─── LOGIN PAGE ────────────────────────────────────────────────── */
const ROLES = [
  { role:"Citizen",      icon:"👤", color:"#1D4ED8", bg:"#EFF6FF" },
  { role:"Administrator",icon:"⚙️", color:"#7C3AED", bg:"#EDE9FE" },
  { role:"Technician",   icon:"👷", color:"#059669", bg:"#D1FAE5" },
  { role:"Councillor",   icon:"⚖️", color:"#DC2626", bg:"#FEE2E2" },
];

function LoginPage({ onLogin, onGoRegister }) {
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [showPw,setShowPw]=useState(false);
  const [loading,setLoading]=useState(false);
  const [err,setErr]=useState("");
  const [selectedRole,setSelectedRole]=useState(null);

  const DEMO = {
    Citizen:       "colette@smartcity.gov.za",
    Administrator: "samson@smartcity.gov.za",
    Technician:    "skosana@smartcity.gov.za",
    Councillor:    "pale@smartcity.gov.za",
  };

  const pickRole = (role) => {
    setSelectedRole(role);
    setEmail(DEMO[role]);
    setErr("");
  };

  const submit = async () => {
    setErr("");
    if(!email||!password){setErr("Please fill in all fields.");return;}
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/login`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password})});
      const data = await res.json();
      if(data.success){localStorage.setItem("token",data.token);onLogin(data.user);}
      else{setErr(data.message||"Invalid email or password.");setLoading(false);}
    } catch (_e) {setErr("Cannot connect to server.");setLoading(false);}
  };

  const active = selectedRole ? ROLES.find(r=>r.role===selectedRole) : null;

  return (
    <div style={{ minHeight:"100vh",background:`linear-gradient(145deg,${C.navy} 0%,${C.navyMid} 60%,#1E3A5F 100%)`,display:"flex",alignItems:"center",justifyContent:"center",padding:20,fontFamily:"'Segoe UI',system-ui,sans-serif" }}>
      {/* decorative skyline */}
      <div style={{ position:"fixed",bottom:0,left:0,right:0,height:120,opacity:.06,pointerEvents:"none",overflow:"hidden" }}>
        {[40,80,60,120,70,90,50,110,65,85,45,100].map((h,i)=>(
          // eslint-disable-next-line react/no-array-index-key
          <div key={i} style={{ position:"absolute",bottom:0,left:`${i*8.5}%`,width:55,height:h,background:"#fff",borderRadius:"4px 4px 0 0" }}/>
        ))}
      </div>

      <div style={{ width:"100%",maxWidth:460 }}>
        {/* Header */}
        <div style={{ textAlign:"center",marginBottom:32 }}>
          <div style={{ width:68,height:68,borderRadius:20,background:"rgba(255,255,255,.12)",border:"1px solid rgba(255,255,255,.2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:34,margin:"0 auto 16px" }}>📊</div>
          <h1 style={{ margin:0,color:"#fff",fontSize:27,fontWeight:800,letterSpacing:"-.3px" }}>Smart Reporting System</h1>
          <p style={{ margin:"8px 0 0",color:"rgba(255,255,255,.55)",fontSize:14 }}>Emalahleni Municipal Services</p>
        </div>

        <div style={{ background:"#fff",borderRadius:22,padding:"28px 28px 24px",boxShadow:"0 24px 80px rgba(0,0,0,.35)" }}>
          {/* Role selector */}
          <p style={{ margin:"0 0 12px",fontSize:12,fontWeight:700,color:C.textMuted,textTransform:"uppercase",letterSpacing:".6px" }}>Sign in as</p>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:22 }}>
            {ROLES.map(({role,icon,color,bg})=>{
              const isSel = selectedRole===role;
              return(
                <div key={role} onClick={()=>pickRole(role)}
                  style={{ padding:"11px 12px",borderRadius:12,border:isSel?`2px solid ${color}`:`1.5px solid ${C.border}`,cursor:"pointer",background:isSel?bg:"#F8FAFC",display:"flex",alignItems:"center",gap:9,transition:"all .15s" }}>
                  <span style={{ fontSize:20 }}>{icon}</span>
                  <div>
                    <div style={{ fontSize:13,fontWeight:700,color:isSel?color:C.text }}>{role}</div>
                  </div>
                  {isSel&&<span style={{ marginLeft:"auto",fontSize:10,color,fontWeight:700 }}>✓</span>}
                </div>
              );
            })}
          </div>

          {/* Credentials */}
          {err && <div style={{ background:"#FEF2F2",border:"1px solid #FECACA",borderRadius:10,padding:"10px 14px",marginBottom:16,fontSize:13,color:"#DC2626" }}>⚠️ {err}</div>}

          <label style={{ fontSize:12,fontWeight:600,color:C.textMuted,display:"block",marginBottom:6,textTransform:"uppercase",letterSpacing:".5px" }}>Email address</label>
          <input value={email} onChange={e=>setEmail(e.target.value)} type="email" placeholder="you@smartcity.gov.za" onKeyDown={e=>e.key==="Enter"&&submit()}
            style={{ width:"100%",padding:"11px 14px",borderRadius:10,border:`1.5px solid ${active?active.color:C.border}`,fontSize:14,marginBottom:16,boxSizing:"border-box",outline:"none",fontFamily:"inherit",transition:"border-color .2s" }}/>

          <label style={{ fontSize:12,fontWeight:600,color:C.textMuted,display:"block",marginBottom:6,textTransform:"uppercase",letterSpacing:".5px" }}>Password</label>
          <div style={{ position:"relative",marginBottom:22 }}>
            <input value={password} onChange={e=>setPassword(e.target.value)} type={showPw?"text":"password"} placeholder="••••••••" onKeyDown={e=>e.key==="Enter"&&submit()}
              style={{ width:"100%",padding:"11px 44px 11px 14px",borderRadius:10,border:`1.5px solid ${active?active.color:C.border}`,fontSize:14,boxSizing:"border-box",outline:"none",fontFamily:"inherit",transition:"border-color .2s" }}/>
            <button onClick={()=>setShowPw(p=>!p)} style={{ position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",fontSize:16,color:C.textMuted }}>{showPw?"🙈":"👁️"}</button>
          </div>

          <button onClick={submit} disabled={loading} style={{ width:"100%",padding:"13px",background:loading?"#93C5FD":active?`linear-gradient(135deg,${active.color},${C.teal})`:`linear-gradient(135deg,${C.blue},${C.teal})`,color:"#fff",border:"none",borderRadius:12,fontSize:15,fontWeight:700,cursor:loading?"not-allowed":"pointer",transition:"background .2s" }}>
            {loading?"Signing in…":`Sign In ${active?`as ${active.icon}`:"→"}`}
          </button>

          <div style={{ marginTop:16,padding:"11px 14px",background:"#FFFBEB",borderRadius:10,fontSize:12,color:"#92400E",border:"1px solid #FDE68A" }}>
            💡 <strong>Demo:</strong> Click a role above to auto-fill the email, then use password <strong>Password1!</strong>
          </div>

          <p style={{ textAlign:"center",marginTop:18,fontSize:13,color:C.textMuted }}>
            No account? <button onClick={onGoRegister} style={{ background:"none",border:"none",color:C.blue,fontWeight:600,cursor:"pointer",fontSize:13 }}>Register here →</button>
          </p>
        </div>
      </div>
    </div>
  );
}

/* ─── REGISTER PAGE ─────────────────────────────────────────────── */

// Role → required email domain
const ROLE_EMAIL_DOMAINS = {
  Citizen:       "@citizen.co.za",
  Technician:    "@technician.gov.za",
  Administrator: "@admin.gov.za",
  Councillor:    "@councillor.gov.za",
};

// Password strength checker
function getPasswordStrength(pw) {
  const checks = {
    length:    pw.length >= 8 && pw.length <= 15,
    maxLength: pw.length <= 15,
    upper:     (pw.match(/[A-Z]/g)||[]).length >= 2,
    numbers:   (pw.match(/[0-9]/g)||[]).length >= 2,
    special:   /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(pw),
  };
  const passed = Object.values(checks).filter(Boolean).length;
  return { checks, score: passed, strong: passed === 5 };
}

function PasswordStrengthBar({ password }) {
  if (!password) return null;
  const { checks, score } = getPasswordStrength(password);
  const colors = ["#EF4444","#F59E0B","#F59E0B","#10B981","#10B981"];
  const labels = ["Very Weak","Weak","Fair","Strong","Very Strong"];
  return (
    <div style={{marginTop:8,marginBottom:4}}>
      <div style={{display:"flex",gap:3,marginBottom:6}}>
        {[0,1,2,3,4].map(i=>(
          <div key={i} style={{flex:1,height:4,borderRadius:2,background:i<score?colors[score-1]:"#E5E7EB",transition:"background .3s"}}/>
        ))}
      </div>
      <div style={{fontSize:11,color:colors[Math.max(0,score-1)],fontWeight:600,marginBottom:6}}>{labels[Math.max(0,score-1)]}</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:2}}>
        {[
          {k:"length",  label:`8–15 chars (${password.length})`},
          {k:"upper",   label:"≥2 uppercase letters"},
          {k:"numbers", label:"≥2 numbers"},
          {k:"special", label:"1 special character (!@#…)"},
        ].map(({k,label})=>(
          <div key={k} style={{fontSize:11,color:checks[k]?"#059669":"#9CA3AF",display:"flex",alignItems:"center",gap:4}}>
            <span>{checks[k]?"✓":"○"}</span>{label}
          </div>
        ))}
      </div>
    </div>
  );
}

function RegField({label,k,type,placeholder,value,onChange,error,hint}){
  return(
    <div style={{marginBottom:16}}>
      <label style={{fontSize:12,fontWeight:600,color:C.textMuted,display:"block",marginBottom:6,textTransform:"uppercase",letterSpacing:".5px"}}>{label}</label>
      <input value={value} onChange={onChange} type={type||"text"} placeholder={placeholder}
        style={{width:"100%",padding:"11px 14px",borderRadius:10,border:`1.5px solid ${error?"#F87171":C.border}`,fontSize:14,boxSizing:"border-box",outline:"none",fontFamily:"inherit"}}/>
      {hint&&!error&&<p style={{margin:"4px 0 0",fontSize:11,color:C.textMuted}}>{hint}</p>}
      {error&&<p style={{margin:"4px 0 0",fontSize:12,color:"#EF4444"}}>⚠️ {error}</p>}
    </div>
  );
}

function RegisterPage({ onBack, onRegistered }) {
  const [form,setForm]=useState({name:"",id:"",email:"",password:"",confirm:"",role:"Citizen"});
  const [loading,setLoading]=useState(false);
  const [done,setDone]=useState(false);
  const [errs,setErrs]=useState({});
  const [showPw,setShowPw]=useState(false);
  const [showConfirm,setShowConfirm]=useState(false);
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));

  // When role changes, clear email so user re-enters with correct domain
  const setRole=(role)=>{
    set("role",role);
    setErrs(e=>({...e,email:"",role:""}));
  };

  const validate=()=>{
    const e={};
    // Full name: no numbers allowed
    if(!form.name.trim()) e.name="Full name is required";
    else if(/[0-9]/.test(form.name)) e.name="Full name must not contain numbers";
    else if(form.name.trim().split(/\s+/).length < 2) e.name="Please enter your full name (first and last)";

    // SA ID: exactly 13 digits
    if(!form.id.trim()) e.id="SA ID number is required";
    else if(!/^\d{13}$/.test(form.id.trim())) e.id="SA ID number must be exactly 13 digits";

    // Email: must match role domain
    const requiredDomain = ROLE_EMAIL_DOMAINS[form.role];
    if(!form.email.trim()) e.email="Email address is required";
    else if(!form.email.toLowerCase().endsWith(requiredDomain))
      e.email=`${form.role} email must end with ${requiredDomain}`;

    // Password: 8–15 chars, ≥2 uppercase, ≥2 numbers, 1 special char
    const pwStrength = getPasswordStrength(form.password);
    if(!form.password) e.password="Password is required";
    else if(!pwStrength.checks.length) e.password="Password must be 8–15 characters long";
    else if(!pwStrength.checks.upper) e.password="Password needs at least 2 uppercase letters";
    else if(!pwStrength.checks.numbers) e.password="Password needs at least 2 numbers";
    else if(!pwStrength.checks.special) e.password="Password needs at least 1 special character";

    if(form.password !== form.confirm) e.confirm="Passwords do not match";

    setErrs(e); return Object.keys(e).length===0;
  };

  const submit=async()=>{
    if(!validate())return; setLoading(true);
    try{
      const res=await fetch(`${API}/api/auth/register`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id_number:form.id.trim(),full_name:form.name.trim(),email:form.email.trim().toLowerCase(),password:form.password,role:form.role})});
      const data=await res.json();
      if(data.success){setDone(true);setTimeout(()=>onRegistered(),1800);}
      else{setErrs({email:data.message||"Registration failed. Please try again."});setLoading(false);}
    }catch(_e){setErrs({email:"Cannot connect to server. Please try again."});setLoading(false);}
  };

  const emailPlaceholder = `yourname${ROLE_EMAIL_DOMAINS[form.role]}`;

  if(done)return(
    <div style={{minHeight:"100vh",background:`linear-gradient(145deg,${C.navy} 0%,${C.navyMid} 100%)`,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{background:"#fff",borderRadius:20,padding:"48px 32px",textAlign:"center",maxWidth:380,width:"90%"}}>
        <div style={{fontSize:64,marginBottom:16}}>✅</div>
        <h2 style={{color:"#065F46"}}>Account Created!</h2>
        <p style={{color:C.textMuted,fontSize:14}}>Redirecting to login…</p>
      </div>
    </div>
  );
  return(
    <div style={{minHeight:"100vh",background:`linear-gradient(145deg,${C.navy} 0%,${C.navyMid} 100%)`,display:"flex",alignItems:"center",justifyContent:"center",padding:20,fontFamily:"'Segoe UI',system-ui,sans-serif"}}>
      <div style={{width:"100%",maxWidth:480}}>
        <div style={{textAlign:"center",marginBottom:28}}>
          <div style={{fontSize:34,marginBottom:8}}>📊</div>
          <h1 style={{margin:0,color:"#fff",fontSize:22,fontWeight:800}}>Smart Reporting System</h1>
          <p style={{margin:"6px 0 0",color:"rgba(255,255,255,.55)",fontSize:13}}>Create your account</p>
        </div>
        <div style={{background:"#fff",borderRadius:20,padding:"30px 26px",boxShadow:"0 24px 80px rgba(0,0,0,.35)"}}>

          {/* STEP 1: Select Role FIRST */}
          <div style={{marginBottom:20}}>
            <label style={{fontSize:12,fontWeight:600,color:C.textMuted,display:"block",marginBottom:8,textTransform:"uppercase",letterSpacing:".5px"}}>
              Account Role <span style={{color:"#EF4444"}}>*</span>
            </label>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              {[
                {role:"Citizen",icon:"👤",desc:"Report & track issues",color:"#1D4ED8",bg:"#EFF6FF"},
                {role:"Technician",icon:"👷",desc:"Field worker",color:"#059669",bg:"#D1FAE5"},
                {role:"Administrator",icon:"⚙️",desc:"Manage complaints",color:"#7C3AED",bg:"#EDE9FE"},
                {role:"Councillor",icon:"⚖️",desc:"Council decisions",color:"#DC2626",bg:"#FEE2E2"},
              ].map(({role,icon,desc,color,bg})=>(
                <div key={role} onClick={()=>setRole(role)}
                  style={{padding:"10px 12px",borderRadius:10,border:form.role===role?`2px solid ${color}`:`1.5px solid ${C.border}`,cursor:"pointer",background:form.role===role?bg:"#F8FAFC",display:"flex",alignItems:"center",gap:8,transition:"all .15s"}}>
                  <span style={{fontSize:18}}>{icon}</span>
                  <div>
                    <div style={{fontSize:13,fontWeight:700,color:form.role===role?color:C.text}}>{role}</div>
                    <div style={{fontSize:10,color:C.textMuted}}>{desc}</div>
                  </div>
                  {form.role===role&&<span style={{marginLeft:"auto",fontSize:10,color,fontWeight:700}}>✓</span>}
                </div>
              ))}
            </div>
            {/* Show required email domain hint for selected role */}
            <div style={{marginTop:8,padding:"8px 12px",background:"#EFF6FF",borderRadius:8,fontSize:12,color:"#1E40AF",border:"1px solid #BFDBFE"}}>
              📧 {form.role} email must end with <strong>{ROLE_EMAIL_DOMAINS[form.role]}</strong>
            </div>
          </div>

          {/* Full Name */}
          <RegField label="Full Name" k="name" placeholder="e.g. Thabo Ndlovu" value={form.name}
            onChange={e=>set("name",e.target.value)} error={errs.name} hint="Letters and spaces only — no numbers"/>

          {/* SA ID */}
          <RegField label="SA ID Number" k="id" placeholder="e.g. 9001015009087" value={form.id}
            onChange={e=>set("id",e.target.value.replace(/\D/g,"").slice(0,13))} error={errs.id}
            hint={`${form.id.length}/13 digits`}/>

          {/* Email */}
          <RegField label="Email Address" k="email" type="email" placeholder={emailPlaceholder} value={form.email}
            onChange={e=>set("email",e.target.value)} error={errs.email}
            hint={`Must end with ${ROLE_EMAIL_DOMAINS[form.role]}`}/>

          {/* Password with strength meter */}
          <div style={{marginBottom:16}}>
            <label style={{fontSize:12,fontWeight:600,color:C.textMuted,display:"block",marginBottom:6,textTransform:"uppercase",letterSpacing:".5px"}}>
              Password <span style={{color:"#EF4444"}}>*</span>
            </label>
            <div style={{position:"relative"}}>
              <input value={form.password} onChange={e=>set("password",e.target.value)}
                type={showPw?"text":"password"} placeholder="Min 8 chars, max 15"
                style={{width:"100%",padding:"11px 44px 11px 14px",borderRadius:10,border:`1.5px solid ${errs.password?"#F87171":C.border}`,fontSize:14,boxSizing:"border-box",outline:"none",fontFamily:"inherit"}}/>
              <button onClick={()=>setShowPw(p=>!p)} style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",fontSize:16,color:C.textMuted}}>{showPw?"🙈":"👁️"}</button>
            </div>
            <PasswordStrengthBar password={form.password}/>
            {errs.password&&<p style={{margin:"4px 0 0",fontSize:12,color:"#EF4444"}}>⚠️ {errs.password}</p>}
          </div>

          {/* Confirm Password */}
          <div style={{marginBottom:20}}>
            <label style={{fontSize:12,fontWeight:600,color:C.textMuted,display:"block",marginBottom:6,textTransform:"uppercase",letterSpacing:".5px"}}>
              Confirm Password <span style={{color:"#EF4444"}}>*</span>
            </label>
            <div style={{position:"relative"}}>
              <input value={form.confirm} onChange={e=>set("confirm",e.target.value)}
                type={showConfirm?"text":"password"} placeholder="Repeat your password"
                style={{width:"100%",padding:"11px 44px 11px 14px",borderRadius:10,border:`1.5px solid ${errs.confirm?"#F87171":form.confirm&&form.confirm===form.password?"#10B981":C.border}`,fontSize:14,boxSizing:"border-box",outline:"none",fontFamily:"inherit"}}/>
              <button onClick={()=>setShowConfirm(p=>!p)} style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",fontSize:16,color:C.textMuted}}>{showConfirm?"🙈":"👁️"}</button>
            </div>
            {form.confirm&&form.confirm===form.password&&<p style={{margin:"4px 0 0",fontSize:12,color:"#059669"}}>✓ Passwords match</p>}
            {errs.confirm&&<p style={{margin:"4px 0 0",fontSize:12,color:"#EF4444"}}>⚠️ {errs.confirm}</p>}
          </div>

          <button onClick={submit} disabled={loading} style={{width:"100%",padding:13,background:loading?"#93C5FD":`linear-gradient(135deg,${C.blue},${C.teal})`,color:"#fff",border:"none",borderRadius:12,fontSize:15,fontWeight:700,cursor:loading?"not-allowed":"pointer"}}>
            {loading?"Creating account…":"Create Account →"}
          </button>
          <p style={{textAlign:"center",marginTop:18,fontSize:13,color:C.textMuted}}>
            Already registered? <button onClick={onBack} style={{background:"none",border:"none",color:C.blue,fontWeight:600,cursor:"pointer"}}>Sign in →</button>
          </p>
        </div>
      </div>
    </div>
  );
}

/* ─── SHARED HEADER ─────────────────────────────────────────────── */
function Header({ user, onLogout, tabs, activeTab, setActiveTab, accentColor="#1D4ED8", roleIcon="🏙️" }) {
  return (
    <div style={{ background:`linear-gradient(135deg,${C.navy} 0%,${C.navyMid} 100%)`,color:"#fff",padding:"0 20px",fontFamily:"'Segoe UI',system-ui,sans-serif" }}>
      <div style={{ maxWidth:1100,margin:"0 auto" }}>
        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 0" }}>
          <div style={{ display:"flex",alignItems:"center",gap:12 }}>
            <div style={{ width:38,height:38,borderRadius:10,background:"rgba(255,255,255,.15)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20 }}>{roleIcon}</div>
            <div>
              <div style={{ fontWeight:700,fontSize:15 }}>Smart Reporting System</div>
              <div style={{ fontSize:10,opacity:.6 }}>Emalahleni Municipal Services</div>
            </div>
          </div>
          <div style={{ display:"flex",alignItems:"center",gap:14 }}>
            <div style={{ display:"flex",alignItems:"center",gap:9 }}>
              <div style={{ width:34,height:34,borderRadius:"50%",background:accentColor,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700 }}>
                {(user.full_name||user.name||"U").split(" ").map(w=>w[0]).join("").slice(0,2)}
              </div>
              <div>
                <div style={{ fontSize:13,fontWeight:600 }}>{user.full_name||user.name}</div>
                <div style={{ fontSize:10,opacity:.6 }}>{user.role} · {user.id_number||user.id}</div>
              </div>
            </div>
            <button onClick={onLogout} style={{ background:"rgba(255,255,255,.12)",border:"1px solid rgba(255,255,255,.2)",color:"#fff",padding:"7px 14px",borderRadius:8,fontSize:12,cursor:"pointer",fontWeight:600 }}>
              Sign Out
            </button>
          </div>
        </div>
        <div style={{ display:"flex",gap:0,overflowX:"auto" }}>
          {tabs.map(([v,label])=>(
            <button key={v} onClick={()=>setActiveTab(v)}
              style={{ background:activeTab===v?"rgba(255,255,255,.18)":"transparent",color:"#fff",border:"none",borderBottom:activeTab===v?"3px solid #fff":"3px solid transparent",padding:"10px 18px",fontSize:13,fontWeight:activeTab===v?700:400,cursor:"pointer",transition:"all .2s",whiteSpace:"nowrap" }}>
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   CITIZEN PORTAL
═══════════════════════════════════════════════════════════════════ */
function CitizenPortal({ user, onLogout }) {
  const [view,setView]=useState("dashboard");
  const [complaints,setComplaints]=useState([]);
  const [loading,setLoading]=useState(true);
  const [notif,setNotif]=useState(null);
  const [showForm,setShowForm]=useState(false);
  const [selected,setSelected]=useState(null);
  const [filterCat,setFilterCat]=useState("all");
  const [filterStatus,setFilterStatus]=useState("all");
  const [reviewModal,setReviewModal]=useState(null);
  const [notifications,setNotifications]=useState([
    { id:1, subject:"⚡ Planned Power Outage", message:"Electricity will be off in Zone 4 on 15 Apr 06:00–14:00 for maintenance.", time:"2h ago", read:false, type:"warning" },
    { id:2, subject:"💧 Water Disruption Notice", message:"Water supply interrupted in Soweto area due to burst main. Estimated restoration: 18:00 today.", time:"5h ago", read:false, type:"info" },
    { id:3, subject:"✅ Complaint CMP-003 Resolved", message:"Your electricity fault complaint has been resolved. Please rate the service.", time:"1d ago", read:true, type:"success" },
  ]);

  const loadComplaints=useCallback(async()=>{
    try{
      setLoading(true);
      const token=localStorage.getItem("token");
      const res=await fetch(`${API}/api/complaints`,{headers:{Authorization:`Bearer ${token}`}});
      const data=await res.json();
      if(data.success){
        const list=data.complaints||data.data||[];
        setComplaints(list.map(c=>({
          id:c.ref_id||c.id, dbId:c.id, category:c.category, description:c.description,
          status:c.status||"Submitted", priority:c.priority||"Medium", date:c.created_at?.slice(0,10)||c.date,
          address:c.address, lat:parseFloat(c.latitude)||(-26.2041), lng:parseFloat(c.longitude)||28.0473,
          rating:c.rating, canRequestReview:!c.council_review_requested,
        })));
      }
    }catch(e){console.error(e);}finally{setLoading(false);}
  },[]);

  useEffect(()=>{loadComplaints();},[loadComplaints]);

  const notify=(msg,type="success")=>setNotif({msg,type});

  const handleSubmit=async data=>{
    const token=localStorage.getItem("token");
    const form=new FormData();
    form.append("category",data.cat); form.append("description",data.desc);
    form.append("address",data.addr);
    form.append("latitude",data.coords?.lat??-26.2041);
    form.append("longitude",data.coords?.lng??28.0473);
    if(data.photo)form.append("photo",data.photo);
    const res=await fetch(`${API}/api/complaints`,{method:"POST",headers:{Authorization:`Bearer ${token}`},body:form});
    const result=await res.json();
    if(result.success){notify(`${result.ref_id} submitted!`);await loadComplaints();setShowForm(false);setView("complaints");}
    else{notify(result.message||"Failed","error");throw new Error(result.message);}
  };

  const filtered=complaints.filter(c=>(filterCat==="all"||c.category===filterCat)&&(filterStatus==="all"||c.status===filterStatus));
  const stats={ total:complaints.length, active:complaints.filter(c=>c.status!=="Resolved").length, resolved:complaints.filter(c=>c.status==="Resolved").length, high:complaints.filter(c=>["High","Critical"].includes(c.priority)).length };
  const unreadNotifs=notifications.filter(n=>!n.read).length;

  const tabs=[["dashboard","🏠 Dashboard"],["complaints","📋 My Complaints"],["map","🗺️ Map View"],["notifications",`🔔 Alerts${unreadNotifs>0?` (${unreadNotifs})`:""}`]];

  return (
    <div style={{ fontFamily:"'Segoe UI',system-ui,sans-serif",minHeight:"100vh",background:C.slateLight }}>
      {notif&&<Notif {...notif} onDone={()=>setNotif(null)}/>}
      {reviewModal&&(
        <div style={{ position:"fixed",inset:0,background:"rgba(15,23,42,.65)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center" }}>
          <div style={{ background:"#fff",borderRadius:18,padding:30,maxWidth:400,width:"90%" }}>
            <h3 style={{ margin:"0 0 12px",color:C.text }}>⚖️ Request Council Review</h3>
            <p style={{ color:C.textMuted,fontSize:14,lineHeight:1.6 }}>This will escalate <strong>{reviewModal}</strong> to the Councillor queue for urgent review.</p>
            <div style={{ display:"flex",gap:10,marginTop:22 }}>
              <button onClick={()=>setReviewModal(null)} style={{ flex:1,padding:11,background:C.slateLight,border:`1.5px solid ${C.border}`,borderRadius:10,fontSize:14,cursor:"pointer" }}>Cancel</button>
              <button onClick={async()=>{
                const c=complaints.find(x=>x.id===reviewModal);
                const token=localStorage.getItem("token");
                await fetch(`${API}/api/complaints/${c.dbId}/request-review`,{method:"POST",headers:{Authorization:`Bearer ${token}`}});
                setReviewModal(null); notify("Council review requested!","info");
              }} style={{ flex:2,padding:11,background:"#7C3AED",color:"#fff",border:"none",borderRadius:10,fontSize:14,fontWeight:700,cursor:"pointer" }}>
                Confirm Request
              </button>
            </div>
          </div>
        </div>
      )}

      <Header user={user} onLogout={onLogout} tabs={tabs} activeTab={view} setActiveTab={v=>{setView(v);if(v!=="dashboard")setShowForm(false);}} accentColor={C.blue} roleIcon="👤"/>

      <div style={{ maxWidth:1100,margin:"0 auto",padding:"24px 20px" }}>
        {/* New Report button */}
        {view!=="notifications"&&(
          <div style={{ display:"flex",justifyContent:"flex-end",marginBottom:16 }}>
            <button onClick={()=>{setShowForm(true);setView("dashboard");}} style={{ background:C.blue,color:"#fff",border:"none",padding:"10px 20px",borderRadius:10,fontSize:14,fontWeight:700,cursor:"pointer" }}>
              ➕ New Report
            </button>
          </div>
        )}

        {/* Submit Form */}
        {showForm&&(
          <div style={{ background:"#fff",borderRadius:18,padding:26,marginBottom:24,boxShadow:"0 4px 24px rgba(0,0,0,.08)",border:`1px solid ${C.border}` }}>
            <CitizenSubmitForm onSubmit={handleSubmit} onClose={()=>setShowForm(false)}/>
          </div>
        )}

        {/* DASHBOARD */}
        {!showForm&&view==="dashboard"&&(
          <div>
            <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:14,marginBottom:22 }}>
              <StatCard icon="📋" label="Total Complaints" value={loading?"…":stats.total} color={C.blue}/>
              <StatCard icon="⏳" label="Active Cases" value={loading?"…":stats.active} color="#F59E0B"/>
              <StatCard icon="✅" label="Resolved" value={loading?"…":stats.resolved} color="#10B981"/>
              <StatCard icon="🚨" label="High Priority" value={loading?"…":stats.high} color="#EF4444"/>
            </div>
            {unreadNotifs>0&&(
              <div onClick={()=>setView("notifications")} style={{ background:"#FFF7ED",border:"1px solid #FED7AA",borderRadius:12,padding:"12px 16px",marginBottom:20,cursor:"pointer",display:"flex",alignItems:"center",gap:12 }}>
                <span style={{ fontSize:22 }}>🔔</span>
                <div>
                  <div style={{ fontWeight:600,color:"#92400E",fontSize:14 }}>{unreadNotifs} unread municipal alert{unreadNotifs>1?"s":""}</div>
                  <div style={{ fontSize:12,color:"#B45309" }}>Click to view power outages, water disruptions and updates</div>
                </div>
              </div>
            )}
            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:20 }}>
              <div style={{ background:"#fff",borderRadius:14,padding:20,border:`1px solid ${C.border}` }}>
                <h3 style={{ margin:"0 0 14px",fontSize:13,color:C.textMuted,fontWeight:700,letterSpacing:".5px" }}>QUICK ACTIONS</h3>
                {[["➕ Report New Issue",()=>setShowForm(true),C.blue],["📋 View My Complaints",()=>setView("complaints"),"#059669"],["🗺️ Open Map View",()=>setView("map"),"#7C3AED"]].map(([label,action,color])=>(
                  <button key={label} onClick={action} style={{ display:"block",width:"100%",textAlign:"left",padding:"11px 14px",marginBottom:8,background:color+"12",color,border:`1px solid ${color}30`,borderRadius:10,fontSize:13,fontWeight:600,cursor:"pointer" }}>{label}</button>
                ))}
              </div>
              <div style={{ background:"#fff",borderRadius:14,padding:20,border:`1px solid ${C.border}` }}>
                <h3 style={{ margin:"0 0 14px",fontSize:13,color:C.textMuted,fontWeight:700,letterSpacing:".5px" }}>RECENT ACTIVITY</h3>
                {complaints.slice(0,4).map(c=>{
                  const cat=CATEGORIES.find(k=>k.id===c.category);
                  return(
                    <div key={c.id} onClick={()=>{setView("complaints");setSelected(c.id);}} style={{ display:"flex",alignItems:"center",gap:10,marginBottom:10,cursor:"pointer",padding:"8px 10px",borderRadius:8,background:C.slateLight }}>
                      <span style={{ fontSize:18 }}>{cat?.icon}</span>
                      <div style={{ flex:1,minWidth:0 }}>
                        <div style={{ fontSize:12,fontWeight:700,color:C.text }}>{c.id} · {cat?.label}</div>
                        <div style={{ fontSize:11,color:"#94A3B8" }}>{c.status} · {c.date}</div>
                      </div>
                      <Badge priority={c.priority}/>
                    </div>
                  );
                })}
                {complaints.length===0&&<div style={{ color:C.textMuted,fontSize:13,textAlign:"center",paddingTop:20 }}>No complaints yet</div>}
              </div>
            </div>
            <div style={{ background:"#fff",borderRadius:14,padding:20,border:`1px solid ${C.border}` }}>
              <h3 style={{ margin:"0 0 14px",fontSize:13,color:C.textMuted,fontWeight:700,letterSpacing:".5px" }}>LIVE COMPLAINT MAP</h3>
              <LiveTrackingMap complaints={complaints} selected={selected} onSelect={setSelected} title="Live Complaint Map" height={300}/>
            </div>
          </div>
        )}

        {/* COMPLAINTS LIST */}
        {!showForm&&view==="complaints"&&(
          <div>
            <div style={{ display:"flex",gap:10,marginBottom:18,flexWrap:"wrap",alignItems:"center" }}>
              <select value={filterCat} onChange={e=>setFilterCat(e.target.value)} style={{ borderRadius:10,border:`1.5px solid ${C.border}`,padding:"9px 12px",fontSize:13,background:"#fff",cursor:"pointer" }}>
                <option value="all">All Categories</option>
                {CATEGORIES.map(c=><option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
              </select>
              <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} style={{ borderRadius:10,border:`1.5px solid ${C.border}`,padding:"9px 12px",fontSize:13,background:"#fff",cursor:"pointer" }}>
                <option value="all">All Statuses</option>
                {STATUS_STEPS.map(s=><option key={s} value={s}>{s}</option>)}
              </select>
              <button onClick={loadComplaints} style={{ padding:"9px 14px",background:C.blue,color:"#fff",border:"none",borderRadius:10,fontSize:13,cursor:"pointer",fontWeight:600 }}>🔄 Refresh</button>
              <span style={{ marginLeft:"auto",fontSize:13,color:"#94A3B8" }}>{filtered.length} result{filtered.length!==1?"s":""}</span>
            </div>
            {filtered.length===0
              ?<div style={{ textAlign:"center",padding:"60px 20px",color:"#94A3B8" }}><div style={{ fontSize:48,marginBottom:12 }}>📭</div><div>No complaints found</div></div>
              :filtered.map(c=>(
                <div key={c.id} onClick={()=>setSelected(s=>s===c.id?null:c.id)}
                  style={{ background:selected===c.id?"#EFF6FF":"#fff",border:selected===c.id?`2px solid ${C.blue}`:`1px solid ${C.border}`,borderRadius:14,padding:"15px 16px",cursor:"pointer",marginBottom:10 }}>
                  <div style={{ display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:10 }}>
                    <div style={{ display:"flex",alignItems:"center",gap:10 }}>
                      <div style={{ width:42,height:42,borderRadius:11,background:CATEGORIES.find(k=>k.id===c.category)?.bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0 }}>
                        {CATEGORIES.find(k=>k.id===c.category)?.icon}
                      </div>
                      <div>
                        <div style={{ display:"flex",alignItems:"center",gap:8,flexWrap:"wrap" }}>
                          <span style={{ fontWeight:700,fontSize:13,color:C.text }}>{c.id}</span>
                          <Badge priority={c.priority}/>
                        </div>
                        <div style={{ fontSize:12,color:C.textMuted,marginTop:2 }}>{CATEGORIES.find(k=>k.id===c.category)?.label} · {c.date}</div>
                      </div>
                    </div>
                    <span style={{ fontSize:11,fontWeight:600,padding:"4px 10px",borderRadius:20,background:c.status==="Resolved"?"#D1FAE5":"#DBEAFE",color:c.status==="Resolved"?"#065F46":"#1E40AF",whiteSpace:"nowrap" }}>{c.status}</span>
                  </div>
                  <p style={{ fontSize:13,color:"#475569",margin:"10px 0 6px",lineHeight:1.55 }}>{c.description}</p>
                  <div style={{ fontSize:12,color:"#94A3B8",marginBottom:8 }}>📍 {c.address}</div>
                  <StatusBar status={c.status}/>
                  {c.status==="Resolved"&&!c.rating&&(
                    <div style={{ marginTop:12,padding:"10px 12px",background:C.slateLight,borderRadius:10,border:`1px solid ${C.border}` }}>
                      <div style={{ fontSize:12,color:C.textMuted,marginBottom:6 }}>Rate this resolution</div>
                      <div style={{ display:"flex",gap:4 }}>
                        {[1,2,3,4,5].map(s=>(
                          <span key={s} onClick={async e=>{
                            e.stopPropagation();
                            const token=localStorage.getItem("token");
                            await fetch(`${API}/api/complaints/${c.dbId}/rate`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({rating:s})});
                            loadComplaints(); notify("Rating submitted!");
                          }} style={{ fontSize:22,cursor:"pointer",color:"#D1D5DB" }}>★</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {c.canRequestReview&&c.status!=="Resolved"&&(
                    <button onClick={e=>{e.stopPropagation();setReviewModal(c.id);}} style={{ marginTop:10,fontSize:12,color:"#7C3AED",background:"#EDE9FE",border:"none",padding:"6px 14px",borderRadius:8,cursor:"pointer",fontWeight:600 }}>
                      ⚖️ Request Council Review
                    </button>
                  )}
                </div>
              ))
            }
          </div>
        )}

        {/* MAP VIEW */}
        {!showForm&&view==="map"&&(
          <div>
            <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:12,marginBottom:16 }}>
              {CATEGORIES.map(cat=>(
                <div key={cat.id} style={{ background:"#fff",borderRadius:12,padding:"12px 14px",border:`1.5px solid ${cat.color}44`,display:"flex",alignItems:"center",gap:10 }}>
                  <span style={{ fontSize:22 }}>{cat.icon}</span>
                  <div><div style={{ fontSize:12,fontWeight:700,color:cat.color }}>{cat.label}</div><div style={{ fontSize:22,fontWeight:800,color:C.text }}>{complaints.filter(c=>c.category===cat.id).length}</div></div>
                </div>
              ))}
            </div>
            <div style={{ background:"#fff",borderRadius:14,padding:20,border:`1px solid ${C.border}` }}>
              <h3 style={{ margin:"0 0 14px",fontSize:15,color:C.text,fontWeight:700 }}>All Reported Locations — Heat Map</h3>
              <LiveTrackingMap complaints={complaints} selected={selected} onSelect={setSelected} title="All Reported Locations" height={360}/>
            </div>
          </div>
        )}

        {/* NOTIFICATIONS */}
        {view==="notifications"&&(
          <div>
            <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16 }}>
              <h2 style={{ margin:0,fontSize:18,color:C.text }}>Municipal Alerts & Notifications</h2>
              <button onClick={()=>setNotifications(ns=>ns.map(n=>({...n,read:true})))} style={{ fontSize:12,color:C.blue,background:"#EFF6FF",border:"1px solid #BFDBFE",padding:"6px 12px",borderRadius:8,cursor:"pointer" }}>
                Mark all read
              </button>
            </div>
            {notifications.map(n=>(
              <div key={n.id} onClick={()=>setNotifications(ns=>ns.map(x=>x.id===n.id?{...x,read:true}:x))}
                style={{ background:n.read?"#fff":"#EFF6FF",border:n.read?`1px solid ${C.border}`:`1.5px solid #BFDBFE`,borderRadius:12,padding:"14px 16px",marginBottom:10,cursor:"pointer" }}>
                <div style={{ display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:10 }}>
                  <div>
                    <div style={{ fontWeight:700,fontSize:14,color:C.text,marginBottom:4 }}>{n.subject}</div>
                    <div style={{ fontSize:13,color:C.textMuted,lineHeight:1.5 }}>{n.message}</div>
                    <div style={{ fontSize:11,color:"#94A3B8",marginTop:6 }}>{n.time}</div>
                  </div>
                  {!n.read&&<span style={{ width:10,height:10,background:C.blue,borderRadius:"50%",flexShrink:0,marginTop:4 }}/>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <style>{`@keyframes slideIn{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:translateX(0)}}*{box-sizing:border-box}`}</style>
    </div>
  );
}

/* ─── CITIZEN SUBMIT FORM ───────────────────────────────────────── */
function CitizenSubmitForm({ onSubmit, onClose, existingComplaints=[] }) {
  const [step,setStep]=useState(1);
  const [cat,setCat]=useState(null);
  const [desc,setDesc]=useState("");
  const [addr,setAddr]=useState("");
  const [photo,setPhoto]=useState(null);
  const [photoPreview,setPhotoPreview]=useState(null);
  const [coords,setCoords]=useState(null);
  const [geoLoading,setGeoLoading]=useState(false);
  const [geoError,setGeoError]=useState("");
  const [submitting,setSubmitting]=useState(false);
  const [done,setDone]=useState(false);
  const [readabilityErr,setReadabilityErr]=useState("");
  const [aiPreview,setAiPreview]=useState(null);
  const [duplicates,setDuplicates]=useState([]);
  const [showDuplicateWarning,setShowDuplicateWarning]=useState(false);
  const fileRef=useRef(null);
  const camRef=useRef(null);

  useEffect(()=>{
    setGeoLoading(true);
    navigator.geolocation?.getCurrentPosition(
      pos=>{
        setCoords({lat:pos.coords.latitude,lng:pos.coords.longitude,accuracy:Math.round(pos.coords.accuracy)});
        fetch(`https://nominatim.openstreetmap.org/reverse?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&format=json`)
          .then(r=>r.json()).then(d=>{if(d.display_name)setAddr(d.display_name.split(",").slice(0,4).join(",").trim());}).catch(()=>{});
        setGeoLoading(false);
      },
      ()=>{setGeoError("Location denied. Enter address manually.");setCoords({lat:-26.2041,lng:28.0473,accuracy:0});setGeoLoading(false);},
      {enableHighAccuracy:true,timeout:10000}
    );
  },[]);

  const go=async()=>{
    setSubmitting(true);
    try{await onSubmit({cat,desc,addr,coords,photo});setDone(true);}
    catch(e){alert("Failed: "+e.message);setSubmitting(false);}
  };

  if(done)return(
    <div style={{textAlign:"center",padding:"50px 20px"}}>
      <div style={{fontSize:60,marginBottom:16}}>✅</div>
      <h3 style={{color:"#065F46",margin:"0 0 8px"}}>Complaint Submitted!</h3>
      <p style={{color:C.textMuted,fontSize:14}}>AI is classifying your report…</p>
    </div>
  );

  return(
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:22}}>
        <h2 style={{margin:0,fontSize:18,color:C.text,fontWeight:700}}>New Complaint Report</h2>
        <button onClick={onClose} style={{background:"none",border:"none",fontSize:18,cursor:"pointer",color:C.textMuted}}>✕</button>
      </div>
      <div style={{display:"flex",gap:6,marginBottom:26}}>
        {["Category","Details","Photo & GPS","Review"].map((label,i)=>(
          <div key={label} style={{flex:1}}>
            <div style={{height:4,borderRadius:2,background:step>=i+1?C.blue:C.border,marginBottom:4}}/>
            <div style={{fontSize:9,color:step>=i+1?C.blue:C.textMuted,fontWeight:600,textAlign:"center"}}>{label}</div>
          </div>
        ))}
      </div>

      {step===1&&(
        <div>
          <p style={{fontSize:13,color:C.textMuted,marginBottom:14}}>What type of issue?</p>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            {CATEGORIES.map(c=>(
              <div key={c.id} onClick={()=>setCat(c.id)} style={{padding:"14px 12px",borderRadius:12,border:cat===c.id?`2px solid ${c.color}`:`1.5px solid ${C.border}`,cursor:"pointer",background:cat===c.id?c.bg:"#fff",display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:22}}>{c.icon}</span>
                <span style={{fontSize:13,fontWeight:600,color:cat===c.id?c.color:"#374151"}}>{c.label}</span>
              </div>
            ))}
          </div>
          <button disabled={!cat} onClick={()=>setStep(2)} style={{width:"100%",marginTop:18,padding:12,background:cat?`linear-gradient(135deg,${C.blue},${C.teal})`:C.border,color:cat?"#fff":"#9CA3AF",border:"none",borderRadius:10,fontSize:14,fontWeight:600,cursor:cat?"pointer":"not-allowed"}}>Continue →</button>
        </div>
      )}

      {step===2&&(
        <div>
          <label style={{fontSize:12,fontWeight:600,color:C.textMuted,display:"block",marginBottom:6,textTransform:"uppercase"}}>
            Description * <span style={{fontSize:10,fontWeight:400,color:C.textMuted,textTransform:"none"}}>(min 15 chars, plain language)</span>
          </label>
          <textarea value={desc}
            onChange={e=>{
              setDesc(e.target.value);
              setReadabilityErr("");
              setAiPreview(null);
              setDuplicates([]);
            }}
            placeholder="Describe the issue clearly e.g. 'There is a large burst water pipe on Main Street spraying water onto the road…'"
            rows={5}
            style={{width:"100%",borderRadius:10,border:`1.5px solid ${readabilityErr?"#F87171":desc.length>=15?"#10B981":C.border}`,padding:"10px 12px",fontSize:14,resize:"vertical",boxSizing:"border-box",fontFamily:"inherit",lineHeight:1.5}}/>

          {/* Character count + readability feedback */}
          <div style={{display:"flex",justifyContent:"space-between",marginTop:4,marginBottom:8}}>
            <div style={{fontSize:11,color:readabilityErr?"#EF4444":desc.length>=15?"#059669":C.textMuted}}>
              {readabilityErr
                ? `⚠️ ${readabilityErr}`
                : desc.length>=15
                  ? "✓ Description looks good"
                  : `${desc.length} / 15 characters minimum`
              }
            </div>
            <div style={{fontSize:11,color:C.textMuted}}>{desc.length} chars</div>
          </div>

          {/* AI live preview — shows once 20+ chars typed */}
          {desc.length>=20&&!readabilityErr&&(()=>{
            const ai = aiClassify(desc);
            const cat_ = CATEGORIES.find(k=>k.id===ai.category);
            return (
              <div style={{padding:"10px 14px",background:"#EFF6FF",borderRadius:10,border:"1px solid #BFDBFE",marginBottom:12,fontSize:12}}>
                <div style={{fontWeight:700,color:"#1E40AF",marginBottom:6}}>🤖 AI Preview (live)</div>
                <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
                  <span style={{background:cat_?.bg,color:cat_?.color,padding:"2px 10px",borderRadius:20,fontWeight:600}}>{cat_?.icon} {cat_?.label}</span>
                  <span style={{background:PRIORITIES[ai.priority]?.bg,color:PRIORITIES[ai.priority]?.color,padding:"2px 10px",borderRadius:20,fontWeight:600}}>{ai.priority} Priority</span>
                  <span style={{color:"#64748B"}}>{Math.round(ai.confidence*100)}% confidence</span>
                </div>
                {ai.reasons.length>0&&<div style={{marginTop:5,color:"#3B82F6",fontSize:11}}>📌 {ai.reasons.join(" · ")}</div>}
              </div>
            );
          })()}

          {/* Similar complaints warning */}
          {duplicates.length>0&&(
            <div style={{padding:"12px 14px",background:"#FFFBEB",borderRadius:10,border:"1px solid #FDE68A",marginBottom:12,fontSize:12}}>
              <div style={{fontWeight:700,color:"#92400E",marginBottom:6}}>⚠️ Similar complaint{duplicates.length>1?"s":""} already reported</div>
              {duplicates.map((d,i)=>(
                <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:i<duplicates.length-1?"1px solid #FDE68A":"none"}}>
                  <span style={{color:"#78350F",fontWeight:600}}>{d.id||d.ref_id}</span>
                  <span style={{color:"#92400E"}}>{d.status}</span>
                  <span style={{color:"#D97706"}}>{Math.round(d.similarity*100)}% similar</span>
                </div>
              ))}
              <div style={{marginTop:8,color:"#92400E",fontSize:11}}>
                These complaints may already cover your issue. You can still submit if your case is different.
              </div>
            </div>
          )}

          <label style={{fontSize:12,fontWeight:600,color:C.textMuted,display:"block",margin:"4px 0 6px",textTransform:"uppercase"}}>Street Address *</label>
          <div style={{position:"relative"}}>
            <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",fontSize:16}}>📍</span>
            <input value={addr} onChange={e=>setAddr(e.target.value)} placeholder="Street address or landmark" style={{width:"100%",padding:"11px 12px 11px 38px",borderRadius:10,border:`1.5px solid ${C.border}`,fontSize:14,boxSizing:"border-box",fontFamily:"inherit"}}/>
          </div>

          {/* Readability tips */}
          <div style={{marginTop:12,padding:"9px 13px",background:C.slateLight,borderRadius:9,fontSize:11,color:C.textMuted,lineHeight:1.6}}>
            <strong style={{color:C.text}}>💡 Tips for a good description:</strong><br/>
            Mention the <em>location</em>, <em>what is wrong</em>, <em>how long it has been happening</em>, and <em>how serious it is</em>.<br/>
            <span style={{color:"#059669"}}>✓ Good:</span> "Large pothole on Mandela Drive near Pick n Pay, causing tyre damage, appeared 2 weeks ago"<br/>
            <span style={{color:"#EF4444"}}>✗ Avoid:</span> "fix it", "broken", random characters or keyboard mashing
          </div>

          <div style={{display:"flex",gap:10,marginTop:14}}>
            <button onClick={()=>setStep(1)} style={{flex:1,padding:11,background:C.slateLight,border:`1.5px solid ${C.border}`,borderRadius:10,fontSize:14,cursor:"pointer"}}>← Back</button>
            <button disabled={!desc||!addr} onClick={()=>{
              // Run readability check before advancing
              const check = validateReadability(desc);
              if (!check.readable) { setReadabilityErr(check.reason); return; }
              setReadabilityErr("");
              // Run duplicate check
              const dups = findSimilarComplaints(desc, existingComplaints);
              setDuplicates(dups);
              // Run AI classify and cache it
              setAiPreview(aiClassify(desc));
              setStep(3);
            }} style={{flex:2,padding:11,background:(!desc||!addr)?C.border:`linear-gradient(135deg,${C.blue},${C.teal})`,color:(!desc||!addr)?"#9CA3AF":"#fff",border:"none",borderRadius:10,fontSize:14,fontWeight:600,cursor:(!desc||!addr)?"not-allowed":"pointer"}}>
              Continue →
            </button>
          </div>
        </div>
      )}

      {step===3&&(
        <div>
          <label style={{fontSize:12,fontWeight:600,color:C.textMuted,display:"block",marginBottom:8,textTransform:"uppercase"}}>GPS Location</label>
          {geoLoading?<div style={{padding:"12px 16px",background:"#EFF6FF",borderRadius:10,border:"1px solid #BFDBFE",fontSize:13,color:"#1E40AF"}}>🔄 Detecting location…</div>
            :coords?<div style={{padding:"12px 16px",background:"#F0FDF4",borderRadius:10,border:"1px solid #BBF7D0",fontSize:13,color:"#166534"}}>
              ✅ GPS Captured: <strong>{coords.lat.toFixed(6)}, {coords.lng.toFixed(6)}</strong> {coords.accuracy>0&&`(±${coords.accuracy}m)`}
              {geoError&&<div style={{marginTop:4,color:"#92400E",fontSize:12}}>⚠️ {geoError}</div>}
            </div>
            :<div style={{padding:"12px 16px",background:"#FEF2F2",borderRadius:10,border:"1px solid #FECACA",fontSize:13,color:"#DC2626"}}>⚠️ {geoError}</div>
          }

          {coords&&(
            <div style={{marginTop:12,marginBottom:16,borderRadius:12,overflow:"hidden",border:`1px solid ${C.border}`}}>
              <iframe title="map" width="100%" height="160" frameBorder="0" style={{display:"block"}}
                src={`https://www.openstreetmap.org/export/embed.html?bbox=${coords.lng-.005},${coords.lat-.005},${coords.lng+.005},${coords.lat+.005}&layer=mapnik&marker=${coords.lat},${coords.lng}`}/>
              <div style={{padding:"6px 10px",background:"#F8FAFC",fontSize:11,color:C.textMuted,textAlign:"center"}}>📍 Complaint will be pinned at this location</div>
            </div>
          )}

          <label style={{fontSize:12,fontWeight:600,color:C.textMuted,display:"block",marginBottom:8,textTransform:"uppercase"}}>Photo Evidence (Optional)</label>
          {photoPreview?(
            <div style={{position:"relative",marginBottom:14}}>
              <img src={photoPreview} alt="preview" style={{width:"100%",maxHeight:200,objectFit:"cover",borderRadius:12,border:`1.5px solid ${C.border}`}}/>
              <button onClick={()=>{setPhoto(null);setPhotoPreview(null);}} style={{position:"absolute",top:8,right:8,background:"rgba(0,0,0,.6)",color:"#fff",border:"none",borderRadius:"50%",width:28,height:28,cursor:"pointer",fontSize:14}}>✕</button>
            </div>
          ):(
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
              <div onClick={()=>camRef.current?.click()} style={{padding:"18px 12px",borderRadius:12,border:"2px dashed #BFDBFE",cursor:"pointer",background:"#EFF6FF",textAlign:"center"}}>
                <div style={{fontSize:28,marginBottom:6}}>📷</div>
                <div style={{fontSize:13,fontWeight:600,color:"#1E40AF"}}>Take Photo</div>
              </div>
              <div onClick={()=>fileRef.current?.click()} style={{padding:"18px 12px",borderRadius:12,border:`2px dashed ${C.border}`,cursor:"pointer",background:"#F8FAFC",textAlign:"center"}}>
                <div style={{fontSize:28,marginBottom:6}}>🖼️</div>
                <div style={{fontSize:13,fontWeight:600,color:"#374151"}}>Upload Photo</div>
              </div>
            </div>
          )}
          <input ref={camRef} type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={e=>{const f=e.target.files[0];if(f){setPhoto(f);const r=new FileReader();r.onload=ev=>setPhotoPreview(ev.target.result);r.readAsDataURL(f);}}}/>
          <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>{const f=e.target.files[0];if(f){setPhoto(f);const r=new FileReader();r.onload=ev=>setPhotoPreview(ev.target.result);r.readAsDataURL(f);}}}/>

          <div style={{display:"flex",gap:10,marginTop:8}}>
            <button onClick={()=>setStep(2)} style={{flex:1,padding:11,background:C.slateLight,border:`1.5px solid ${C.border}`,borderRadius:10,fontSize:14,cursor:"pointer"}}>← Back</button>
            <button onClick={()=>setStep(4)} style={{flex:2,padding:11,background:`linear-gradient(135deg,${C.blue},${C.teal})`,color:"#fff",border:"none",borderRadius:10,fontSize:14,fontWeight:600,cursor:"pointer"}}>Continue →</button>
          </div>
        </div>
      )}

      {step===4&&(
        <div>
          <div style={{padding:16,background:C.slateLight,borderRadius:12,border:`1px solid ${C.border}`,marginBottom:16}}>
            <div style={{fontSize:11,color:"#94A3B8",fontWeight:700,marginBottom:12,letterSpacing:".5px"}}>REVIEW YOUR REPORT</div>
            {[
              ["Category",CATEGORIES.find(c=>c.id===cat)?.label],
              ["Location",addr],
              ["Description",desc.slice(0,80)+(desc.length>80?"…":"")],
              ["GPS",coords?`${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`:"Not captured"],
              ["Photo",photo?`📷 ${photo.name}`:"No photo"],
            ].map(([k,v])=>(
              <div key={k} style={{display:"flex",gap:12,marginBottom:8,fontSize:13}}>
                <span style={{color:"#94A3B8",minWidth:84,fontWeight:600}}>{k}</span>
                <span style={{color:C.text,fontWeight:500}}>{v}</span>
              </div>
            ))}
          </div>
          {photoPreview&&<img src={photoPreview} alt="preview" style={{width:"100%",maxHeight:140,objectFit:"cover",borderRadius:10,marginBottom:16,border:`1px solid ${C.border}`}}/>}
          <div style={{padding:"10px 14px",background:"#FFF7ED",border:"1px solid #FED7AA",borderRadius:10,fontSize:12,color:"#92400E",marginBottom:18}}>
            🤖 AI will classify this complaint and assign a priority level automatically.
          </div>
          <div style={{display:"flex",gap:10}}>
            <button onClick={()=>setStep(3)} style={{flex:1,padding:11,background:C.slateLight,border:`1.5px solid ${C.border}`,borderRadius:10,fontSize:14,cursor:"pointer"}}>← Back</button>
            <button onClick={go} disabled={submitting} style={{flex:2,padding:11,background:submitting?"#93C5FD":`linear-gradient(135deg,${C.blue},${C.teal})`,color:"#fff",border:"none",borderRadius:10,fontSize:14,fontWeight:700,cursor:submitting?"not-allowed":"pointer"}}>
              {submitting?"Submitting…":"Submit Complaint ✓"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   ADMINISTRATOR DASHBOARD
═══════════════════════════════════════════════════════════════════ */
function AdminDashboard({ user, onLogout }) {
  const [view,setView]=useState("overview");
  const [complaints,setComplaints]=useState([]);
  const [users,setUsers]=useState([]);
  const [notif,setNotif]=useState(null);
  const [selected,setSelected]=useState(null);
  const [assignModal,setAssignModal]=useState(null);
  const [reclassModal,setReclassModal]=useState(null);
  const [notifModal,setNotifModal]=useState(false);
  const [broadcastMsg,setBroadcastMsg]=useState({type:"electricity",title:"",message:""});
  const [loading,setLoading]=useState(true);
  const token=localStorage.getItem("token");

  const load=useCallback(async()=>{
    setLoading(true);
    try{
      const [cr,ur]=await Promise.all([
        fetch(`${API}/api/complaints`,{headers:{Authorization:`Bearer ${token}`}}).then(r=>r.json()),
        fetch(`${API}/api/users`,{headers:{Authorization:`Bearer ${token}`}}).then(r=>r.json()),
      ]);
      if(cr.success){
        const list=cr.complaints||cr.data||[];
        setComplaints(list.map(c=>({
          ...c,
          ref_id:c.ref_id||c.id,
          dbId:c.id,
          category:c.category||"facility",
          status:c.status||"Submitted",
          priority:c.priority||"Medium",
          address:c.address||"",
          latitude:c.latitude,
          longitude:c.longitude,
          description:c.description||"",
        })));
      }
      if(ur.success)setUsers(ur.users||ur.data||[]);
    }catch(e){console.error(e);}finally{setLoading(false);}
  },[token]);

  useEffect(()=>{load();},[load]);

  const notify=(msg,type="success")=>setNotif({msg,type});

  const classifyComplaint=async(comp)=>{
    const ai=aiClassify(comp.description||"");
    await fetch(`${API}/api/complaints/${comp.dbId||comp.id}/classify`,{
      method:"PATCH",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},
      body:JSON.stringify({category:ai.category,priority:ai.priority,ai_category:ai.category,ai_priority:ai.priority,confidence:ai.confidence}),
    });
    notify(`AI classified ${comp.ref_id}: ${ai.category} / ${ai.priority} (${(ai.confidence*100).toFixed(0)}% confidence)`);
    load();
  };

  const assignTech=async(complaint,techId)=>{
    const res=await fetch(`${API}/api/assignments`,{
      method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},
      body:JSON.stringify({complaint_id:complaint.dbId||complaint.id,technician_id:techId}),
    });
    const data=await res.json();
    if(data.success){notify("Technician assigned successfully!");setAssignModal(null);load();}
    else notify(data.message||"Failed","error");
  };

  const escalateCouncillor=async(complaint)=>{
    const councillors=users.filter(u=>u.role==="Councillor");
    if(!councillors.length){notify("No councillor found","error");return;}
    const res=await fetch(`${API}/api/escalations`,{
      method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},
      body:JSON.stringify({complaint_id:complaint.dbId||complaint.id,councillor_id:councillors[0].id}),
    });
    const data=await res.json();
    if(data.success){notify("Escalated to Councillor!","info");load();}
    else notify(data.message||"Failed","error");
  };

  const technicians=users.filter(u=>u.role==="Technician");
  const cats=CATEGORIES.map(cat=>({...cat,count:complaints.filter(c=>c.category===cat.id).length}));
  const statuses=STATUS_STEPS.map(s=>({s,count:complaints.filter(c=>c.status===s).length}));
  const unresolved=complaints.filter(c=>c.status!=="Resolved");
  const critical=complaints.filter(c=>c.priority==="Critical"||c.priority==="High");

  return (
    <div style={{fontFamily:"'Segoe UI',system-ui,sans-serif",minHeight:"100vh",background:C.slateLight}}>
      {notif&&<Notif {...notif} onDone={()=>setNotif(null)}/>}

      {/* ASSIGN MODAL */}
      {assignModal&&(
        <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.65)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:"#fff",borderRadius:18,padding:28,maxWidth:440,width:"90%"}}>
            <h3 style={{margin:"0 0 16px",color:C.text}}>👷 Assign Technician</h3>
            <p style={{color:C.textMuted,fontSize:14,marginBottom:16}}>Assigning to: <strong>{assignModal.ref_id}</strong> — {assignModal.category} complaint</p>
            {technicians.length===0?<p style={{color:"#EF4444"}}>No technicians available.</p>:technicians.map(t=>(
              <div key={t.id} onClick={()=>assignTech(assignModal,t.id)} style={{padding:"12px 14px",borderRadius:10,border:`1px solid ${C.border}`,marginBottom:8,cursor:"pointer",background:"#F8FAFC",display:"flex",alignItems:"center",gap:12}}>
                <div style={{width:36,height:36,borderRadius:"50%",background:"#0EA5E920",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>👷</div>
                <div><div style={{fontWeight:600,fontSize:14,color:C.text}}>{t.full_name}</div><div style={{fontSize:12,color:C.textMuted}}>{t.email}</div></div>
              </div>
            ))}
            <button onClick={()=>setAssignModal(null)} style={{width:"100%",marginTop:12,padding:11,background:C.slateLight,border:`1.5px solid ${C.border}`,borderRadius:10,cursor:"pointer"}}>Cancel</button>
          </div>
        </div>
      )}

      {/* RECLASSIFY MODAL */}
      {reclassModal&&(
        <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.65)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:"#fff",borderRadius:18,padding:28,maxWidth:400,width:"90%"}}>
            <h3 style={{margin:"0 0 16px",color:C.text}}>🤖 Reclassify Complaint</h3>
            <p style={{color:C.textMuted,fontSize:14,marginBottom:14}}><strong>{reclassModal.ref_id}</strong></p>
            <div style={{padding:"12px 14px",background:"#EFF6FF",borderRadius:10,marginBottom:16,fontSize:13,color:"#1E40AF"}}>
              AI Suggestion: <strong>{(() => { const a=aiClassify(reclassModal.description||""); return `${a.category} / ${a.priority} (${(a.confidence*100).toFixed(0)}%)`; })()}</strong>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              {CATEGORIES.map(cat=>(
                <div key={cat.id} onClick={async()=>{
                  const ai=aiClassify(reclassModal.description||"");
                  await fetch(`${API}/api/complaints/${reclassModal.id}/classify`,{method:"PATCH",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({category:cat.id,priority:ai.priority,ai_category:cat.id,ai_priority:ai.priority,admin_override:true})});
                  notify(`Reclassified to ${cat.label}`);setReclassModal(null);load();
                }} style={{padding:"10px 12px",borderRadius:10,border:`1.5px solid ${cat.color}44`,cursor:"pointer",background:cat.bg,display:"flex",alignItems:"center",gap:8}}>
                  <span>{cat.icon}</span><span style={{fontSize:12,fontWeight:600,color:cat.color}}>{cat.label}</span>
                </div>
              ))}
            </div>
            <button onClick={()=>setReclassModal(null)} style={{width:"100%",marginTop:12,padding:11,background:C.slateLight,border:`1.5px solid ${C.border}`,borderRadius:10,cursor:"pointer"}}>Cancel</button>
          </div>
        </div>
      )}

      {/* BROADCAST NOTIFICATION MODAL */}
      {notifModal&&(
        <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.65)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:"#fff",borderRadius:18,padding:28,maxWidth:480,width:"90%"}}>
            <h3 style={{margin:"0 0 16px",color:C.text}}>📢 Send Municipal Notification</h3>
            <label style={{fontSize:12,fontWeight:600,color:C.textMuted,display:"block",marginBottom:6,textTransform:"uppercase"}}>Type</label>
            <select value={broadcastMsg.type} onChange={e=>setBroadcastMsg(m=>({...m,type:e.target.value}))} style={{width:"100%",padding:"10px 12px",borderRadius:10,border:`1.5px solid ${C.border}`,fontSize:14,marginBottom:14,boxSizing:"border-box"}}>
              <option value="electricity">⚡ Electricity Outage</option>
              <option value="water">💧 Water Disruption</option>
              <option value="road">🛣️ Road Closure</option>
              <option value="general">📋 General Notice</option>
            </select>
            <label style={{fontSize:12,fontWeight:600,color:C.textMuted,display:"block",marginBottom:6,textTransform:"uppercase"}}>Title</label>
            <input value={broadcastMsg.title} onChange={e=>setBroadcastMsg(m=>({...m,title:e.target.value}))} placeholder="e.g. Planned Power Outage — Zone 4" style={{width:"100%",padding:"10px 12px",borderRadius:10,border:`1.5px solid ${C.border}`,fontSize:14,marginBottom:14,boxSizing:"border-box",fontFamily:"inherit"}}/>
            <label style={{fontSize:12,fontWeight:600,color:C.textMuted,display:"block",marginBottom:6,textTransform:"uppercase"}}>Message</label>
            <textarea value={broadcastMsg.message} onChange={e=>setBroadcastMsg(m=>({...m,message:e.target.value}))} rows={3} placeholder="Describe the issue, affected areas, and expected resolution…" style={{width:"100%",padding:"10px 12px",borderRadius:10,border:`1.5px solid ${C.border}`,fontSize:14,resize:"vertical",boxSizing:"border-box",fontFamily:"inherit",marginBottom:14}}/>
            <div style={{display:"flex",gap:10}}>
              <button onClick={()=>setNotifModal(false)} style={{flex:1,padding:11,background:C.slateLight,border:`1.5px solid ${C.border}`,borderRadius:10,fontSize:14,cursor:"pointer"}}>Cancel</button>
              <button onClick={()=>{notify(`📢 Notification sent: "${broadcastMsg.title}"`,"info");setNotifModal(false);setBroadcastMsg({type:"electricity",title:"",message:""}); }} style={{flex:2,padding:11,background:`linear-gradient(135deg,${C.blue},${C.teal})`,color:"#fff",border:"none",borderRadius:10,fontSize:14,fontWeight:700,cursor:"pointer"}}>
                Send to All Citizens 📢
              </button>
            </div>
          </div>
        </div>
      )}

      <Header user={user} onLogout={onLogout} accentColor="#7C3AED" roleIcon="⚙️"
        tabs={[["overview","📊 Overview"],["complaints","📋 All Complaints"],["map","🗺️ Heat Map"],["assign","👷 Assign Work"],["reports","📈 Reports & Trends"],["notifications","📢 Send Notifications"]]}
        activeTab={view} setActiveTab={setView}/>

      <div style={{maxWidth:1100,margin:"0 auto",padding:"24px 20px"}}>

        {/* OVERVIEW */}
        {view==="overview"&&(
          <div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:14,marginBottom:22}}>
              <StatCard icon="📋" label="Total Complaints" value={loading?"…":complaints.length} color={C.blue}/>
              <StatCard icon="⏳" label="Unresolved" value={loading?"…":unresolved.length} color="#F59E0B"/>
              <StatCard icon="🚨" label="High/Critical" value={loading?"…":critical.length} color="#EF4444"/>
              <StatCard icon="✅" label="Resolved" value={loading?"…":complaints.filter(c=>c.status==="Resolved").length} color="#10B981"/>
              <StatCard icon="👥" label="Total Users" value={loading?"…":users.length} color="#8B5CF6"/>
            </div>

            {/* Category breakdown */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:20}}>
              <div style={{background:"#fff",borderRadius:14,padding:20,border:`1px solid ${C.border}`}}>
                <h3 style={{margin:"0 0 16px",fontSize:13,color:C.textMuted,fontWeight:700,letterSpacing:".5px"}}>COMPLAINTS BY CATEGORY</h3>
                {cats.map(cat=>(
                  <div key={cat.id} style={{marginBottom:12}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                      <span style={{fontSize:13,color:C.text}}>{cat.icon} {cat.label}</span>
                      <span style={{fontSize:13,fontWeight:700,color:cat.color}}>{cat.count}</span>
                    </div>
                    <div style={{height:8,background:"#F1F5F9",borderRadius:4,overflow:"hidden"}}>
                      <div style={{height:"100%",background:cat.color,borderRadius:4,width:`${complaints.length?Math.round(cat.count/complaints.length*100):0}%`,transition:"width .5s"}}/>
                    </div>
                  </div>
                ))}
              </div>

              <div style={{background:"#fff",borderRadius:14,padding:20,border:`1px solid ${C.border}`}}>
                <h3 style={{margin:"0 0 16px",fontSize:13,color:C.textMuted,fontWeight:700,letterSpacing:".5px"}}>STATUS PIPELINE</h3>
                {statuses.map(({s,count})=>(
                  <div key={s} style={{display:"flex",alignItems:"center",gap:12,marginBottom:10,padding:"8px 12px",borderRadius:8,background:C.slateLight}}>
                    <div style={{width:10,height:10,borderRadius:"50%",background:s==="Resolved"?"#10B981":s==="In Progress"?C.blue:"#F59E0B"}}/>
                    <span style={{flex:1,fontSize:13,color:C.text}}>{s}</span>
                    <span style={{fontSize:14,fontWeight:700,color:C.text}}>{count}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Recent high priority */}
            <div style={{background:"#fff",borderRadius:14,padding:20,border:`1px solid ${C.border}`}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
                <h3 style={{margin:0,fontSize:13,color:C.textMuted,fontWeight:700,letterSpacing:".5px"}}>HIGH / CRITICAL — NEEDS ATTENTION</h3>
                <button onClick={()=>setNotifModal(true)} style={{fontSize:12,color:"#fff",background:`linear-gradient(135deg,${C.blue},${C.teal})`,border:"none",padding:"7px 14px",borderRadius:8,cursor:"pointer",fontWeight:600}}>
                  📢 Send Notice
                </button>
              </div>
              {critical.slice(0,5).map(c=>{
                const cat=CATEGORIES.find(k=>k.id===c.category);
                return(
                  <div key={c.id||c.ref_id} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 12px",borderRadius:10,border:`1px solid ${C.border}`,marginBottom:8,background:"#FEF2F2"}}>
                    <span style={{fontSize:20}}>{cat?.icon}</span>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontWeight:700,fontSize:13,color:C.text}}>{c.ref_id} — {cat?.label}</div>
                      <div style={{fontSize:12,color:C.textMuted,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.description}</div>
                    </div>
                    <Badge priority={c.priority}/>
                    <button onClick={()=>escalateCouncillor(c)} style={{fontSize:11,color:"#7C3AED",background:"#EDE9FE",border:"none",padding:"5px 10px",borderRadius:7,cursor:"pointer",fontWeight:600,whiteSpace:"nowrap"}}>Escalate ⬆</button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ALL COMPLAINTS */}
        {view==="complaints"&&(
          <div>
            <div style={{display:"flex",gap:10,marginBottom:18,flexWrap:"wrap",alignItems:"center"}}>
              <h2 style={{margin:0,fontSize:18,color:C.text,flex:1}}>All Complaints</h2>
              <button onClick={load} style={{padding:"9px 14px",background:C.blue,color:"#fff",border:"none",borderRadius:10,fontSize:13,cursor:"pointer",fontWeight:600}}>🔄 Refresh</button>
            </div>
            <div style={{background:"#fff",borderRadius:14,border:`1px solid ${C.border}`,overflow:"hidden"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                <thead>
                  <tr style={{background:C.slateLight}}>
                    {["Ref ID","Category","Description","Address","Status","Priority","AI","Actions"].map(h=>(
                      <th key={h} style={{padding:"12px 14px",textAlign:"left",fontWeight:700,color:C.textMuted,fontSize:12,textTransform:"uppercase",letterSpacing:".5px",borderBottom:`1px solid ${C.border}`}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {complaints.map((c,i)=>{
                    const cat=CATEGORIES.find(k=>k.id===c.category);
                    return(
                      <tr key={c.id||c.ref_id} style={{background:i%2===0?"#fff":C.slateLight,borderBottom:`1px solid ${C.border}`}}>
                        <td style={{padding:"10px 14px",fontWeight:700,color:C.blue}}>{c.ref_id}</td>
                        <td style={{padding:"10px 14px"}}><span style={{display:"flex",alignItems:"center",gap:6}}>{cat?.icon} {cat?.label}</span></td>
                        <td style={{padding:"10px 14px",maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:C.textMuted}}>{c.description}</td>
                        <td style={{padding:"10px 14px",fontSize:12,color:C.textMuted}}>{c.address||"—"}</td>
                        <td style={{padding:"10px 14px"}}><span style={{fontSize:11,padding:"3px 9px",borderRadius:20,background:c.status==="Resolved"?"#D1FAE5":"#DBEAFE",color:c.status==="Resolved"?"#065F46":"#1E40AF",fontWeight:600}}>{c.status}</span></td>
                        <td style={{padding:"10px 14px"}}><Badge priority={c.priority}/></td>
                        <td style={{padding:"10px 14px"}}>
                          <button onClick={()=>classifyComplaint(c)} style={{fontSize:11,color:"#1E40AF",background:"#EFF6FF",border:"1px solid #BFDBFE",padding:"4px 8px",borderRadius:6,cursor:"pointer"}}>🤖 AI</button>
                        </td>
                        <td style={{padding:"10px 14px"}}>
                          <div style={{display:"flex",gap:6}}>
                            <button onClick={()=>setAssignModal(c)} style={{fontSize:11,color:"#065F46",background:"#D1FAE5",border:"none",padding:"4px 8px",borderRadius:6,cursor:"pointer",fontWeight:600}}>👷 Assign</button>
                            <button onClick={()=>setReclassModal(c)} style={{fontSize:11,color:"#7C3AED",background:"#EDE9FE",border:"none",padding:"4px 8px",borderRadius:6,cursor:"pointer",fontWeight:600}}>✏️ Fix</button>
                            {(c.priority==="High"||c.priority==="Critical")&&<button onClick={()=>escalateCouncillor(c)} style={{fontSize:11,color:"#DC2626",background:"#FEE2E2",border:"none",padding:"4px 8px",borderRadius:6,cursor:"pointer",fontWeight:600}}>⬆ Esc</button>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {complaints.length===0&&<div style={{textAlign:"center",padding:40,color:C.textMuted}}>No complaints found</div>}
            </div>
          </div>
        )}

        {/* HEAT MAP */}
        {view==="map"&&(
          <div>
            <h2 style={{margin:"0 0 16px",fontSize:18,color:C.text}}>Complaint Heat Map — All Areas</h2>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:12,marginBottom:16}}>
              {cats.map(cat=>(
                <div key={cat.id} style={{background:"#fff",borderRadius:12,padding:"12px 14px",border:`1.5px solid ${cat.color}44`,display:"flex",alignItems:"center",gap:10}}>
                  <span style={{fontSize:22}}>{cat.icon}</span>
                  <div><div style={{fontSize:12,fontWeight:700,color:cat.color}}>{cat.label}</div><div style={{fontSize:22,fontWeight:800,color:C.text}}>{cat.count}</div></div>
                </div>
              ))}
            </div>
            <div style={{background:"#fff",borderRadius:14,padding:20,border:`1px solid ${C.border}`}}>
              <LiveTrackingMap complaints={complaints.map(c=>({...c,id:c.ref_id,lat:parseFloat(c.latitude)||null,lng:parseFloat(c.longitude)||null}))} technicians={users.filter(u=>u.role==="Technician").map((t,i)=>({...t,name:t.full_name,lat:null,lng:null,color:"#378ADD",status_label:"Available"}))} selected={selected} onSelect={setSelected} title="Complaint Heat Map — All Areas" height={420}/>
            </div>
            {selected&&(()=>{
              const c=complaints.find(x=>x.ref_id===selected);
              if(!c)return null;
              const cat=CATEGORIES.find(k=>k.id===c.category);
              return(
                <div style={{marginTop:14,padding:16,background:"#fff",borderRadius:12,border:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:14}}>
                  <span style={{fontSize:28}}>{cat?.icon}</span>
                  <div style={{flex:1}}><div style={{fontWeight:700,color:C.text}}>{c.ref_id} — {cat?.label}</div><div style={{fontSize:13,color:C.textMuted}}>📍 {c.address} · {c.status}</div></div>
                  <Badge priority={c.priority}/>
                  <button onClick={()=>setAssignModal(c)} style={{fontSize:12,color:"#065F46",background:"#D1FAE5",border:"none",padding:"7px 12px",borderRadius:8,cursor:"pointer",fontWeight:600}}>👷 Assign</button>
                </div>
              );
            })()}
          </div>
        )}

        {view==="assign"&&(
          <div>
            <h2 style={{margin:"0 0 20px",fontSize:18,color:C.text}}>Assign Work to Municipal Workers</h2>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20}}>
              <div>
                <h3 style={{margin:"0 0 14px",fontSize:14,color:C.textMuted,fontWeight:700}}>UNASSIGNED COMPLAINTS</h3>
                {complaints.filter(c=>c.status==="Submitted"||c.status==="Classified"||c.status==="Pending"||!c.status).map(c=>{
                  const cat=CATEGORIES.find(k=>k.id===c.category);
                  return(
                    <div key={c.dbId||c.ref_id} style={{background:"#fff",borderRadius:12,padding:"14px 16px",border:`1px solid ${C.border}`,marginBottom:10}}>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:8}}>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <span style={{fontSize:18}}>{cat?.icon||"📋"}</span>
                          <div>
                            <div style={{fontWeight:700,fontSize:13,color:C.text}}>{c.ref_id}</div>
                            <div style={{fontSize:11,color:C.textMuted}}>{cat?.label||c.category}</div>
                          </div>
                        </div>
                        <Badge priority={c.priority}/>
                      </div>
                      <div style={{fontSize:12,color:C.textMuted,marginBottom:10,lineHeight:1.4}}>{c.description?.slice(0,80)}{c.description?.length>80?"…":""}</div>
                      <button onClick={()=>setAssignModal(c)} style={{width:"100%",padding:"8px",background:`linear-gradient(135deg,${C.blue},${C.teal})`,color:"#fff",border:"none",borderRadius:8,fontSize:13,fontWeight:600,cursor:"pointer"}}>
                        👷 Assign to Technician
                      </button>
                    </div>
                  );
                })}
                {complaints.filter(c=>c.status==="Submitted"||c.status==="Classified"||c.status==="Pending"||!c.status).length===0&&complaints.length>0&&(
                  <div style={{textAlign:"center",padding:40,color:C.textMuted,background:"#fff",borderRadius:14,border:`1px solid ${C.border}`}}>✅ All complaints assigned</div>
                )}
                {complaints.length===0&&(
                  <div style={{textAlign:"center",padding:40,color:C.textMuted,background:"#fff",borderRadius:14,border:`1px solid ${C.border}`}}>
                    <div style={{fontSize:36,marginBottom:8}}>📭</div>
                    <div>No complaints yet</div>
                  </div>
                )}
              </div>

              <div>
                <h3 style={{margin:"0 0 14px",fontSize:14,color:C.textMuted,fontWeight:700}}>TECHNICIAN WORKLOAD</h3>
                {technicians.map(t=>{
                  const techActive=complaints.filter(c=>(c.status==="In Progress"||c.status==="Assigned")&&c.assigned_to===t.id).length;
                  return(
                    <div key={t.id} style={{background:"#fff",borderRadius:12,padding:"14px 16px",border:`1px solid ${C.border}`,marginBottom:10,display:"flex",alignItems:"center",gap:12}}>
                      <div style={{width:42,height:42,borderRadius:"50%",background:"#D1FAE5",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>👷</div>
                      <div style={{flex:1}}>
                        <div style={{fontWeight:700,fontSize:14,color:C.text}}>{t.full_name}</div>
                        <div style={{fontSize:12,color:C.textMuted}}>{t.email}</div>
                      </div>
                      <div style={{textAlign:"right"}}>
                        <div style={{fontSize:18,fontWeight:800,color:techActive>3?"#EF4444":"#10B981"}}>{techActive}</div>
                        <div style={{fontSize:11,color:C.textMuted}}>active jobs</div>
                      </div>
                    </div>
                  );
                })}
                {technicians.length===0&&<div style={{textAlign:"center",padding:40,color:C.textMuted,background:"#fff",borderRadius:14,border:`1px solid ${C.border}`}}>No technicians registered</div>}
              </div>
            </div>
          </div>
        )}

        {/* REPORTS */}
        {view==="reports"&&(
          <div>
            <h2 style={{margin:"0 0 20px",fontSize:18,color:C.text}}>Reports & Trend Analysis</h2>

            {loading&&<div style={{textAlign:"center",padding:40,color:C.textMuted}}>Loading data…</div>}

            {/* Bar chart — complaints by category */}
            <div style={{background:"#fff",borderRadius:14,padding:20,border:`1px solid ${C.border}`,marginBottom:20}}>
              <h3 style={{margin:"0 0 20px",fontSize:14,color:C.textMuted,fontWeight:700}}>COMPLAINTS BY CATEGORY</h3>
              {complaints.length===0?(
                <div style={{textAlign:"center",padding:40,color:C.textMuted}}>No complaint data yet</div>
              ):(
                <div style={{display:"flex",alignItems:"flex-end",gap:16,height:180,paddingBottom:4}}>
                  {cats.map(cat=>{
                    const maxCount=Math.max(...cats.map(c=>c.count),1);
                    const barH=Math.max(8,Math.round((cat.count/maxCount)*140));
                    return(
                      <div key={cat.id} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:6}}>
                        <div style={{fontSize:13,fontWeight:700,color:cat.color}}>{cat.count}</div>
                        <div style={{width:"100%",height:barH,background:cat.color,borderRadius:"6px 6px 0 0",transition:"height .5s"}}/>
                        <div style={{fontSize:14,textAlign:"center"}}>{cat.icon}</div>
                        <div style={{fontSize:10,color:C.textMuted,textAlign:"center",lineHeight:1.2}}>{cat.label.split(" ")[0]}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Status & Priority */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20,marginBottom:20}}>
              <div style={{background:"#fff",borderRadius:14,padding:20,border:`1px solid ${C.border}`}}>
                <h3 style={{margin:"0 0 16px",fontSize:14,color:C.textMuted,fontWeight:700}}>STATUS BREAKDOWN</h3>
                {statuses.map(({s,count})=>(
                  <div key={s} style={{marginBottom:10}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                      <span style={{fontSize:13,color:C.text}}>{s}</span>
                      <span style={{fontSize:13,fontWeight:700,color:C.text}}>{count} ({complaints.length?Math.round(count/complaints.length*100):0}%)</span>
                    </div>
                    <div style={{height:10,background:"#F1F5F9",borderRadius:5,overflow:"hidden"}}>
                      <div style={{height:"100%",background:s==="Resolved"?"#10B981":s==="In Progress"?C.blue:"#F59E0B",borderRadius:5,width:`${complaints.length?Math.round(count/complaints.length*100):0}%`,transition:"width .5s"}}/>
                    </div>
                  </div>
                ))}
              </div>

              <div style={{background:"#fff",borderRadius:14,padding:20,border:`1px solid ${C.border}`}}>
                <h3 style={{margin:"0 0 16px",fontSize:14,color:C.textMuted,fontWeight:700}}>PRIORITY DISTRIBUTION</h3>
                {Object.entries(PRIORITIES).map(([p,pStyle])=>{
                  const count=complaints.filter(c=>c.priority===p).length;
                  return(
                    <div key={p} style={{marginBottom:10}}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                        <span style={{fontSize:13,color:C.text}}>{p}</span>
                        <span style={{fontSize:13,fontWeight:700,color:pStyle.color}}>{count}</span>
                      </div>
                      <div style={{height:10,background:"#F1F5F9",borderRadius:5,overflow:"hidden"}}>
                        <div style={{height:"100%",background:pStyle.color,borderRadius:5,width:`${complaints.length?Math.round(count/complaints.length*100):0}%`,transition:"width .5s"}}/>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* AI Performance */}
            <div style={{background:"#fff",borderRadius:14,padding:20,border:`1px solid ${C.border}`}}>
              <h3 style={{margin:"0 0 16px",fontSize:14,color:C.textMuted,fontWeight:700}}>AI CLASSIFIER PERFORMANCE</h3>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:14}}>
                {[
                  {label:"Complaints Classified",value:complaints.filter(c=>c.ai_category).length,icon:"🤖",color:C.blue},
                  {label:"Auto-escalated to Council",value:complaints.filter(c=>c.priority==="Critical"||c.priority==="High").length,icon:"⬆️",color:"#EF4444"},
                  {label:"Admin Overrides",value:complaints.filter(c=>c.admin_overridden).length,icon:"✏️",color:"#F59E0B"},
                ].map(s=>(
                  <div key={s.label} style={{padding:"16px 14px",background:C.slateLight,borderRadius:12,textAlign:"center"}}>
                    <div style={{fontSize:30,marginBottom:6}}>{s.icon}</div>
                    <div style={{fontSize:26,fontWeight:800,color:s.color}}>{s.value}</div>
                    <div style={{fontSize:11,color:C.textMuted,marginTop:4}}>{s.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* SEND NOTIFICATIONS */}
        {view==="notifications"&&(
          <div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20}}>
              <h2 style={{margin:0,fontSize:18,color:C.text}}>Send Municipal Notifications</h2>
              <button onClick={()=>setNotifModal(true)} style={{background:`linear-gradient(135deg,${C.blue},${C.teal})`,color:"#fff",border:"none",padding:"10px 20px",borderRadius:10,fontSize:14,fontWeight:700,cursor:"pointer"}}>
                📢 New Broadcast
              </button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:14,marginBottom:20}}>
              {[
                {icon:"⚡",label:"Electricity Outage",desc:"Notify about planned/unplanned power cuts",color:"#F59E0B",bg:"#FEF3C7"},
                {icon:"💧",label:"Water Disruption",desc:"Alert citizens about water supply issues",color:"#0EA5E9",bg:"#E0F2FE"},
                {icon:"🛣️",label:"Road Closure",desc:"Inform about road works or closures",color:"#8B5CF6",bg:"#EDE9FE"},
                {icon:"🔧",label:"Worker Status Update",desc:"Broadcast technician progress updates",color:"#10B981",bg:"#D1FAE5"},
              ].map(n=>(
                <div key={n.label} onClick={()=>setNotifModal(true)} style={{background:"#fff",borderRadius:14,padding:20,border:`1.5px solid ${n.color}44`,cursor:"pointer",transition:"all .2s"}}>
                  <div style={{width:44,height:44,borderRadius:12,background:n.bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,marginBottom:12}}>{n.icon}</div>
                  <div style={{fontWeight:700,fontSize:15,color:n.color,marginBottom:6}}>{n.label}</div>
                  <div style={{fontSize:13,color:C.textMuted,lineHeight:1.5}}>{n.desc}</div>
                </div>
              ))}
            </div>

            <div style={{background:"#fff",borderRadius:14,padding:20,border:`1px solid ${C.border}`}}>
              <h3 style={{margin:"0 0 16px",fontSize:13,color:C.textMuted,fontWeight:700}}>RECENT BROADCASTS</h3>
              {[
                {icon:"⚡",title:"Planned Power Outage — Zone 4",msg:"Electricity off 15 Apr 06:00–14:00",time:"2h ago",color:"#F59E0B"},
                {icon:"💧",title:"Water Supply Disruption — Soweto",msg:"Burst main, restoration by 18:00",time:"5h ago",color:"#0EA5E9"},
                {icon:"🔧",title:"Technician Update — CMP-001",msg:"Water leak repair in progress on Main Street",time:"1d ago",color:"#10B981"},
              ].map((n,i)=>(
                // eslint-disable-next-line react/no-array-index-key
                <div key={i} style={{display:"flex",gap:12,padding:"12px 14px",borderRadius:10,background:C.slateLight,marginBottom:8,alignItems:"flex-start"}}>
                  <span style={{fontSize:20}}>{n.icon}</span>
                  <div style={{flex:1}}><div style={{fontWeight:700,fontSize:13,color:C.text}}>{n.title}</div><div style={{fontSize:12,color:C.textMuted}}>{n.msg}</div></div>
                  <div style={{fontSize:11,color:"#94A3B8",whiteSpace:"nowrap"}}>{n.time}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <style>{`@keyframes slideIn{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:translateX(0)}}*{box-sizing:border-box}`}</style>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   MUNICIPAL WORKER (TECHNICIAN) DASHBOARD
═══════════════════════════════════════════════════════════════════ */
function TechnicianDashboard({ user, onLogout }) {
  const [view,setView]=useState("jobs");
  const [assignments,setAssignments]=useState([]);
  const [notif,setNotif]=useState(null);
  const [statusModal,setStatusModal]=useState(null);
  const [newStatus,setNewStatus]=useState("");
  const [notes,setNotes]=useState("");
  const [loading,setLoading]=useState(true);
  const token=localStorage.getItem("token");

  const load=useCallback(async()=>{
    setLoading(true);
    try{
      const res=await fetch(`${API}/api/assignments`,{headers:{Authorization:`Bearer ${token}`}});
      const data=await res.json();
      if(data.success)setAssignments(data.assignments);
    }catch(e){console.error(e);}finally{setLoading(false);}
  },[token]);

  useEffect(()=>{load();},[load]);

  const notify=(msg,type="success")=>setNotif({msg,type});

  const updateStatus=async()=>{
    if(!newStatus){alert("Select a status");return;}
    const res=await fetch(`${API}/api/complaints/${statusModal.complaint_id}/status`,{
      method:"PATCH",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},
      body:JSON.stringify({status:newStatus,notes}),
    });
    const data=await res.json();
    if(data.success){notify(`Status updated to ${newStatus}`);setStatusModal(null);setNewStatus("");setNotes("");load();}
    else notify(data.message||"Failed","error");
  };

  const active=assignments.filter(a=>a.status!=="Resolved");
  const done=assignments.filter(a=>a.status==="Resolved");

  return(
    <div style={{fontFamily:"'Segoe UI',system-ui,sans-serif",minHeight:"100vh",background:C.slateLight}}>
      {notif&&<Notif {...notif} onDone={()=>setNotif(null)}/>}

      {/* STATUS UPDATE MODAL */}
      {statusModal&&(
        <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.65)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:"#fff",borderRadius:18,padding:28,maxWidth:440,width:"90%"}}>
            <h3 style={{margin:"0 0 8px",color:C.text}}>🔧 Update Complaint Status</h3>
            <p style={{color:C.textMuted,fontSize:14,marginBottom:16}}>Complaint: <strong>{statusModal.ref_id}</strong></p>
            <label style={{fontSize:12,fontWeight:600,color:C.textMuted,display:"block",marginBottom:6,textTransform:"uppercase"}}>New Status *</label>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
              {["In Progress","Resolved"].map(s=>(
                <div key={s} onClick={()=>setNewStatus(s)} style={{padding:"12px",borderRadius:10,border:newStatus===s?`2px solid ${C.blue}`:`1.5px solid ${C.border}`,cursor:"pointer",background:newStatus===s?"#EFF6FF":"#F8FAFC",textAlign:"center",fontWeight:600,fontSize:14,color:newStatus===s?C.blue:C.text}}>
                  {s==="In Progress"?"🔧 In Progress":"✅ Resolved"}
                </div>
              ))}
            </div>
            <label style={{fontSize:12,fontWeight:600,color:C.textMuted,display:"block",marginBottom:6,textTransform:"uppercase"}}>Notes / Resolution Details</label>
            <textarea value={notes} onChange={e=>setNotes(e.target.value)} rows={3} placeholder="Describe what was done, materials used, any follow-up needed…" style={{width:"100%",borderRadius:10,border:`1.5px solid ${C.border}`,padding:"10px 12px",fontSize:14,resize:"vertical",boxSizing:"border-box",fontFamily:"inherit",marginBottom:14}}/>
            <div style={{display:"flex",gap:10}}>
              <button onClick={()=>{setStatusModal(null);setNewStatus("");setNotes("");}} style={{flex:1,padding:11,background:C.slateLight,border:`1.5px solid ${C.border}`,borderRadius:10,cursor:"pointer"}}>Cancel</button>
              <button onClick={updateStatus} style={{flex:2,padding:11,background:`linear-gradient(135deg,${C.blue},${C.teal})`,color:"#fff",border:"none",borderRadius:10,fontSize:14,fontWeight:700,cursor:"pointer"}}>
                Update Status ✓
              </button>
            </div>
          </div>
        </div>
      )}

      <Header user={user} onLogout={onLogout} accentColor="#10B981" roleIcon="👷"
        tabs={[["jobs","🔧 My Jobs"],["inprogress","⏳ In Progress"],["completed","✅ Completed"],["map","🗺️ Job Map"]]}
        activeTab={view} setActiveTab={setView}/>

      <div style={{maxWidth:1100,margin:"0 auto",padding:"24px 20px"}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:14,marginBottom:22}}>
          <StatCard icon="📋" label="Total Assigned" value={loading?"…":assignments.length} color={C.blue}/>
          <StatCard icon="🔧" label="Active Jobs" value={loading?"…":active.length} color="#F59E0B"/>
          <StatCard icon="✅" label="Completed" value={loading?"…":done.length} color="#10B981"/>
          <StatCard icon="⭐" label="Avg Rating" value="4.2" color="#F59E0B"/>
        </div>

        {(view==="jobs"||view==="inprogress")&&(
          <div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
              <h2 style={{margin:0,fontSize:18,color:C.text}}>{view==="jobs"?"All My Jobs":"In Progress"}</h2>
              <button onClick={load} style={{padding:"8px 14px",background:C.blue,color:"#fff",border:"none",borderRadius:10,fontSize:13,cursor:"pointer",fontWeight:600}}>🔄 Refresh</button>
            </div>
            {(view==="jobs"?assignments:assignments.filter(a=>a.status==="In Progress"||a.status==="Assigned")).map(a=>{
              const cat=CATEGORIES.find(k=>k.id===a.category);
              const lat=parseFloat(a.latitude)||(-26.2+Math.random()*.1);
              const lng=parseFloat(a.longitude)||(27.9+Math.random()*.2);
              return(
                <div key={a.assignment_id||a.id} style={{background:"#fff",borderRadius:14,padding:"16px 18px",border:`1px solid ${C.border}`,marginBottom:12}}>
                  <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:12,marginBottom:12}}>
                    <div style={{display:"flex",gap:12,alignItems:"center"}}>
                      <div style={{width:46,height:46,borderRadius:12,background:cat?.bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0}}>{cat?.icon}</div>
                      <div>
                        <div style={{fontWeight:700,fontSize:15,color:C.text}}>{a.ref_id}</div>
                        <div style={{fontSize:13,color:C.textMuted}}>{cat?.label}</div>
                      </div>
                    </div>
                    <div style={{display:"flex",gap:8,alignItems:"center"}}>
                      <Badge priority={a.priority}/>
                      <span style={{fontSize:11,padding:"4px 10px",borderRadius:20,background:a.status==="Resolved"?"#D1FAE5":a.status==="In Progress"?"#DBEAFE":"#FEF3C7",color:a.status==="Resolved"?"#065F46":a.status==="In Progress"?"#1E40AF":"#92400E",fontWeight:600}}>{a.status}</span>
                    </div>
                  </div>

                  <p style={{fontSize:13,color:"#475569",margin:"0 0 10px",lineHeight:1.5}}>{a.description}</p>

                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
                    <div style={{padding:"10px 12px",background:C.slateLight,borderRadius:8}}>
                      <div style={{fontSize:11,color:C.textMuted,marginBottom:2}}>📍 LOCATION</div>
                      <div style={{fontSize:13,color:C.text,fontWeight:500}}>{a.address||"See map below"}</div>
                    </div>
                    <div style={{padding:"10px 12px",background:C.slateLight,borderRadius:8}}>
                      <div style={{fontSize:11,color:C.textMuted,marginBottom:2}}>📅 TASK PERIOD</div>
                      <div style={{fontSize:13,color:C.text,fontWeight:500}}>{a.task_start_date||"—"} → {a.task_end_date||"—"}</div>
                    </div>
                  </div>

                  {/* Mini map for this job */}
                  <div style={{borderRadius:10,overflow:"hidden",border:`1px solid ${C.border}`,marginBottom:14}}>
                    <iframe title={`map-${a.ref_id}`} width="100%" height="140" frameBorder="0" style={{display:"block"}}
                      src={`https://www.openstreetmap.org/export/embed.html?bbox=${lng-.008},${lat-.008},${lng+.008},${lat+.008}&layer=mapnik&marker=${lat},${lng}`}/>
                    <div style={{padding:"5px 10px",background:"#F8FAFC",fontSize:11,color:C.textMuted,textAlign:"center"}}>📍 GPS: {lat.toFixed(5)}, {lng.toFixed(5)}</div>
                  </div>

                  <StatusBar status={a.status}/>

                  {a.status!=="Resolved"&&(
                    <button onClick={()=>{setStatusModal(a);setNewStatus("");}} style={{width:"100%",marginTop:14,padding:"11px",background:`linear-gradient(135deg,${C.blue},${C.teal})`,color:"#fff",border:"none",borderRadius:10,fontSize:14,fontWeight:700,cursor:"pointer"}}>
                      🔧 Update Status
                    </button>
                  )}
                  {a.status==="Resolved"&&(
                    <div style={{marginTop:12,padding:"10px 14px",background:"#D1FAE5",borderRadius:10,fontSize:13,color:"#065F46",fontWeight:600,textAlign:"center"}}>
                      ✅ This job is complete
                    </div>
                  )}
                  {a.notes&&<div style={{marginTop:10,padding:"8px 12px",background:"#FFF7ED",borderRadius:8,fontSize:12,color:"#92400E"}}>📝 Notes: {a.notes}</div>}
                </div>
              );
            })}
            {assignments.length===0&&<div style={{textAlign:"center",padding:60,color:C.textMuted,background:"#fff",borderRadius:14,border:`1px solid ${C.border}`}}><div style={{fontSize:48,marginBottom:12}}>📭</div><div>No jobs assigned yet</div></div>}
          </div>
        )}

        {view==="completed"&&(
          <div>
            <h2 style={{margin:"0 0 16px",fontSize:18,color:C.text}}>Completed Jobs</h2>
            {done.length===0?(
              <div style={{textAlign:"center",padding:60,color:C.textMuted,background:"#fff",borderRadius:14,border:`1px solid ${C.border}`}}>No completed jobs yet</div>
            ):done.map(a=>{
              const cat=CATEGORIES.find(k=>k.id===a.category);
              return(
                <div key={a.assignment_id||a.id} style={{background:"#fff",borderRadius:14,padding:"14px 16px",border:`1px solid ${C.border}`,marginBottom:10,display:"flex",gap:12,alignItems:"center"}}>
                  <div style={{width:42,height:42,borderRadius:11,background:cat?.bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>{cat?.icon}</div>
                  <div style={{flex:1}}><div style={{fontWeight:700,color:C.text}}>{a.ref_id}</div><div style={{fontSize:12,color:C.textMuted}}>{cat?.label} · Resolved</div></div>
                  <span style={{fontSize:11,padding:"4px 10px",borderRadius:20,background:"#D1FAE5",color:"#065F46",fontWeight:600}}>✅ Done</span>
                </div>
              );
            })}
          </div>
        )}

        {view==="map"&&(
          <div>
            <h2 style={{margin:"0 0 16px",fontSize:18,color:C.text}}>Job Locations Map</h2>
            <div style={{background:"#fff",borderRadius:14,padding:20,border:`1px solid ${C.border}`}}>
              <LiveTrackingMap complaints={assignments.map(a=>({...a,id:a.ref_id,category:a.category,lat:parseFloat(a.latitude)||null,lng:parseFloat(a.longitude)||null}))} technicians={[{name:user.full_name,role:"Technician",color:"#10B981",status_label:"On duty",lat:null,lng:null}]} selected={null} onSelect={()=>{}} title="My Job Locations" height={380}/>
            </div>
          </div>
        )}
      </div>
      <style>{`@keyframes slideIn{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:translateX(0)}}*{box-sizing:border-box}`}</style>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   COUNCILLOR DASHBOARD
═══════════════════════════════════════════════════════════════════ */
function CouncillorDashboard({ user, onLogout }) {
  const [view,setView]=useState("queue");
  const [escalations,setEscalations]=useState([]);
  const [notif,setNotif]=useState(null);
  const [decisionModal,setDecisionModal]=useState(null);
  const [decision,setDecision]=useState("");
  const [decisionNotes,setDecisionNotes]=useState("");
  const [loading,setLoading]=useState(true);
  const token=localStorage.getItem("token");

  const load=useCallback(async()=>{
    setLoading(true);
    try{
      const res=await fetch(`${API}/api/escalations`,{headers:{Authorization:`Bearer ${token}`}});
      const data=await res.json();
      if(data.success)setEscalations(data.escalations);
    }catch(e){console.error(e);}finally{setLoading(false);}
  },[token]);

  useEffect(()=>{load();},[load]);

  const notify=(msg,type="success")=>setNotif({msg,type});

  const logDecision=async()=>{
    if(!decision){alert("Select a decision");return;}
    const res=await fetch(`${API}/api/escalations/${decisionModal.escalation_id}/decision`,{
      method:"PATCH",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},
      body:JSON.stringify({decision,decision_notes:decisionNotes}),
    });
    const data=await res.json();
    if(data.success){notify("Council decision recorded","info");setDecisionModal(null);setDecision("");setDecisionNotes("");load();}
    else notify(data.message||"Failed","error");
  };

  const pending=escalations.filter(e=>e.decision==="Pending");
  const decided=escalations.filter(e=>e.decision!=="Pending");

  return(
    <div style={{fontFamily:"'Segoe UI',system-ui,sans-serif",minHeight:"100vh",background:C.slateLight}}>
      {notif&&<Notif {...notif} onDone={()=>setNotif(null)}/>}

      {/* DECISION MODAL */}
      {decisionModal&&(
        <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.65)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:"#fff",borderRadius:18,padding:28,maxWidth:480,width:"90%"}}>
            <h3 style={{margin:"0 0 8px",color:C.text}}>⚖️ Log Council Decision</h3>
            <p style={{color:C.textMuted,fontSize:14,marginBottom:16}}>Case: <strong>{decisionModal.ref_id}</strong> — {decisionModal.category}</p>
            <div style={{padding:"12px 14px",background:"#FEF2F2",borderRadius:10,border:"1px solid #FECACA",marginBottom:16,fontSize:13,color:"#DC2626"}}>
              🚨 <strong>{decisionModal.priority}</strong> priority complaint requiring council action
            </div>
            <label style={{fontSize:12,fontWeight:600,color:C.textMuted,display:"block",marginBottom:8,textTransform:"uppercase"}}>Council Decision *</label>
            <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:14}}>
              {["Approved Emergency Budget","Direct Resources","Escalate to Management","Schedule Site Visit"].map(d=>(
                <div key={d} onClick={()=>setDecision(d)} style={{padding:"12px 14px",borderRadius:10,border:decision===d?`2px solid #7C3AED`:`1.5px solid ${C.border}`,cursor:"pointer",background:decision===d?"#EDE9FE":"#F8FAFC",fontWeight:600,fontSize:13,color:decision===d?"#7C3AED":C.text}}>
                  {d==="Approved Emergency Budget"?"💰 Approve Emergency Budget":d==="Direct Resources"?"👷 Direct Resources":d==="Escalate to Management"?"⬆️ Escalate to Senior Management":"📅 Schedule Site Visit / Community Meeting"}
                </div>
              ))}
            </div>
            <label style={{fontSize:12,fontWeight:600,color:C.textMuted,display:"block",marginBottom:6,textTransform:"uppercase"}}>Decision Notes</label>
            <textarea value={decisionNotes} onChange={e=>setDecisionNotes(e.target.value)} rows={3} placeholder="Document your decision rationale, action plan, or resource allocation…" style={{width:"100%",borderRadius:10,border:`1.5px solid ${C.border}`,padding:"10px 12px",fontSize:14,resize:"vertical",boxSizing:"border-box",fontFamily:"inherit",marginBottom:14}}/>
            <div style={{display:"flex",gap:10}}>
              <button onClick={()=>{setDecisionModal(null);setDecision("");setDecisionNotes("");}} style={{flex:1,padding:11,background:C.slateLight,border:`1.5px solid ${C.border}`,borderRadius:10,cursor:"pointer"}}>Cancel</button>
              <button onClick={logDecision} style={{flex:2,padding:11,background:"linear-gradient(135deg,#7C3AED,#6D28D9)",color:"#fff",border:"none",borderRadius:10,fontSize:14,fontWeight:700,cursor:"pointer"}}>
                Log Decision ✓
              </button>
            </div>
          </div>
        </div>
      )}

      <Header user={user} onLogout={onLogout} accentColor="#7C3AED" roleIcon="⚖️"
        tabs={[["queue",`🚨 Council Queue${pending.length>0?` (${pending.length})`:""}`],["decided","✅ Decided Cases"],["map","🗺️ Escalation Map"]]}
        activeTab={view} setActiveTab={setView}/>

      <div style={{maxWidth:1100,margin:"0 auto",padding:"24px 20px"}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:14,marginBottom:22}}>
          <StatCard icon="🚨" label="Pending Review" value={loading?"…":pending.length} color="#EF4444"/>
          <StatCard icon="✅" label="Decisions Made" value={loading?"…":decided.length} color="#10B981"/>
          <StatCard icon="📋" label="Total Escalated" value={loading?"…":escalations.length} color="#7C3AED"/>
          <StatCard icon="👥" label="Citizen Reviews" value={loading?"…":escalations.filter(e=>e.escalation_type==="citizen_request").length} color="#F59E0B"/>
        </div>

        {/* Important notice */}
        <div style={{background:"#FEF2F2",border:"1px solid #FECACA",borderRadius:12,padding:"14px 18px",marginBottom:20,display:"flex",gap:12,alignItems:"center"}}>
          <span style={{fontSize:24}}>⚖️</span>
          <div>
            <div style={{fontWeight:700,color:"#DC2626",fontSize:14}}>Councillor Role — High & Critical Priority Only</div>
            <div style={{fontSize:13,color:"#EF4444",marginTop:2}}>You only receive complaints escalated as High or Critical priority. Low and Medium priority complaints are handled by the Administrator and Technicians. Cases here may require face-to-face community meetings.</div>
          </div>
        </div>

        {/* COUNCIL QUEUE */}
        {view==="queue"&&(
          <div>
            <h2 style={{margin:"0 0 16px",fontSize:18,color:C.text}}>Pending Council Cases</h2>
            {loading&&<div style={{textAlign:"center",padding:40,color:C.textMuted}}>Loading queue…</div>}
            {!loading&&pending.length===0&&(
              <div style={{textAlign:"center",padding:60,color:C.textMuted,background:"#fff",borderRadius:14,border:`1px solid ${C.border}`}}>
                <div style={{fontSize:48,marginBottom:12}}>✅</div>
                <div style={{fontSize:16,fontWeight:600}}>No pending cases</div>
                <div style={{fontSize:13,marginTop:6}}>All escalated complaints have been reviewed</div>
              </div>
            )}
            {pending.map(e=>{
              const cat=CATEGORIES.find(k=>k.id===e.category);
              const lat=parseFloat(e.latitude)||(-26.2+Math.random()*.1);
              const lng=parseFloat(e.longitude)||(27.9+Math.random()*.2);
              return(
                <div key={e.escalation_id} style={{background:"#fff",borderRadius:14,padding:"18px 20px",border:`2px solid ${e.priority==="Critical"?"#EF4444":"#F59E0B"}`,marginBottom:16}}>
                  <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:12,marginBottom:14}}>
                    <div style={{display:"flex",gap:12}}>
                      <div style={{width:48,height:48,borderRadius:12,background:cat?.bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,flexShrink:0}}>{cat?.icon}</div>
                      <div>
                        <div style={{fontWeight:700,fontSize:16,color:C.text}}>{e.ref_id}</div>
                        <div style={{fontSize:13,color:C.textMuted}}>{cat?.label} · Escalated {e.escalated_at?.slice(0,10)}</div>
                        <div style={{fontSize:12,color:"#94A3B8",marginTop:2}}>Citizen: {e.citizen_name}</div>
                      </div>
                    </div>
                    <Badge priority={e.priority}/>
                  </div>

                  <div style={{padding:"12px 14px",background:"#FEF2F2",borderRadius:10,border:"1px solid #FECACA",marginBottom:14}}>
                    <div style={{fontSize:12,color:"#DC2626",fontWeight:600,marginBottom:4}}>🚨 COMPLAINT DETAILS</div>
                    <div style={{fontSize:13,color:"#374151",lineHeight:1.6}}>{e.description}</div>
                  </div>

                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
                    <div style={{padding:"10px 12px",background:C.slateLight,borderRadius:8}}>
                      <div style={{fontSize:11,color:C.textMuted,marginBottom:2}}>📍 LOCATION</div>
                      <div style={{fontSize:13,color:C.text,fontWeight:500}}>{e.address||"See map"}</div>
                    </div>
                    <div style={{padding:"10px 12px",background:C.slateLight,borderRadius:8}}>
                      <div style={{fontSize:11,color:C.textMuted,marginBottom:2}}>📊 ESCALATION TYPE</div>
                      <div style={{fontSize:13,color:C.text,fontWeight:500}}>{e.escalation_type==="citizen_request"?"Citizen Request":"Auto-escalated by AI"}</div>
                    </div>
                  </div>

                  {/* Location map */}
                  <div style={{borderRadius:10,overflow:"hidden",border:`1px solid ${C.border}`,marginBottom:14}}>
                    <iframe title={`council-map-${e.ref_id}`} width="100%" height="150" frameBorder="0" style={{display:"block"}}
                      src={`https://www.openstreetmap.org/export/embed.html?bbox=${lng-.01},${lat-.01},${lng+.01},${lat+.01}&layer=mapnik&marker=${lat},${lng}`}/>
                    <div style={{padding:"5px 10px",background:"#F8FAFC",fontSize:11,color:C.textMuted,textAlign:"center"}}>📍 Affected area location</div>
                  </div>

                  <div style={{padding:"12px 14px",background:"#EDE9FE",borderRadius:10,border:"1px solid #C4B5FD",marginBottom:14,fontSize:13,color:"#5B21B6"}}>
                    ⚖️ <strong>Council Action Required:</strong> This complaint requires your review and decision. You may need to schedule a community meeting or approve emergency resources.
                  </div>

                  <button onClick={()=>{setDecisionModal(e);setDecision("");}} style={{width:"100%",padding:"13px",background:"linear-gradient(135deg,#7C3AED,#6D28D9)",color:"#fff",border:"none",borderRadius:10,fontSize:15,fontWeight:700,cursor:"pointer"}}>
                    ⚖️ Log Council Decision
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* DECIDED CASES */}
        {view==="decided"&&(
          <div>
            <h2 style={{margin:"0 0 16px",fontSize:18,color:C.text}}>Decided Cases — Audit Trail</h2>
            {decided.length===0?<div style={{textAlign:"center",padding:60,color:C.textMuted,background:"#fff",borderRadius:14,border:`1px solid ${C.border}`}}>No decided cases yet</div>
            :decided.map(e=>{
              const cat=CATEGORIES.find(k=>k.id===e.category);
              return(
                <div key={e.escalation_id} style={{background:"#fff",borderRadius:14,padding:"16px 18px",border:`1px solid ${C.border}`,marginBottom:12}}>
                  <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:10}}>
                    <span style={{fontSize:22}}>{cat?.icon}</span>
                    <div style={{flex:1}}><div style={{fontWeight:700,color:C.text}}>{e.ref_id} — {cat?.label}</div><div style={{fontSize:12,color:C.textMuted}}>Decided: {e.decided_at?.slice(0,10)||"—"}</div></div>
                    <Badge priority={e.priority}/>
                    <span style={{fontSize:11,padding:"4px 10px",borderRadius:20,background:"#D1FAE5",color:"#065F46",fontWeight:600}}>✅ Decided</span>
                  </div>
                  <div style={{padding:"10px 12px",background:"#D1FAE5",borderRadius:8,fontSize:13,color:"#065F46"}}>
                    <strong>Decision:</strong> {e.decision}
                    {e.decision_notes&&<div style={{marginTop:4,color:"#047857"}}>{e.decision_notes}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ESCALATION MAP */}
        {view==="map"&&(
          <div>
            <h2 style={{margin:"0 0 16px",fontSize:18,color:C.text}}>Escalation Locations</h2>
            <div style={{background:"#fff",borderRadius:14,padding:20,border:`1px solid ${C.border}`}}>
              <LiveTrackingMap complaints={escalations.map(e=>({...e,id:e.ref_id,status:"Escalated",priority:e.priority||"High",lat:parseFloat(e.latitude)||null,lng:parseFloat(e.longitude)||null}))} selected={null} onSelect={()=>{}} title="Escalation Locations — Council View" height={400}/>
            </div>
          </div>
        )}
      </div>
      <style>{`@keyframes slideIn{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:translateX(0)}}*{box-sizing:border-box}`}</style>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   ROOT APP — ROLE-BASED ROUTING
═══════════════════════════════════════════════════════════════════ */
export default function App() {
  const [screen,setScreen]=useState("login");
  const [user,setUser]=useState(null);

  const login=u=>{
    setUser({id:u.id,name:u.full_name||u.name||"User",full_name:u.full_name||u.name||"User",email:u.email||"",role:u.role||"Citizen",id_number:u.id_number||""});
    setScreen("portal");
  };
  const logout=()=>{localStorage.removeItem("token");setUser(null);setScreen("login");};
  const registered=()=>setScreen("login");

  if(screen==="login")    return <LoginPage onLogin={login} onGoRegister={()=>setScreen("register")}/>;
  if(screen==="register") return <RegisterPage onBack={()=>setScreen("login")} onRegistered={registered}/>;

  if(screen==="portal"&&user){
    if(user.role==="Administrator") return <AdminDashboard user={user} onLogout={logout}/>;
    if(user.role==="Technician")    return <TechnicianDashboard user={user} onLogout={logout}/>;
    if(user.role==="Councillor")    return <CouncillorDashboard user={user} onLogout={logout}/>;
    return <CitizenPortal user={user} onLogout={logout}/>;
  }
  return <LoginPage onLogin={login} onGoRegister={()=>setScreen("register")}/>;
}