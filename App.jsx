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
const ALL_STATUSES   = ["Submitted","Classified","Assigned","In Progress","Resolved","Escalated"];

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
  // Escalated is a special status — show it as a separate badge instead of a step
  if (status === "Escalated") {
    return (
      <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:10 }}>
        <span style={{ fontSize:10, fontWeight:700, padding:"3px 10px", borderRadius:20, background:"#FEE2E2", color:"#DC2626" }}>
          ⬆ Escalated to Council
        </span>
      </div>
    );
  }
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
  const mapRef = useRef(null);
  const leafletMap = useRef(null);
  const markersRef = useRef([]);
  const [expanded, setExpanded] = useState(false);
  const [tick, setTick] = useState(0);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const now = new Date();
  const clock = [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map(n => String(n).padStart(2, "0")).join(":");

  const STATUS_COLORS = {
    "Submitted": "#888780", "Classified": "#888780",
    "Assigned": "#378ADD", "In Progress": "#EF9F27",
    "Resolved": "#639922", "Escalated": "#D85A30",
  };

  const normalised = complaints.map((c) => ({
    ...c,
    lat: parseFloat(c.lat ?? c.latitude) || null,
    lng: parseFloat(c.lng ?? c.longitude) || null,
  }));

  const fallbackCoord = (item, idx) => {
    const lat = parseFloat(item.lat ?? item.latitude);
    const lng = parseFloat(item.lng ?? item.longitude);
    const validLat = !isNaN(lat) && lat !== 0 && lat >= -26.5 && lat <= -25.0;
    const validLng = !isNaN(lng) && lng !== 0 && lng >= 28.5 && lng <= 30.5;
    const row = Math.floor(idx / 4);
    const col = idx % 4;
    return {
      lat: validLat ? lat : -25.87 - (row * 0.04),
      lng: validLng ? lng : 29.24 + (col * 0.05),
    };
  };

  // ── Step 1: Load Leaflet, then init map, then signal ready ──
  useEffect(() => {
    const initMap = () => {
      if (!mapRef.current || leafletMap.current) return;
      const L = window.L;
      if (!L) return;

      const map = L.map(mapRef.current, {
        center: [-25.87, 29.24],
        zoom: 13,
        zoomControl: true,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);

      leafletMap.current = map;
      setTimeout(() => {
        map.invalidateSize();
        setMapReady(true);  // ← triggers the markers effect
      }, 200);
    };

    if (window.L) {
      initMap();
      return;
    }

    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }

    if (!document.getElementById('leaflet-js')) {
      const script = document.createElement('script');
      script.id = 'leaflet-js';
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.onload = () => initMap();
      document.head.appendChild(script);
    } else {
      document.getElementById('leaflet-js').addEventListener('load', initMap);
    }

    return () => {
      if (leafletMap.current) {
        leafletMap.current.remove();
        leafletMap.current = null;
        setMapReady(false);
      }
    };
  }, []);

  // ── Step 2: Draw markers — only runs after mapReady is true ──
  useEffect(() => {
    if (!mapReady || !leafletMap.current || !window.L) return;
    const L = window.L;
    const map = leafletMap.current;

    // Clear old markers
    markersRef.current.forEach(m => map.removeLayer(m));
    markersRef.current = [];

    normalised.forEach((c, i) => {
      const coord = fallbackCoord(c, i);
      const color = STATUS_COLORS[c.status] || "#888";
      const cat = CATEGORIES.find(k => k.id === c.category);
      const isSelected = selected === (c.id || c.ref_id);

      const icon = L.divIcon({
        className: '',
        html: `<div style="
          width:${isSelected ? 36 : 28}px;
          height:${isSelected ? 36 : 28}px;
          background:${color};
          border:3px solid white;
          border-radius:50% 50% 50% 0;
          transform:rotate(-45deg);
          box-shadow:0 2px 8px rgba(0,0,0,0.3);
          ${isSelected ? 'outline:3px solid ' + color + ';outline-offset:2px;' : ''}
        "></div>`,
        iconSize: [isSelected ? 36 : 28, isSelected ? 36 : 28],
        iconAnchor: [isSelected ? 18 : 14, isSelected ? 36 : 28],
        popupAnchor: [0, -30],
      });

      const marker = L.marker([coord.lat, coord.lng], { icon })
        .addTo(map)
        .bindPopup(`
          <div style="font-family:'Segoe UI',sans-serif;min-width:180px">
            <div style="font-weight:700;font-size:14px;color:#0F172A;margin-bottom:4px">${c.id || c.ref_id || '—'}</div>
            <div style="font-size:12px;color:#64748B;margin-bottom:4px">${cat?.icon || ''} ${cat?.label || c.category || ''}</div>
            <div style="font-size:11px;padding:3px 8px;border-radius:12px;background:${color}22;color:${color};font-weight:600;display:inline-block;margin-bottom:6px">${c.status || ''} · ${c.priority || ''}</div>
            <div style="font-size:11px;color:#94A3B8">${String(c.address || '').slice(0, 60)}</div>
          </div>
        `, { maxWidth: 220 })
        .on('click', () => { if (onSelect) onSelect(c.id || c.ref_id); });

      markersRef.current.push(marker);
    });

    // Technician markers
    technicians.forEach((tech, ti) => {
      const coord = fallbackCoord(tech, ti + 50);
      const techIcon = L.divIcon({
        className: '',
        html: `<div style="
          width:32px;height:32px;
          background:${tech.color || '#378ADD'};
          border:3px solid white;
          border-radius:50%;
          display:flex;align-items:center;justify-content:center;
          font-size:14px;font-weight:700;color:white;
          box-shadow:0 2px 8px rgba(0,0,0,0.3);
          line-height:26px;text-align:center;
        ">T</div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
        popupAnchor: [0, -20],
      });
      const tm = L.marker([coord.lat, coord.lng], { icon: techIcon })
        .addTo(map)
        .bindPopup(`<div style="font-family:'Segoe UI',sans-serif"><strong>${tech.name}</strong><br/><span style="font-size:11px;color:#64748B">${tech.role || 'Technician'} · ${tech.status_label || 'On duty'}</span></div>`);
      markersRef.current.push(tm);
    });

    // Fit bounds to show all markers
    if (markersRef.current.length > 0) {
      try {
        const group = L.featureGroup(markersRef.current);
        map.fitBounds(group.getBounds().pad(0.2));
      } catch (_) {
        map.setView([-25.87, 29.24], 13);
      }
    }
  }, [mapReady, complaints, selected, technicians]);

  // ── Step 3: Resize on expand/collapse ──
  useEffect(() => {
    if (leafletMap.current) {
      setTimeout(() => leafletMap.current.invalidateSize(), 300);
    }
  }, [expanded]);

  const mapHeight = expanded ? "80vh" : height;

  return (
    <div style={{
      borderRadius: 14, overflow: "hidden",
      border: `1px solid ${C.border}`, background: "#fff",
      fontFamily: "'Segoe UI',system-ui,sans-serif",
      position: expanded ? "fixed" : "relative",
      inset: expanded ? "16px" : "auto",
      zIndex: expanded ? 1000 : 1,
      boxShadow: expanded ? "0 24px 80px rgba(0,0,0,.35)" : "none",
    }}>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 14px", borderBottom:`1px solid ${C.border}`, background:"#fff" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:28, height:28, borderRadius:7, background:"#EFF6FF", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14 }}>🗺️</div>
          <div>
            <div style={{ fontSize:13, fontWeight:700, color:C.text }}>{title}</div>
            <div style={{ fontSize:10, color:C.textMuted }}>Real-time · click pins for details · drag to move</div>
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ display:"flex", alignItems:"center", gap:5, background:"#F0FDF4", border:"1px solid #BBF7D0", borderRadius:20, padding:"3px 9px" }}>
            <span style={{ width:7, height:7, background:"#16a34a", borderRadius:"50%", display:"inline-block" }}/>
            <span style={{ fontSize:10, fontWeight:600, color:"#16a34a" }}>Live</span>
          </div>
          <span style={{ fontSize:11, color:C.textMuted }}>{clock}</span>
          <button onClick={() => setExpanded(e => !e)} style={{ background:"#F1F5F9", border:`1px solid ${C.border}`, borderRadius:8, padding:"5px 10px", cursor:"pointer", fontSize:12, fontWeight:600, color:C.text }}>
            {expanded ? "⊠ Minimize" : "⊞ Expand"}
          </button>
        </div>
      </div>

      {/* Legend */}
      <div style={{ display:"flex", alignItems:"center", gap:10, padding:"6px 14px", borderBottom:`1px solid ${C.border}`, background:C.slateLight, flexWrap:"wrap" }}>
        {Object.entries(STATUS_COLORS).filter(([s])=>s!=="Classified").map(([s, color]) => (
          <div key={s} style={{ display:"flex", alignItems:"center", gap:4 }}>
            <span style={{ width:8, height:8, background:color, borderRadius:"50%", display:"inline-block" }}/>
            <span style={{ fontSize:10, color:C.textMuted }}>{s}</span>
          </div>
        ))}
      </div>

      {/* Leaflet Map */}
      <div ref={mapRef} style={{ width:"100%", height: typeof mapHeight === "number" ? `${mapHeight}px` : mapHeight }} />

      {/* Footer */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"7px 14px", borderTop:`1px solid ${C.border}`, background:"#fff" }}>
        <div style={{ fontSize:11, color:C.textMuted }}>📍 {normalised.length} complaint{normalised.length !== 1 ? "s" : ""} plotted</div>
        <div style={{ fontSize:11, color:C.textMuted }}>Emalahleni Local Municipality</div>
        <div style={{ fontSize:11, color:C.textMuted }}>Ward 8</div>
      </div>
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

  const tabs=[["dashboard","🏠 Dashboard"],["complaints","📋 My Complaints"],["map","🗺️ Map View"],["reports","📈 My Report"],["notifications",`🔔 Alerts${unreadNotifs>0?` (${unreadNotifs})`:""}`]];

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
                const dbId = c.dbId || c.id;
                await fetch(`${API}/api/complaints/${parseInt(dbId,10)}/request-review`,{
                  method:"POST",
                  headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},
                  body:JSON.stringify({complaint_id:parseInt(dbId,10)})
                });
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
            <CitizenSubmitForm onSubmit={handleSubmit} onClose={()=>setShowForm(false)} existingComplaints={complaints}/>
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
              <LiveTrackingMap complaints={complaints.map(c=>({...c,lat:parseFloat(c.lat||c.latitude)||null,lng:parseFloat(c.lng||c.longitude)||null}))} selected={selected} onSelect={setSelected} title="Live Complaint Map" height={300}/>
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
                    <span style={{ fontSize:11,fontWeight:600,padding:"4px 10px",borderRadius:20,background:c.status==="Resolved"?"#D1FAE5":c.status==="Escalated"?"#FEE2E2":c.status==="In Progress"?"#DBEAFE":"#F1F5F9",
                    color:c.status==="Resolved"?"#065F46":c.status==="Escalated"?"#DC2626":c.status==="In Progress"?"#1E40AF":"#64748B",whiteSpace:"nowrap" }}>{c.status}</span>
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
              <LiveTrackingMap complaints={complaints.map(c=>({...c,lat:parseFloat(c.lat||c.latitude)||null,lng:parseFloat(c.lng||c.longitude)||null}))} selected={selected} onSelect={setSelected} title="All Reported Locations" height={360}/>
            </div>
          </div>
        )}

        {/* CITIZEN REPORT */}
        {view==="reports"&&(
          <CitizenComplaintsReport token={token} currentUser={user} notify={(msg)=>console.log(msg)}/>
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
  const [locationMode,setLocationMode]=useState("gps");
  const [searchQuery,setSearchQuery]=useState("");
  const [searchResults,setSearchResults]=useState([]);
  const fileRef=useRef(null);
  const camRef=useRef(null);

  useEffect(()=>{},[]);

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
          {/* ── Location Mode Selector ── */}
          <label style={{fontSize:12,fontWeight:600,color:C.textMuted,display:"block",marginBottom:8,textTransform:"uppercase"}}>📍 Pin the Complaint Location</label>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
            {[
              {mode:"gps",icon:"📡",label:"My Current Location",desc:"Use GPS"},
              {mode:"search",icon:"🔍",label:"Search Address",desc:"Type to find"},
            ].map(({mode,icon,label,desc})=>(
              <div key={mode} onClick={()=>{
                setLocationMode(mode);
                if(mode==="gps"&&!coords){
                  setGeoLoading(true);
                  navigator.geolocation?.getCurrentPosition(
                    pos=>{
                      const c={lat:pos.coords.latitude,lng:pos.coords.longitude,accuracy:Math.round(pos.coords.accuracy)};
                      setCoords(c);
                      fetch(`https://nominatim.openstreetmap.org/reverse?lat=${c.lat}&lon=${c.lng}&format=json`)
                        .then(r=>r.json()).then(d=>{if(d.display_name)setAddr(d.display_name.split(",").slice(0,4).join(", ").trim());}).catch(()=>{});
                      setGeoLoading(false);
                    },
                    ()=>{setGeoError("GPS denied.");setGeoLoading(false);},
                    {enableHighAccuracy:true,timeout:10000}
                  );
                }
              }} style={{padding:"12px",borderRadius:12,border:locationMode===mode?`2px solid ${C.blue}`:`1.5px solid ${C.border}`,cursor:"pointer",background:locationMode===mode?"#EFF6FF":"#F8FAFC",textAlign:"center"}}>
                <div style={{fontSize:24,marginBottom:4}}>{icon}</div>
                <div style={{fontSize:13,fontWeight:700,color:locationMode===mode?C.blue:C.text}}>{label}</div>
                <div style={{fontSize:11,color:C.textMuted}}>{desc}</div>
              </div>
            ))}
          </div>

          {/* ── GPS mode ── */}
          {locationMode==="gps"&&(
            geoLoading
              ?<div style={{padding:"12px 16px",background:"#EFF6FF",borderRadius:10,border:"1px solid #BFDBFE",fontSize:13,color:"#1E40AF",marginBottom:12}}>🔄 Detecting location…</div>
              :coords
                ?<div style={{padding:"12px 16px",background:"#F0FDF4",borderRadius:10,border:"1px solid #BBF7D0",fontSize:13,color:"#166534",marginBottom:12}}>
                  ✅ GPS: <strong>{coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}</strong> {coords.accuracy>0&&`(±${coords.accuracy}m)`}
                </div>
                :<div style={{padding:"12px 16px",background:"#FEF2F2",borderRadius:10,border:"1px solid #FECACA",fontSize:13,color:"#DC2626",marginBottom:12}}>⚠️ {geoError||"Click 'My Current Location' to detect GPS"}</div>
          )}

          {/* ── Search mode ── */}
          {locationMode==="search"&&(
            <div style={{marginBottom:12}}>
              <div style={{position:"relative",marginBottom:8}}>
                <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",fontSize:16}}>🔍</span>
                <input
                  value={searchQuery}
                  onChange={e=>{
                    setSearchQuery(e.target.value);
                    setSearchResults([]);
                    if(e.target.value.length>2){
                      clearTimeout(searchTimerRef.current);
                    searchTimerRef.current=setTimeout(async()=>{
                        try{
                          const res=await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(e.target.value+", Emalahleni, South Africa")}&format=json&limit=6&addressdetails=1`);
                          const data=await res.json();
                          setSearchResults(data);
                        }catch(e){console.error(e);}
                      },500);
                    }
                  }}
                  placeholder="e.g. Mandela Drive, Emalahleni..."
                  style={{width:"100%",padding:"11px 12px 11px 38px",borderRadius:10,border:`1.5px solid ${C.border}`,fontSize:14,boxSizing:"border-box",fontFamily:"inherit"}}
                />
              </div>
              {/* Search results dropdown */}
              {searchResults.length>0&&(
                <div style={{background:"#fff",border:`1px solid ${C.border}`,borderRadius:10,overflow:"hidden",marginBottom:8,boxShadow:"0 4px 16px rgba(0,0,0,.1)"}}>
                  {searchResults.map((r,i)=>(
                    <div key={i} onClick={()=>{
                      const lat=parseFloat(r.lat);
                      const lng=parseFloat(r.lon);
                      setCoords({lat,lng,accuracy:0});
                      setAddr(r.display_name.split(",").slice(0,4).join(", ").trim());
                      setSearchQuery(r.display_name.split(",").slice(0,3).join(", "));
                      setSearchResults([]);
                    }} style={{padding:"10px 14px",borderBottom:i<searchResults.length-1?`1px solid ${C.border}`:"none",cursor:"pointer",fontSize:13,color:C.text,display:"flex",alignItems:"flex-start",gap:8}}
                      onMouseEnter={e=>e.currentTarget.style.background="#F8FAFC"}
                      onMouseLeave={e=>e.currentTarget.style.background="#fff"}>
                      <span style={{fontSize:16,flexShrink:0}}>📍</span>
                      <div>
                        <div style={{fontWeight:600,marginBottom:2}}>{r.display_name.split(",").slice(0,2).join(", ")}</div>
                        <div style={{fontSize:11,color:C.textMuted}}>{r.display_name.split(",").slice(2,5).join(", ")}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {searchQuery.length>2&&searchResults.length===0&&(
                <div style={{fontSize:12,color:C.textMuted,padding:"8px 12px",background:C.slateLight,borderRadius:8}}>
                  🔍 Searching for "{searchQuery}"…
                </div>
              )}
            </div>
          )}

          {/* ── Interactive map with clickable pin ── */}
          {coords&&(
            <div style={{marginBottom:14}}>
              <div style={{fontSize:12,color:C.textMuted,marginBottom:6,display:"flex",alignItems:"center",gap:6}}>
                <span>🗺️</span> Click anywhere on the map to move the pin to the exact location
              </div>
              <div style={{borderRadius:12,overflow:"hidden",border:`1.5px solid ${C.blue}`,position:"relative"}}>
                <iframe
                  key={`${coords.lat}-${coords.lng}`}
                  title="map-picker"
                  width="100%"
                  height="220"
                  frameBorder="0"
                  style={{display:"block"}}
                  src={`https://www.openstreetmap.org/export/embed.html?bbox=${coords.lng-.008},${coords.lat-.008},${coords.lng+.008},${coords.lat+.008}&layer=mapnik&marker=${coords.lat},${coords.lng}`}
                />
                <div style={{padding:"8px 12px",background:"#EFF6FF",fontSize:12,color:"#1E40AF",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                  <span>📍 <strong>{coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}</strong></span>
                  <button onClick={()=>{
                    setCoords(null);
                    setSearchQuery("");
                    setSearchResults([]);
                  }} style={{background:"none",border:"none",color:"#DC2626",fontSize:12,cursor:"pointer",fontWeight:600}}>✕ Clear pin</button>
                </div>
              </div>
              {/* Nearby address suggestions */}
              <div style={{marginTop:10}}>
                <div style={{fontSize:12,fontWeight:600,color:C.textMuted,marginBottom:6}}>📋 Confirm or update the address:</div>
                <div style={{position:"relative"}}>
                  <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",fontSize:16}}>📍</span>
                  <input value={addr} onChange={e=>setAddr(e.target.value)} placeholder="Street address or landmark"
                    style={{width:"100%",padding:"11px 12px 11px 38px",borderRadius:10,border:`1.5px solid ${C.border}`,fontSize:14,boxSizing:"border-box",fontFamily:"inherit"}}/>
                </div>
              </div>
            </div>
          )}

          {/* ── No location yet ── */}
          {!coords&&locationMode==="gps"&&!geoLoading&&(
            <button onClick={()=>{
              setGeoLoading(true);
              navigator.geolocation?.getCurrentPosition(
                pos=>{
                  const c={lat:pos.coords.latitude,lng:pos.coords.longitude,accuracy:Math.round(pos.coords.accuracy)};
                  setCoords(c);
                  fetch(`https://nominatim.openstreetmap.org/reverse?lat=${c.lat}&lon=${c.lng}&format=json`)
                    .then(r=>r.json()).then(d=>{if(d.display_name)setAddr(d.display_name.split(",").slice(0,4).join(", ").trim());}).catch(()=>{});
                  setGeoLoading(false);
                },
                ()=>{setGeoError("GPS denied. Try searching for an address instead.");setGeoLoading(false);},
                {enableHighAccuracy:true,timeout:10000}
              );
            }} style={{width:"100%",padding:"12px",background:`linear-gradient(135deg,${C.blue},${C.teal})`,color:"#fff",border:"none",borderRadius:10,fontSize:14,fontWeight:600,cursor:"pointer",marginBottom:14}}>
              📡 Detect My Location
            </button>
          )}

          {/* ── Photo upload ── */}
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
            <button onClick={()=>setStep(4)} disabled={!coords} style={{flex:2,padding:11,background:coords?`linear-gradient(135deg,${C.blue},${C.teal})`:C.border,color:coords?"#fff":"#9CA3AF",border:"none",borderRadius:10,fontSize:14,fontWeight:600,cursor:coords?"pointer":"not-allowed"}}>Continue →</button>
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
   REPORTS PAGE COMPONENT
═══════════════════════════════════════════════════════════════════ */

// ── Tiny SVG donut chart ──────────────────────────────────────────
function DonutChart({ segments, size=140, thickness=28, label, sublabel }) {
  const r = (size - thickness) / 2;
  const circ = 2 * Math.PI * r;
  const cx = size / 2, cy = size / 2;
  let offset = 0;
  const total = segments.reduce((s, g) => s + g.value, 0) || 1;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {segments.map((seg, i) => {
        const dash = (seg.value / total) * circ;
        const gap  = circ - dash;
        const el = (
          <circle key={i} cx={cx} cy={cy} r={r}
            fill="none" stroke={seg.color} strokeWidth={thickness}
            strokeDasharray={`${dash} ${gap}`}
            strokeDashoffset={-offset * circ / total}
            style={{transition:"stroke-dasharray .6s ease"}}
          />
        );
        offset += seg.value;
        return el;
      })}
      {/* centre label */}
      {label && (
        <>
          <text x={cx} y={cy-4} textAnchor="middle" fontSize={22} fontWeight={800} fill="#0F172A">{label}</text>
          {sublabel && <text x={cx} y={cy+14} textAnchor="middle" fontSize={10} fill="#64748B">{sublabel}</text>}
        </>
      )}
    </svg>
  );
}

// ── Sparkline (mini line chart) ───────────────────────────────────
function Sparkline({ data, color="#1D4ED8", width=120, height=40 }) {
  if (!data || data.length < 2) return <div style={{width,height,background:"#F1F5F9",borderRadius:6}}/>
  const max = Math.max(...data, 1);
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - (v / max) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(" ");
  const area = `0,${height} ${pts} ${width},${height}`;
  return (
    <svg width={width} height={height} style={{display:"block"}}>
      <defs>
        <linearGradient id={`sg-${color.replace("#","")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3"/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#sg-${color.replace("#","")})`}/>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx={pts.split(" ").slice(-1)[0].split(",")[0]} cy={pts.split(" ").slice(-1)[0].split(",")[1]} r={3} fill={color}/>
    </svg>
  );
}

// ── Horizontal bar ────────────────────────────────────────────────
function HBar({ label, value, max, color, icon, pct }) {
  const w = max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 0;
  return (
    <div style={{marginBottom:12}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
        <span style={{fontSize:13,color:"#0F172A",display:"flex",alignItems:"center",gap:6}}>{icon} {label}</span>
        <span style={{fontSize:13,fontWeight:700,color}}>{value} <span style={{fontSize:11,color:"#94A3B8",fontWeight:400}}>({pct}%)</span></span>
      </div>
      <div style={{height:10,background:"#F1F5F9",borderRadius:5,overflow:"hidden"}}>
        <div style={{height:"100%",width:`${w}%`,background:color,borderRadius:5,transition:"width .6s ease"}}/>
      </div>
    </div>
  );
}

// ── KPI metric card ───────────────────────────────────────────────
function KpiCard({ icon, label, value, sub, color, spark }) {
  return (
    <div style={{background:"#fff",borderRadius:14,padding:"18px 16px",border:`1px solid #E2E8F0`,display:"flex",flexDirection:"column",gap:6,position:"relative",overflow:"hidden"}}>
      <div style={{position:"absolute",top:0,right:0,width:60,height:60,background:color+"12",borderRadius:"0 14px 0 60px"}}/>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <span style={{fontSize:22}}>{icon}</span>
        {spark && <Sparkline data={spark} color={color} width={70} height={28}/>}
      </div>
      <div style={{fontSize:28,fontWeight:800,color:"#0F172A",lineHeight:1}}>{value}</div>
      <div style={{fontSize:12,fontWeight:600,color:"#64748B"}}>{label}</div>
      {sub && <div style={{fontSize:11,color:color,fontWeight:600,marginTop:2}}>{sub}</div>}
    </div>
  );
}

// ── Print / PDF renderer ──────────────────────────────────────────
function printReport({ complaints, users, cats, statusList, priorityList, total, resolved, active, critical, high, escalated, resRate, trendData }) {
  const now = new Date().toLocaleDateString("en-ZA", { weekday:"long", year:"numeric", month:"long", day:"numeric" });
  const techCount  = users.filter(u => u.role === "Technician").length;
  const citizenCount = users.filter(u => u.role === "Citizen").length;

  // Build category rows
  const catRows = cats.map(c => `
    <tr>
      <td>${c.icon} ${c.label}</td>
      <td style="text-align:center;font-weight:700;color:${c.color}">${c.count}</td>
      <td style="text-align:center">${c.pct}%</td>
      <td style="padding:6px 10px">
        <div style="height:10px;background:#F1F5F9;border-radius:5px;overflow:hidden">
          <div style="height:100%;width:${c.pct}%;background:${c.color};border-radius:5px"></div>
        </div>
      </td>
    </tr>`).join("");

  // Build status rows
  const statusRows = statusList.map(s => `
    <tr>
      <td style="display:flex;align-items:center;gap:8px">
        <span style="width:10px;height:10px;border-radius:50%;background:${s.color};display:inline-block;flex-shrink:0"></span>
        ${s.s}
      </td>
      <td style="text-align:center;font-weight:700">${s.count}</td>
      <td style="text-align:center">${s.pct}%</td>
    </tr>`).join("");

  // Build priority rows
  const priorityRows = priorityList.map(p => `
    <tr>
      <td style="font-weight:600;color:${p.color}">${p.p}</td>
      <td style="text-align:center;font-weight:700;color:${p.color}">${p.count}</td>
      <td style="text-align:center">${p.pct}%</td>
    </tr>`).join("");

  // Build complaint table rows (last 20)
  const complaintRows = complaints.slice(0, 20).map(c => {
    const cat = CATEGORIES.find(k => k.id === c.category);
    const statusColor =
      c.status === "Resolved"    ? "#065F46" :
      c.status === "Escalated"   ? "#DC2626" :
      c.status === "In Progress" ? "#1E40AF" : "#64748B";
    const statusBg =
      c.status === "Resolved"    ? "#D1FAE5" :
      c.status === "Escalated"   ? "#FEE2E2" :
      c.status === "In Progress" ? "#DBEAFE" : "#F1F5F9";
    const priBg  = PRIORITIES[c.priority]?.bg  || "#F1F5F9";
    const priCol = PRIORITIES[c.priority]?.color || "#64748B";
    return `
      <tr>
        <td style="font-weight:700;color:#1D4ED8;white-space:nowrap">${c.ref_id || c.id || "—"}</td>
        <td>${cat?.icon || ""} ${cat?.label || c.category || "—"}</td>
        <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#475569;font-size:11px">${(c.description || "").slice(0, 60)}${(c.description || "").length > 60 ? "…" : ""}</td>
        <td style="font-size:11px;color:#64748B">${(c.address || "—").slice(0, 40)}</td>
        <td><span style="font-size:10px;padding:2px 8px;border-radius:12px;background:${statusBg};color:${statusColor};font-weight:600;white-space:nowrap">${c.status}</span></td>
        <td><span style="font-size:10px;padding:2px 8px;border-radius:12px;background:${priBg};color:${priCol};font-weight:600">${c.priority}</span></td>
        <td style="font-size:11px;color:#94A3B8;white-space:nowrap">${c.created_at?.slice(0, 10) || c.date || "—"}</td>
      </tr>`;
  }).join("");

  // Build monthly trend rows
  const trendRows = trendData ? [...trendData].reverse().slice(0, 12).map(m => `
    <tr>
      <td style="font-weight:600">${m.month || "—"}</td>
      <td style="text-align:center;font-weight:700;color:#1D4ED8">${m.total}</td>
      <td style="text-align:center;font-weight:700;color:#10B981">${m.resolved}</td>
      <td style="text-align:center;color:#F59E0B;font-weight:600">${parseInt(m.total) - parseInt(m.resolved)}</td>
      <td style="text-align:center">
        ${parseInt(m.total) > 0
          ? `<span style="font-weight:700;color:${Math.round(parseInt(m.resolved)/parseInt(m.total)*100) >= 70 ? "#059669" : "#F59E0B"}">${Math.round(parseInt(m.resolved)/parseInt(m.total)*100)}%</span>`
          : "—"}
      </td>
    </tr>`).join("") : "<tr><td colspan='5' style='text-align:center;color:#94A3B8'>No trend data available</td></tr>";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>Municipal Report — ${now}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; color: #0F172A; background: #fff; font-size: 13px; }

    /* ── Cover page ── */
    .cover {
      min-height: 100vh; display: flex; flex-direction: column;
      background: linear-gradient(145deg, #0B1F3A 0%, #1A3558 60%, #1E3A5F 100%);
      color: #fff; padding: 60px 80px; page-break-after: always;
    }
    .cover-logo { font-size: 56px; margin-bottom: 24px; }
    .cover-title { font-size: 36px; font-weight: 800; letter-spacing: -0.5px; margin-bottom: 8px; }
    .cover-sub { font-size: 18px; opacity: 0.7; margin-bottom: 48px; }
    .cover-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: auto; }
    .cover-meta-item { background: rgba(255,255,255,.1); border-radius: 12px; padding: 16px 20px; }
    .cover-meta-label { font-size: 11px; opacity: 0.6; text-transform: uppercase; letter-spacing: .5px; margin-bottom: 6px; }
    .cover-meta-value { font-size: 22px; font-weight: 800; }
    .cover-meta-desc  { font-size: 11px; opacity: 0.6; margin-top: 4px; }
    .cover-date { margin-top: 40px; font-size: 13px; opacity: 0.5; }

    /* ── Report pages ── */
    .page { padding: 40px 50px; page-break-after: always; }
    .page:last-child { page-break-after: auto; }

    .section-header {
      display: flex; align-items: center; gap: 12px;
      border-bottom: 3px solid #1D4ED8; padding-bottom: 12px; margin-bottom: 24px;
    }
    .section-icon { font-size: 24px; }
    .section-title { font-size: 18px; font-weight: 800; color: #0F172A; }
    .section-sub { font-size: 12px; color: #64748B; margin-top: 2px; }

    /* KPI grid */
    .kpi-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 32px; }
    .kpi-card {
      border-radius: 12px; padding: 18px 16px;
      border: 1px solid #E2E8F0; position: relative; overflow: hidden;
    }
    .kpi-card::after {
      content: ""; position: absolute; top: 0; right: 0;
      width: 50px; height: 50px; border-radius: 0 12px 0 50px;
    }
    .kpi-value { font-size: 32px; font-weight: 800; line-height: 1; margin-bottom: 6px; }
    .kpi-label { font-size: 12px; color: #64748B; font-weight: 600; }
    .kpi-sub   { font-size: 11px; margin-top: 4px; font-weight: 600; }

    /* Tables */
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th {
      background: #F8FAFC; padding: 10px 12px; text-align: left;
      font-weight: 700; color: #64748B; font-size: 11px;
      text-transform: uppercase; letter-spacing: .5px;
      border-bottom: 2px solid #E2E8F0;
    }
    td { padding: 9px 12px; border-bottom: 1px solid #F1F5F9; vertical-align: middle; }
    tr:last-child td { border-bottom: none; }
    tr:nth-child(even) td { background: #FAFAFA; }

    /* Two-col layout */
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 32px; }
    .card { border: 1px solid #E2E8F0; border-radius: 12px; padding: 20px; }
    .card-title { font-size: 12px; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: .5px; margin-bottom: 14px; }

    /* Resolution rate badge */
    .res-badge { display: inline-block; padding: 6px 16px; border-radius: 20px; font-size: 22px; font-weight: 800; }

    /* Footer */
    .footer {
      margin-top: 40px; padding-top: 16px; border-top: 1px solid #E2E8F0;
      display: flex; justify-content: space-between; font-size: 11px; color: #94A3B8;
    }

    @media print {
      @page { margin: 0; size: A4; }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>

<!-- ── PRINT BUTTON (hidden when printing) ── -->
<div class="no-print" style="position:fixed;top:20px;right:20px;z-index:999;display:flex;gap:10px">
  <button onclick="window.print()" style="padding:12px 24px;background:linear-gradient(135deg,#1D4ED8,#0EA5E9);color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 4px 16px rgba(29,78,216,.4)">
    🖨️ Print / Save as PDF
  </button>
  <button onclick="window.close()" style="padding:12px 20px;background:#F1F5F9;border:1px solid #E2E8F0;border-radius:10px;font-size:14px;cursor:pointer;font-weight:600">
    ✕ Close
  </button>
</div>

<!-- ══════════════════════════════════════════
     COVER PAGE
══════════════════════════════════════════ -->
<div class="cover">
  <div class="cover-logo">📊</div>
  <div class="cover-title">Municipal Complaint Report</div>
  <div class="cover-sub">Emalahleni Local Municipality — Smart Reporting System</div>

  <div class="cover-meta">
    <div class="cover-meta-item">
      <div class="cover-meta-label">Total Complaints</div>
      <div class="cover-meta-value">${total}</div>
      <div class="cover-meta-desc">Across all categories</div>
    </div>
    <div class="cover-meta-item">
      <div class="cover-meta-label">Resolution Rate</div>
      <div class="cover-meta-value">${resRate}%</div>
      <div class="cover-meta-desc">${resolved} of ${total} resolved</div>
    </div>
    <div class="cover-meta-item">
      <div class="cover-meta-label">Active Cases</div>
      <div class="cover-meta-value">${active}</div>
      <div class="cover-meta-desc">${escalated} escalated to council</div>
    </div>
    <div class="cover-meta-item">
      <div class="cover-meta-label">High + Critical</div>
      <div class="cover-meta-value">${critical + high}</div>
      <div class="cover-meta-desc">${critical} critical · ${high} high priority</div>
    </div>
    <div class="cover-meta-item">
      <div class="cover-meta-label">Registered Citizens</div>
      <div class="cover-meta-value">${citizenCount}</div>
      <div class="cover-meta-desc">Active system users</div>
    </div>
    <div class="cover-meta-item">
      <div class="cover-meta-label">Field Technicians</div>
      <div class="cover-meta-value">${techCount}</div>
      <div class="cover-meta-desc">Municipal workers</div>
    </div>
  </div>
  <div class="cover-date">Generated: ${now} · Emalahleni Ward 8 · Confidential</div>
</div>

<!-- ══════════════════════════════════════════
     PAGE 2 — KPI SUMMARY
══════════════════════════════════════════ -->
<div class="page">
  <div class="section-header">
    <span class="section-icon">📈</span>
    <div>
      <div class="section-title">Executive Summary — Key Performance Indicators</div>
      <div class="section-sub">Overall system performance at a glance</div>
    </div>
  </div>

  <div class="kpi-grid">
    <div class="kpi-card" style="border-left:4px solid #1D4ED8">
      <div class="kpi-value" style="color:#1D4ED8">${total}</div>
      <div class="kpi-label">Total Complaints Received</div>
      <div class="kpi-sub" style="color:#1D4ED8">All categories combined</div>
    </div>
    <div class="kpi-card" style="border-left:4px solid #10B981">
      <div class="kpi-value" style="color:#10B981">${resolved}</div>
      <div class="kpi-label">Successfully Resolved</div>
      <div class="kpi-sub" style="color:#10B981">${resRate}% resolution rate</div>
    </div>
    <div class="kpi-card" style="border-left:4px solid #F59E0B">
      <div class="kpi-value" style="color:#F59E0B">${active}</div>
      <div class="kpi-label">Currently Active Cases</div>
      <div class="kpi-sub" style="color:#F59E0B">${escalated} escalated to council</div>
    </div>
    <div class="kpi-card" style="border-left:4px solid #EF4444">
      <div class="kpi-value" style="color:#EF4444">${critical}</div>
      <div class="kpi-label">Critical Priority</div>
      <div class="kpi-sub" style="color:#EF4444">Requires immediate action</div>
    </div>
    <div class="kpi-card" style="border-left:4px solid #F97316">
      <div class="kpi-value" style="color:#F97316">${high}</div>
      <div class="kpi-label">High Priority</div>
      <div class="kpi-sub" style="color:#F97316">Urgent attention needed</div>
    </div>
    <div class="kpi-card" style="border-left:4px solid #8B5CF6">
      <div class="kpi-value" style="color:#8B5CF6">${escalated}</div>
      <div class="kpi-label">Council Escalations</div>
      <div class="kpi-sub" style="color:#8B5CF6">Sent to Councillor queue</div>
    </div>
  </div>

  <!-- Resolution rate visual -->
  <div class="card" style="margin-bottom:24px">
    <div class="card-title">Overall Resolution Rate</div>
    <div style="display:flex;align-items:center;gap:24px">
      <div>
        <span class="res-badge" style="background:${resRate>=70?"#D1FAE5":resRate>=40?"#FEF3C7":"#FEE2E2"};color:${resRate>=70?"#065F46":resRate>=40?"#92400E":"#DC2626"}">
          ${resRate}%
        </span>
      </div>
      <div style="flex:1">
        <div style="height:16px;background:#F1F5F9;border-radius:8px;overflow:hidden">
          <div style="height:100%;width:${resRate}%;background:${resRate>=70?"#10B981":resRate>=40?"#F59E0B":"#EF4444"};border-radius:8px;transition:width .6s"></div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:11px;color:#94A3B8">
          <span>0%</span><span>Target: 70%</span><span>100%</span>
        </div>
      </div>
      <div style="text-align:right">
        <div style="font-size:13px;color:#64748B">${resolved} resolved</div>
        <div style="font-size:13px;color:#64748B">${active} remaining</div>
      </div>
    </div>
  </div>

  <!-- Workforce -->
  <div class="card">
    <div class="card-title">Workforce Overview</div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px">
      ${[
        {label:"Citizens",value:citizenCount,color:"#1D4ED8",icon:"👤"},
        {label:"Technicians",value:techCount,color:"#10B981",icon:"👷"},
        {label:"Administrators",value:users.filter(u=>u.role==="Administrator").length,color:"#8B5CF6",icon:"⚙️"},
        {label:"Councillors",value:users.filter(u=>u.role==="Councillor").length,color:"#EF4444",icon:"⚖️"},
      ].map(r=>`
        <div style="text-align:center;padding:14px;background:#F8FAFC;border-radius:10px;border:1px solid #E2E8F0">
          <div style="font-size:24px;margin-bottom:6px">${r.icon}</div>
          <div style="font-size:22px;font-weight:800;color:${r.color}">${r.value}</div>
          <div style="font-size:11px;color:#64748B;margin-top:3px">${r.label}</div>
        </div>`).join("")}
    </div>
  </div>

  <div class="footer">
    <span>Emalahleni Local Municipality — Smart Reporting System</span>
    <span>Page 2</span>
    <span>${now}</span>
  </div>
</div>

<!-- ══════════════════════════════════════════
     PAGE 3 — CATEGORY & STATUS BREAKDOWN
══════════════════════════════════════════ -->
<div class="page">
  <div class="section-header">
    <span class="section-icon">📋</span>
    <div>
      <div class="section-title">Complaint Breakdown by Category & Status</div>
      <div class="section-sub">Distribution across service types and workflow stages</div>
    </div>
  </div>

  <div class="two-col">
    <div class="card">
      <div class="card-title">By Category</div>
      <table>
        <thead>
          <tr><th>Category</th><th style="text-align:center">Count</th><th style="text-align:center">Share</th><th>Distribution</th></tr>
        </thead>
        <tbody>${catRows}</tbody>
      </table>
    </div>
    <div>
      <div class="card" style="margin-bottom:20px">
        <div class="card-title">By Status</div>
        <table>
          <thead>
            <tr><th>Status</th><th style="text-align:center">Count</th><th style="text-align:center">Share</th></tr>
          </thead>
          <tbody>${statusRows}</tbody>
        </table>
      </div>
      <div class="card">
        <div class="card-title">By Priority</div>
        <table>
          <thead>
            <tr><th>Priority</th><th style="text-align:center">Count</th><th style="text-align:center">Share</th></tr>
          </thead>
          <tbody>${priorityRows}</tbody>
        </table>
      </div>
    </div>
  </div>

  <div class="footer">
    <span>Emalahleni Local Municipality — Smart Reporting System</span>
    <span>Page 3</span>
    <span>${now}</span>
  </div>
</div>

<!-- ══════════════════════════════════════════
     PAGE 4 — MONTHLY TREND
══════════════════════════════════════════ -->
<div class="page">
  <div class="section-header">
    <span class="section-icon">📅</span>
    <div>
      <div class="section-title">Monthly Trend Analysis</div>
      <div class="section-sub">Submissions vs resolutions over the past 12 months</div>
    </div>
  </div>

  <div class="card" style="margin-bottom:24px">
    <table>
      <thead>
        <tr>
          <th>Month</th>
          <th style="text-align:center">Submitted</th>
          <th style="text-align:center">Resolved</th>
          <th style="text-align:center">Outstanding</th>
          <th style="text-align:center">Res. Rate</th>
        </tr>
      </thead>
      <tbody>${trendRows}</tbody>
    </table>
  </div>

  <div class="footer">
    <span>Emalahleni Local Municipality — Smart Reporting System</span>
    <span>Page 4</span>
    <span>${now}</span>
  </div>
</div>

<!-- ══════════════════════════════════════════
     PAGE 5 — COMPLAINT REGISTER
══════════════════════════════════════════ -->
<div class="page">
  <div class="section-header">
    <span class="section-icon">🗂️</span>
    <div>
      <div class="section-title">Complaint Register (Latest 20)</div>
      <div class="section-sub">Most recent complaints across all categories</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Ref ID</th><th>Category</th><th>Description</th>
        <th>Address</th><th>Status</th><th>Priority</th><th>Date</th>
      </tr>
    </thead>
    <tbody>${complaintRows}</tbody>
  </table>
  ${complaints.length > 20 ? `<div style="margin-top:10px;font-size:11px;color:#94A3B8;text-align:center">Showing 20 of ${complaints.length} complaints. Export CSV for full register.</div>` : ""}

  <div class="footer">
    <span>Emalahleni Local Municipality — Smart Reporting System</span>
    <span>Page 5</span>
    <span>${now}</span>
  </div>
</div>

</body>
</html>`;

  const win = window.open("", "_blank");
  if (!win) {
    alert("Pop-up blocked — please allow pop-ups for this site and try again.");
    return;
  }
  win.document.write(html);
  win.document.close();
}


/* ─── Shared export helpers ──────────────────────────────────────── */
function exportCSV(filename, headers, rows) {
  const csv = [headers.join(","), ...rows.map(r => r.map(v => `"${String(v??'').replace(/"/g,'""')}"`).join(","))].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type:"text/csv" }));
  a.download = filename; a.click();
}
function exportPDFTable(title, headers, rows) {
  const win = window.open("","_blank","width=900,height=700");
  if(!win) return;
  win.document.write(`<!DOCTYPE html><html><head><title>${title}</title>
  <style>body{font-family:'Segoe UI',sans-serif;padding:30px;color:#0F172A}
  h1{font-size:22px;margin-bottom:4px}p{font-size:13px;color:#64748B;margin:0 0 20px}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th{background:#1D4ED8;color:#fff;padding:9px 12px;text-align:left;font-weight:700}
  td{padding:8px 12px;border-bottom:1px solid #E2E8F0}
  tr:nth-child(even){background:#F8FAFC}
  .btn{background:#1D4ED8;color:#fff;border:none;padding:10px 22px;border-radius:8px;font-size:14px;cursor:pointer;margin-bottom:20px}
  @media print{.btn{display:none}}
  </style></head><body>
  <button class="btn" onclick="window.print()">🖨️ Print / Save as PDF</button>
  <h1>${title}</h1><p>Generated: ${new Date().toLocaleString("en-ZA")} — Emalahleni Local Municipality</p>
  <table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join("")}</tr></thead>
  <tbody>${rows.map(r=>`<tr>${r.map(v=>`<td>${v??""}</td>`).join("")}</tr>`).join("")}</tbody>
  </table></body></html>`);
  win.document.close();
}

/* ═══════════════════════════════════════════════════════════════════
   REPORT 1 — TECHNICIAN PERFORMANCE REPORT
   Tables used: complaints + assignments + users
   Filters: date range (default: start of current month), category, status
   User-filter: if logged in as Technician → only their jobs
═══════════════════════════════════════════════════════════════════ */
function TechnicianPerformanceReport({ token, currentUser, notify }) {
  const today    = new Date();
  const defStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0,10);
  const defEnd   = today.toISOString().slice(0,10);

  const [data,    setData]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom,setDateFrom]= useState(defStart);
  const [dateTo,  setDateTo]  = useState(defEnd);
  const [filterCat,  setFilterCat]  = useState("all");
  const [filterStatus,setFilterStatus] = useState("all");

  const isTech = currentUser?.role === "Technician";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [aRes, cRes] = await Promise.all([
        fetch(`${API}/api/assignments`, { headers:{ Authorization:`Bearer ${token}` } }),
        fetch(`${API}/api/complaints`,  { headers:{ Authorization:`Bearer ${token}` } }),
      ]);
      const [aData, cData] = await Promise.all([aRes.json(), cRes.json()]);
      const complaints = cData.success ? cData.complaints : [];
      const assignments = aData.success ? aData.assignments : [];

      // Join assignments ← complaints (multi-table)
      const joined = assignments.map(a => {
        const c = complaints.find(x => x.id === a.complaint_id || x.ref_id === a.ref_id) || {};
        return {
          ...a,
          category:    a.category    || c.category    || "—",
          description: a.description || c.description || "—",
          address:     a.address     || c.address     || "—",
          created_at:  c.created_at  || a.created_at  || "",
          citizen_name:c.citizen_name|| "—",
        };
      });
      setData(joined);
    } catch(e) { console.error(e); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  // Apply filters
  const filtered = data.filter(row => {
    const dt = (row.created_at||row.task_start_date||"").slice(0,10);
    if (dateFrom && dt < dateFrom) return false;
    if (dateTo   && dt > dateTo)   return false;
    if (filterCat    !== "all" && row.category !== filterCat)  return false;
    if (filterStatus !== "all" && row.status   !== filterStatus) return false;
    return true;
  });

  const total    = filtered.length;
  const resolved = filtered.filter(r => r.status === "Resolved").length;
  const inProg   = filtered.filter(r => r.status === "In Progress").length;
  const assigned = filtered.filter(r => r.status === "Assigned").length;
  const resRate  = total ? Math.round(resolved/total*100) : 0;

  const csvHeaders = ["Assignment ID","Ref ID","Technician","Category","Status","Priority","Address","Task Start","Task End","Description"];
  const csvRows    = filtered.map(r => [
    r.assignment_id||r.id, r.ref_id, r.technician_name||currentUser?.full_name||"—",
    r.category, r.status, r.priority, r.address,
    r.task_start_date||"—", r.task_end_date||"—", r.description?.slice(0,80),
  ]);

  const filterBar = {display:"flex",gap:10,flexWrap:"wrap",alignItems:"flex-end",background:"#fff",borderRadius:14,padding:"16px 20px",border:"1px solid #E2E8F0",marginBottom:18};
  const labelSt   = {fontSize:11,fontWeight:700,color:"#64748B",textTransform:"uppercase",letterSpacing:".4px",display:"block",marginBottom:5};
  const inputSt   = {borderRadius:8,border:"1.5px solid #E2E8F0",padding:"8px 10px",fontSize:13,background:"#F8FAFC",cursor:"pointer"};

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18,flexWrap:"wrap",gap:10}}>
        <div>
          <h2 style={{margin:0,fontSize:20,color:"#0F172A",fontWeight:800}}>📋 Technician Performance Report</h2>
          <p style={{margin:"4px 0 0",fontSize:13,color:"#64748B"}}>
            {isTech ? `Showing your assigned jobs · ` : "All technician assignments · "}
            Multi-table: complaints + assignments + users
          </p>
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={() => exportCSV(`tech-report-${defEnd}.csv`, csvHeaders, csvRows)}
            style={{padding:"9px 16px",background:"#F0FDF4",color:"#166534",border:"1.5px solid #BBF7D0",borderRadius:9,fontSize:13,fontWeight:700,cursor:"pointer"}}>
            ⬇️ Export CSV
          </button>
          <button onClick={() => exportPDFTable("Technician Performance Report", csvHeaders, csvRows)}
            style={{padding:"9px 16px",background:"#FFF7ED",color:"#92400E",border:"1.5px solid #FED7AA",borderRadius:9,fontSize:13,fontWeight:700,cursor:"pointer"}}>
            🖨️ Print / PDF
          </button>
        </div>
      </div>

      {/* ── Filters ── */}
      <div style={filterBar}>
        <div>
          <label style={labelSt}>📅 Date From</label>
          <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} style={inputSt}/>
        </div>
        <div>
          <label style={labelSt}>📅 Date To</label>
          <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)} style={inputSt}/>
        </div>
        <div>
          <label style={labelSt}>🏷️ Category</label>
          <select value={filterCat} onChange={e=>setFilterCat(e.target.value)} style={inputSt}>
            <option value="all">All Categories</option>
            {CATEGORIES.map(c=><option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
          </select>
        </div>
        <div>
          <label style={labelSt}>⚙️ Status</label>
          <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} style={inputSt}>
            <option value="all">All Statuses</option>
            {["Assigned","In Progress","Resolved"].map(s=><option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <button onClick={()=>{setDateFrom(defStart);setDateTo(defEnd);setFilterCat("all");setFilterStatus("all");}}
          style={{padding:"8px 14px",background:"#F1F5F9",border:"1.5px solid #E2E8F0",borderRadius:8,fontSize:12,cursor:"pointer",fontWeight:600,marginTop:18}}>
          Reset Filters
        </button>
        <span style={{fontSize:12,color:"#94A3B8",marginTop:18,marginLeft:"auto"}}>{filtered.length} record{filtered.length!==1?"s":""}</span>
      </div>

      {isTech && (
        <div style={{background:"#EFF6FF",border:"1px solid #BFDBFE",borderRadius:10,padding:"10px 16px",marginBottom:16,fontSize:13,color:"#1E40AF",fontWeight:600}}>
          👷 Showing jobs assigned to you: <strong>{currentUser?.full_name}</strong>
        </div>
      )}

      {/* KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:12,marginBottom:18}}>
        {[["📋","Total Jobs",total,"#1D4ED8"],["✅","Resolved",resolved,"#10B981"],["🔧","In Progress",inProg,"#F59E0B"],["📬","Assigned",assigned,"#8B5CF6"],["📊","Resolution Rate",resRate+"%","#059669"]].map(([icon,label,val,color])=>(
          <div key={label} style={{background:"#fff",borderRadius:12,padding:"14px 16px",border:"1px solid #E2E8F0",textAlign:"center"}}>
            <div style={{fontSize:20,marginBottom:4}}>{icon}</div>
            <div style={{fontSize:22,fontWeight:800,color}}>{val}</div>
            <div style={{fontSize:11,color:"#64748B"}}>{label}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div style={{background:"#fff",borderRadius:14,border:"1px solid #E2E8F0",overflowX:"auto"}}>
        {loading ? <div style={{padding:40,textAlign:"center",color:"#94A3B8"}}>Loading…</div> : (
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
          <thead>
            <tr style={{background:"#F8FAFC"}}>
              {["Ref ID","Technician","Category","Status","Priority","Task Period","Address"].map(h=>(
                <th key={h} style={{padding:"10px 14px",textAlign:"left",fontWeight:700,color:"#64748B",fontSize:11,textTransform:"uppercase",letterSpacing:".4px",borderBottom:"1px solid #E2E8F0",whiteSpace:"nowrap"}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length===0 ? (
              <tr><td colSpan={7} style={{textAlign:"center",padding:50,color:"#94A3B8"}}>No records match the selected filters</td></tr>
            ) : filtered.map((r,i)=>{
              const cat = CATEGORIES.find(c=>c.id===r.category);
              return (
                <tr key={r.assignment_id||r.id||i} style={{borderBottom:"1px solid #F1F5F9",background:i%2===0?"#fff":"#FAFAFA"}}>
                  <td style={{padding:"10px 14px",fontWeight:700,color:"#1D4ED8"}}>{r.ref_id||"—"}</td>
                  <td style={{padding:"10px 14px",color:"#374151"}}>{r.technician_name||currentUser?.full_name||"—"}</td>
                  <td style={{padding:"10px 14px"}}><span style={{fontSize:12}}>{cat?.icon} {cat?.label||r.category}</span></td>
                  <td style={{padding:"10px 14px"}}><span style={{padding:"3px 9px",borderRadius:20,fontSize:11,fontWeight:600,background:r.status==="Resolved"?"#D1FAE5":r.status==="In Progress"?"#DBEAFE":"#FEF3C7",color:r.status==="Resolved"?"#065F46":r.status==="In Progress"?"#1E40AF":"#92400E"}}>{r.status}</span></td>
                  <td style={{padding:"10px 14px"}}><span style={{fontSize:11,fontWeight:700,color:r.priority==="Critical"?"#DC2626":r.priority==="High"?"#EA580C":r.priority==="Medium"?"#D97706":"#16A34A"}}>{r.priority}</span></td>
                  <td style={{padding:"10px 14px",fontSize:12,color:"#64748B",whiteSpace:"nowrap"}}>{r.task_start_date||"—"} → {r.task_end_date||"—"}</td>
                  <td style={{padding:"10px 14px",color:"#374151",maxWidth:180,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.address||"—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   REPORT 2 — CITIZEN COMPLAINTS HISTORY REPORT
   Tables used: complaints + users (citizen name, role joined)
   Filters: date range (default: start of current month), status, category, priority
   User-filter: Citizens see only their own complaints
═══════════════════════════════════════════════════════════════════ */
function CitizenComplaintsReport({ token, currentUser, notify }) {
  const today    = new Date();
  const defStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0,10);
  const defEnd   = today.toISOString().slice(0,10);

  const [complaints, setComplaints] = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [dateFrom, setDateFrom] = useState(defStart);
  const [dateTo,   setDateTo]   = useState(defEnd);
  const [filterCat,    setFilterCat]    = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterPri,    setFilterPri]    = useState("all");

  const isCitizen = currentUser?.role === "Citizen";

  useEffect(() => {
    fetch(`${API}/api/complaints`, { headers:{ Authorization:`Bearer ${token}` } })
      .then(r=>r.json()).then(d=>{ if(d.success) setComplaints(d.complaints); })
      .catch(()=>{}).finally(()=>setLoading(false));
  }, [token]);

  const filtered = complaints.filter(c => {
    const dt = (c.created_at||"").slice(0,10);
    if (dateFrom && dt < dateFrom) return false;
    if (dateTo   && dt > dateTo)   return false;
    if (filterCat    !== "all" && c.category !== filterCat)   return false;
    if (filterStatus !== "all" && c.status   !== filterStatus) return false;
    if (filterPri    !== "all" && c.priority !== filterPri)    return false;
    return true;
  });

  const total    = filtered.length;
  const resolved = filtered.filter(c=>c.status==="Resolved").length;
  const active   = filtered.filter(c=>c.status!=="Resolved").length;
  const avgRating= (() => {
    const rated = filtered.filter(c=>c.rating>0);
    if(!rated.length) return "N/A";
    return (rated.reduce((s,c)=>s+(parseFloat(c.rating)||0),0)/rated.length).toFixed(1)+"★";
  })();

  const csvHeaders = ["Ref ID","Citizen","Category","Status","Priority","Submitted Date","Address","Rating","Description"];
  const csvRows    = filtered.map(c=>[
    c.ref_id, c.citizen_name||"—", c.category, c.status, c.priority,
    c.created_at?.slice(0,10)||"—", c.address||"—", c.rating||"—", c.description?.slice(0,80),
  ]);

  const filterBar = {display:"flex",gap:10,flexWrap:"wrap",alignItems:"flex-end",background:"#fff",borderRadius:14,padding:"16px 20px",border:"1px solid #E2E8F0",marginBottom:18};
  const labelSt   = {fontSize:11,fontWeight:700,color:"#64748B",textTransform:"uppercase",letterSpacing:".4px",display:"block",marginBottom:5};
  const inputSt   = {borderRadius:8,border:"1.5px solid #E2E8F0",padding:"8px 10px",fontSize:13,background:"#F8FAFC",cursor:"pointer"};

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18,flexWrap:"wrap",gap:10}}>
        <div>
          <h2 style={{margin:0,fontSize:20,color:"#0F172A",fontWeight:800}}>👤 Citizen Complaints History Report</h2>
          <p style={{margin:"4px 0 0",fontSize:13,color:"#64748B"}}>
            {isCitizen ? "Your complaint history · " : "All citizen complaints · "}
            Multi-table: complaints joined with users
          </p>
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={()=>exportCSV(`citizen-complaints-${defEnd}.csv`,csvHeaders,csvRows)}
            style={{padding:"9px 16px",background:"#F0FDF4",color:"#166534",border:"1.5px solid #BBF7D0",borderRadius:9,fontSize:13,fontWeight:700,cursor:"pointer"}}>
            ⬇️ Export CSV
          </button>
          <button onClick={()=>exportPDFTable("Citizen Complaints History Report",csvHeaders,csvRows)}
            style={{padding:"9px 16px",background:"#FFF7ED",color:"#92400E",border:"1.5px solid #FED7AA",borderRadius:9,fontSize:13,fontWeight:700,cursor:"pointer"}}>
            🖨️ Print / PDF
          </button>
        </div>
      </div>

      {/* ── Filters ── */}
      <div style={filterBar}>
        <div>
          <label style={labelSt}>📅 Date From</label>
          <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} style={inputSt}/>
        </div>
        <div>
          <label style={labelSt}>📅 Date To</label>
          <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)} style={inputSt}/>
        </div>
        <div>
          <label style={labelSt}>🏷️ Category</label>
          <select value={filterCat} onChange={e=>setFilterCat(e.target.value)} style={inputSt}>
            <option value="all">All Categories</option>
            {CATEGORIES.map(c=><option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
          </select>
        </div>
        <div>
          <label style={labelSt}>⚙️ Status</label>
          <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} style={inputSt}>
            <option value="all">All Statuses</option>
            {ALL_STATUSES.map(s=><option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label style={labelSt}>🔴 Priority</label>
          <select value={filterPri} onChange={e=>setFilterPri(e.target.value)} style={inputSt}>
            <option value="all">All Priorities</option>
            {Object.keys(PRIORITIES).map(p=><option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <button onClick={()=>{setDateFrom(defStart);setDateTo(defEnd);setFilterCat("all");setFilterStatus("all");setFilterPri("all");}}
          style={{padding:"8px 14px",background:"#F1F5F9",border:"1.5px solid #E2E8F0",borderRadius:8,fontSize:12,cursor:"pointer",fontWeight:600,marginTop:18}}>
          Reset
        </button>
        <span style={{fontSize:12,color:"#94A3B8",marginTop:18,marginLeft:"auto"}}>{filtered.length} record{filtered.length!==1?"s":""}</span>
      </div>

      {isCitizen && (
        <div style={{background:"#EFF6FF",border:"1px solid #BFDBFE",borderRadius:10,padding:"10px 16px",marginBottom:16,fontSize:13,color:"#1E40AF",fontWeight:600}}>
          👤 Filtered to your complaints: <strong>{currentUser?.full_name}</strong>
        </div>
      )}

      {/* KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:12,marginBottom:18}}>
        {[["📋","Total",total,"#1D4ED8"],["✅","Resolved",resolved,"#10B981"],["⏳","Active",active,"#F59E0B"],["⭐","Avg Rating",avgRating,"#F59E0B"]].map(([icon,label,val,color])=>(
          <div key={label} style={{background:"#fff",borderRadius:12,padding:"14px 16px",border:"1px solid #E2E8F0",textAlign:"center"}}>
            <div style={{fontSize:20,marginBottom:4}}>{icon}</div>
            <div style={{fontSize:22,fontWeight:800,color}}>{val}</div>
            <div style={{fontSize:11,color:"#64748B"}}>{label}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div style={{background:"#fff",borderRadius:14,border:"1px solid #E2E8F0",overflowX:"auto"}}>
        {loading ? <div style={{padding:40,textAlign:"center",color:"#94A3B8"}}>Loading…</div> : (
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
          <thead>
            <tr style={{background:"#F8FAFC"}}>
              {["Ref ID","Citizen","Category","Status","Priority","Date Submitted","Rating","Address"].map(h=>(
                <th key={h} style={{padding:"10px 14px",textAlign:"left",fontWeight:700,color:"#64748B",fontSize:11,textTransform:"uppercase",letterSpacing:".4px",borderBottom:"1px solid #E2E8F0",whiteSpace:"nowrap"}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length===0 ? (
              <tr><td colSpan={8} style={{textAlign:"center",padding:50,color:"#94A3B8"}}>No records match the selected filters</td></tr>
            ) : filtered.map((c,i)=>{
              const cat = CATEGORIES.find(x=>x.id===c.category);
              return (
                <tr key={c.id||i} style={{borderBottom:"1px solid #F1F5F9",background:i%2===0?"#fff":"#FAFAFA"}}>
                  <td style={{padding:"10px 14px",fontWeight:700,color:"#1D4ED8"}}>{c.ref_id}</td>
                  <td style={{padding:"10px 14px",color:"#374151"}}>{c.citizen_name||"—"}</td>
                  <td style={{padding:"10px 14px"}}><span style={{fontSize:12}}>{cat?.icon} {cat?.label||c.category}</span></td>
                  <td style={{padding:"10px 14px"}}><span style={{padding:"3px 9px",borderRadius:20,fontSize:11,fontWeight:600,background:c.status==="Resolved"?"#D1FAE5":c.status==="In Progress"?"#DBEAFE":c.status==="Escalated"?"#FEE2E2":"#FEF3C7",color:c.status==="Resolved"?"#065F46":c.status==="In Progress"?"#1E40AF":c.status==="Escalated"?"#DC2626":"#92400E"}}>{c.status}</span></td>
                  <td style={{padding:"10px 14px"}}><span style={{fontSize:11,fontWeight:700,color:c.priority==="Critical"?"#DC2626":c.priority==="High"?"#EA580C":c.priority==="Medium"?"#D97706":"#16A34A"}}>{c.priority}</span></td>
                  <td style={{padding:"10px 14px",fontSize:12,color:"#64748B",whiteSpace:"nowrap"}}>{c.created_at?.slice(0,10)||"—"}</td>
                  <td style={{padding:"10px 14px",textAlign:"center"}}>{c.rating ? <span style={{color:"#F59E0B",fontWeight:700}}>{c.rating}★</span> : <span style={{color:"#CBD5E1"}}>—</span>}</td>
                  <td style={{padding:"10px 14px",color:"#374151",maxWidth:160,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.address||"—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   REPORT 3 — COUNCIL ESCALATION AUDIT REPORT
   Tables used: escalations + complaints + decisions (via escalations)
   Filters: date range (default: start of current month), decision status, priority
   User-filter: Councillors see their ward's cases
═══════════════════════════════════════════════════════════════════ */
function CouncilEscalationReport({ token, currentUser, notify }) {
  const today    = new Date();
  const defStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0,10);
  const defEnd   = today.toISOString().slice(0,10);

  const [escalations, setEscalations] = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [dateFrom, setDateFrom] = useState(defStart);
  const [dateTo,   setDateTo]   = useState(defEnd);
  const [filterDecision, setFilterDecision] = useState("all");
  const [filterPri,      setFilterPri]      = useState("all");
  const [filterCat,      setFilterCat]      = useState("all");

  const isCouncillor = currentUser?.role === "Councillor";

  useEffect(() => {
    fetch(`${API}/api/escalations`, { headers:{ Authorization:`Bearer ${token}` } })
      .then(r=>r.json()).then(d=>{ if(d.success) setEscalations(d.escalations); })
      .catch(()=>{}).finally(()=>setLoading(false));
  }, [token]);

  const filtered = escalations.filter(e => {
    const dt = (e.escalated_at||e.created_at||"").slice(0,10);
    if (dateFrom && dt < dateFrom) return false;
    if (dateTo   && dt > dateTo)   return false;
    if (filterDecision !== "all") {
      if (filterDecision === "Pending" && e.decision !== "Pending") return false;
      if (filterDecision === "Decided" && e.decision === "Pending") return false;
    }
    if (filterPri !== "all" && e.priority !== filterPri)   return false;
    if (filterCat !== "all" && e.category !== filterCat)   return false;
    return true;
  });

  const total    = filtered.length;
  const pending  = filtered.filter(e=>e.decision==="Pending").length;
  const decided  = filtered.filter(e=>e.decision!=="Pending").length;
  const critical = filtered.filter(e=>e.priority==="Critical").length;

  const csvHeaders = ["Escalation ID","Ref ID","Category","Priority","Citizen","Escalated Date","Decision","Decision Date","Decision Notes"];
  const csvRows    = filtered.map(e=>[
    e.escalation_id, e.ref_id, e.category, e.priority,
    e.citizen_name||"—", e.escalated_at?.slice(0,10)||"—",
    e.decision||"Pending", e.decided_at?.slice(0,10)||"—",
    e.decision_notes||"—",
  ]);

  const filterBar = {display:"flex",gap:10,flexWrap:"wrap",alignItems:"flex-end",background:"#fff",borderRadius:14,padding:"16px 20px",border:"1px solid #E2E8F0",marginBottom:18};
  const labelSt   = {fontSize:11,fontWeight:700,color:"#64748B",textTransform:"uppercase",letterSpacing:".4px",display:"block",marginBottom:5};
  const inputSt   = {borderRadius:8,border:"1.5px solid #E2E8F0",padding:"8px 10px",fontSize:13,background:"#F8FAFC",cursor:"pointer"};

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18,flexWrap:"wrap",gap:10}}>
        <div>
          <h2 style={{margin:0,fontSize:20,color:"#0F172A",fontWeight:800}}>⚖️ Council Escalation Audit Report</h2>
          <p style={{margin:"4px 0 0",fontSize:13,color:"#64748B"}}>
            {isCouncillor ? "Your escalation cases · " : "All council escalations · "}
            Multi-table: escalations + complaints + council decisions
          </p>
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={()=>exportCSV(`council-escalations-${defEnd}.csv`,csvHeaders,csvRows)}
            style={{padding:"9px 16px",background:"#F0FDF4",color:"#166534",border:"1.5px solid #BBF7D0",borderRadius:9,fontSize:13,fontWeight:700,cursor:"pointer"}}>
            ⬇️ Export CSV
          </button>
          <button onClick={()=>exportPDFTable("Council Escalation Audit Report",csvHeaders,csvRows)}
            style={{padding:"9px 16px",background:"#FFF7ED",color:"#92400E",border:"1.5px solid #FED7AA",borderRadius:9,fontSize:13,fontWeight:700,cursor:"pointer"}}>
            🖨️ Print / PDF
          </button>
        </div>
      </div>

      {/* ── Filters ── */}
      <div style={filterBar}>
        <div>
          <label style={labelSt}>📅 Escalated From <span style={{color:"#94A3B8",fontSize:10}}>(default: month start)</span></label>
          <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} style={inputSt}/>
        </div>
        <div>
          <label style={labelSt}>📅 Escalated To</label>
          <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)} style={inputSt}/>
        </div>
        <div>
          <label style={labelSt}>✅ Decision Status</label>
          <select value={filterDecision} onChange={e=>setFilterDecision(e.target.value)} style={inputSt}>
            <option value="all">All Cases</option>
            <option value="Pending">Pending Only</option>
            <option value="Decided">Decided Only</option>
          </select>
        </div>
        <div>
          <label style={labelSt}>🔴 Priority</label>
          <select value={filterPri} onChange={e=>setFilterPri(e.target.value)} style={inputSt}>
            <option value="all">All Priorities</option>
            {Object.keys(PRIORITIES).map(p=><option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label style={labelSt}>🏷️ Category</label>
          <select value={filterCat} onChange={e=>setFilterCat(e.target.value)} style={inputSt}>
            <option value="all">All Categories</option>
            {CATEGORIES.map(c=><option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
          </select>
        </div>
        <button onClick={()=>{setDateFrom(defStart);setDateTo(defEnd);setFilterDecision("all");setFilterPri("all");setFilterCat("all");}}
          style={{padding:"8px 14px",background:"#F1F5F9",border:"1.5px solid #E2E8F0",borderRadius:8,fontSize:12,cursor:"pointer",fontWeight:600,marginTop:18}}>
          Reset
        </button>
        <span style={{fontSize:12,color:"#94A3B8",marginTop:18,marginLeft:"auto"}}>{filtered.length} record{filtered.length!==1?"s":""}</span>
      </div>

      {isCouncillor && (
        <div style={{background:"#EDE9FE",border:"1px solid #C4B5FD",borderRadius:10,padding:"10px 16px",marginBottom:16,fontSize:13,color:"#5B21B6",fontWeight:600}}>
          ⚖️ Showing escalations for Councillor: <strong>{currentUser?.full_name}</strong>
        </div>
      )}

      {/* KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:12,marginBottom:18}}>
        {[["🚨","Total Escalated",total,"#7C3AED"],["⏳","Pending",pending,"#EF4444"],["✅","Decided",decided,"#10B981"],["🔴","Critical",critical,"#DC2626"]].map(([icon,label,val,color])=>(
          <div key={label} style={{background:"#fff",borderRadius:12,padding:"14px 16px",border:"1px solid #E2E8F0",textAlign:"center"}}>
            <div style={{fontSize:20,marginBottom:4}}>{icon}</div>
            <div style={{fontSize:22,fontWeight:800,color}}>{val}</div>
            <div style={{fontSize:11,color:"#64748B"}}>{label}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div style={{background:"#fff",borderRadius:14,border:"1px solid #E2E8F0",overflowX:"auto"}}>
        {loading ? <div style={{padding:40,textAlign:"center",color:"#94A3B8"}}>Loading…</div> : (
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
          <thead>
            <tr style={{background:"#F8FAFC"}}>
              {["Ref ID","Category","Priority","Citizen","Escalated","Decision","Decided On","Notes"].map(h=>(
                <th key={h} style={{padding:"10px 14px",textAlign:"left",fontWeight:700,color:"#64748B",fontSize:11,textTransform:"uppercase",letterSpacing:".4px",borderBottom:"1px solid #E2E8F0",whiteSpace:"nowrap"}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length===0 ? (
              <tr><td colSpan={8} style={{textAlign:"center",padding:50,color:"#94A3B8"}}>No escalation records match the selected filters</td></tr>
            ) : filtered.map((e,i)=>{
              const cat = CATEGORIES.find(x=>x.id===e.category);
              const isPending = e.decision==="Pending";
              return (
                <tr key={e.escalation_id||i} style={{borderBottom:"1px solid #F1F5F9",background:i%2===0?"#fff":"#FAFAFA"}}>
                  <td style={{padding:"10px 14px",fontWeight:700,color:"#7C3AED"}}>{e.ref_id||"—"}</td>
                  <td style={{padding:"10px 14px"}}><span style={{fontSize:12}}>{cat?.icon} {cat?.label||e.category}</span></td>
                  <td style={{padding:"10px 14px"}}><span style={{fontSize:11,fontWeight:700,color:e.priority==="Critical"?"#DC2626":e.priority==="High"?"#EA580C":"#D97706"}}>{e.priority}</span></td>
                  <td style={{padding:"10px 14px",color:"#374151"}}>{e.citizen_name||"—"}</td>
                  <td style={{padding:"10px 14px",fontSize:12,color:"#64748B",whiteSpace:"nowrap"}}>{e.escalated_at?.slice(0,10)||"—"}</td>
                  <td style={{padding:"10px 14px"}}><span style={{padding:"3px 9px",borderRadius:20,fontSize:11,fontWeight:600,background:isPending?"#FEE2E2":"#D1FAE5",color:isPending?"#DC2626":"#065F46"}}>{isPending?"⏳ Pending":`✅ ${e.decision}`}</span></td>
                  <td style={{padding:"10px 14px",fontSize:12,color:"#64748B",whiteSpace:"nowrap"}}>{e.decided_at?.slice(0,10)||"—"}</td>
                  <td style={{padding:"10px 14px",fontSize:12,color:"#374151",maxWidth:160,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{e.decision_notes||"—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        )}
      </div>
    </div>
  );
}

/* ─── Reports Hub — wraps all 4 reports with tabs ─────────────────── */
function ReportsHub({ complaints, users, token, currentUser, notify }) {
  const [activeReport, setActiveReport] = useState("summary");
  const tabs = [
    ["summary",    "📊 Summary Report"],
    ["tech",       "📋 Technician Performance"],
    ["citizen",    "👤 Citizen Complaints"],
    ["escalation", "⚖️ Council Escalations"],
  ];
  return (
    <div>
      {/* Report Tab Selector */}
      <div style={{display:"flex",gap:8,marginBottom:22,flexWrap:"wrap"}}>
        {tabs.map(([key,label])=>(
          <button key={key} onClick={()=>setActiveReport(key)}
            style={{padding:"9px 18px",borderRadius:10,border:"none",fontSize:13,fontWeight:700,cursor:"pointer",transition:"all .2s",
              background:activeReport===key?"linear-gradient(135deg,#1D4ED8,#0EA5E9)":"#fff",
              color:activeReport===key?"#fff":"#475569",
              boxShadow:activeReport===key?"0 4px 12px #1D4ED840":"none",
              border:activeReport===key?"none":"1.5px solid #E2E8F0"}}>
            {label}
          </button>
        ))}
      </div>
      {activeReport==="summary"    && <ReportsPage complaints={complaints} users={users} token={token} notify={notify}/>}
      {activeReport==="tech"       && <TechnicianPerformanceReport token={token} currentUser={currentUser} notify={notify}/>}
      {activeReport==="citizen"    && <CitizenComplaintsReport token={token} currentUser={currentUser} notify={notify}/>}
      {activeReport==="escalation" && <CouncilEscalationReport token={token} currentUser={currentUser} notify={notify}/>}
    </div>
  );
}

function ReportsPage({ complaints, users, token, notify }) {
  const [trendData, setTrendData]       = useState(null);
  const [savedReports, setSavedReports] = useState([]);
  const [saving, setSaving]             = useState(false);
  const [activeChart, setActiveChart]   = useState("category"); // category | status | priority
  const [reportName, setReportName]     = useState("");
  const [showSaveModal, setShowSaveModal] = useState(false);

  // ── Load trend & saved reports ──────────────────────────────────
  useEffect(() => {
    fetch(`${API}/api/analytics/trend`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => { if (d.success) setTrendData(d.monthly); })
      .catch(() => {});
    fetch(`${API}/api/analytics/reports`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => { if (d.success) setSavedReports(d.reports || []); })
      .catch(() => {});
  }, [token]);

  // ── Derived stats ───────────────────────────────────────────────
  const total      = complaints.length || 1;
  const resolved   = complaints.filter(c => c.status === "Resolved").length;
  const active     = complaints.filter(c => c.status !== "Resolved").length;
  const critical   = complaints.filter(c => c.priority === "Critical").length;
  const high       = complaints.filter(c => c.priority === "High").length;
  const escalated  = complaints.filter(c => c.status === "Escalated").length;
  const resRate    = Math.round((resolved / total) * 100);
  const technicians = users.filter(u => u.role === "Technician").length;
  const citizens    = users.filter(u => u.role === "Citizen").length;

  const cats = CATEGORIES.map(cat => ({
    ...cat,
    count: complaints.filter(c => c.category === cat.id).length,
    pct: Math.round(complaints.filter(c => c.category === cat.id).length / total * 100),
  }));

  const statusList = ALL_STATUSES.map(s => ({
    s,
    count: complaints.filter(c => c.status === s).length,
    pct: Math.round(complaints.filter(c => c.status === s).length / total * 100),
    color: STATUS_COLORS[s] || "#888",
  }));

  const priorityList = Object.entries(PRIORITIES).map(([p, ps]) => ({
    p, color: ps.color,
    count: complaints.filter(c => c.priority === p).length,
    pct: Math.round(complaints.filter(c => c.priority === p).length / total * 100),
  }));

  // Donut segments for active chart
  const donutSegments = activeChart === "category"
    ? cats.map(c => ({ color: c.color, value: c.count }))
    : activeChart === "status"
      ? statusList.map(s => ({ color: s.color, value: s.count }))
      : priorityList.map(p => ({ color: p.color, value: p.count }));

  // Spark data from trend (last 6 months totals)
  const sparkTotals = trendData ? trendData.slice(0, 6).reverse().map(m => parseInt(m.total)) : [];
  const sparkResolved = trendData ? trendData.slice(0, 6).reverse().map(m => parseInt(m.resolved)) : [];

  // ── CSV export ──────────────────────────────────────────────────
  const downloadCSV = () => {
    const headers = ["Ref ID","Category","Status","Priority","Address","Date Submitted","Description"];
    const rows = complaints.map(c => [
      c.ref_id, c.category, c.status, c.priority,
      `"${(c.address||"").replace(/"/g,'""')}"`,
      c.created_at?.slice(0,10) || c.date || "",
      `"${(c.description||"").replace(/"/g,'""').slice(0,100)}"`,
    ]);
    const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `emalahleni-report-${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
    notify("CSV downloaded!", "success");
  };

  // ── Save report to backend ──────────────────────────────────────
  const saveReport = async () => {
    if (!reportName.trim()) { notify("Enter a report name", "warning"); return; }
    setSaving(true);
    const payload = {
      name: reportName.trim(),
      generated_by: "Administrator",
      total_complaints: total,
      resolved,
      active,
      critical,
      high,
      escalated,
      resolution_rate: resRate,
      category_breakdown: JSON.stringify(cats.map(c => ({ id: c.id, label: c.label, count: c.count }))),
      status_breakdown: JSON.stringify(statusList),
      priority_breakdown: JSON.stringify(priorityList),
    };
    try {
      const res  = await fetch(`${API}/api/analytics/reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        notify(`Report "${reportName}" saved!`, "success");
        setSavedReports(prev => [data.report, ...prev]);
        setShowSaveModal(false);
        setReportName("");
      } else {
        notify(data.message || "Save failed", "error");
      }
    } catch (_) {
      notify("Network error — could not save report", "error");
    } finally {
      setSaving(false);
    }
  };

  const maxCatCount = Math.max(...cats.map(c => c.count), 1);

  return (
    <div>
      {/* ── Save Report Modal ── */}
      {showSaveModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.65)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:"#fff",borderRadius:18,padding:28,maxWidth:420,width:"90%",boxShadow:"0 24px 80px rgba(0,0,0,.3)"}}>
            <h3 style={{margin:"0 0 6px",color:"#0F172A",fontSize:18}}>💾 Save Report</h3>
            <p style={{color:"#64748B",fontSize:13,marginBottom:18}}>This snapshot will be stored in the reports archive and can be retrieved later.</p>
            <label style={{fontSize:12,fontWeight:600,color:"#64748B",display:"block",marginBottom:6,textTransform:"uppercase",letterSpacing:".5px"}}>Report Name *</label>
            <input value={reportName} onChange={e=>setReportName(e.target.value)}
              placeholder={`Monthly Report — ${new Date().toLocaleString("default",{month:"long",year:"numeric"})}`}
              style={{width:"100%",padding:"11px 14px",borderRadius:10,border:"1.5px solid #E2E8F0",fontSize:14,boxSizing:"border-box",fontFamily:"inherit",marginBottom:18,outline:"none"}}/>
            <div style={{padding:"12px 14px",background:"#F0FDF4",borderRadius:10,border:"1px solid #BBF7D0",fontSize:12,color:"#166534",marginBottom:18}}>
              📊 This report includes: <strong>{total}</strong> complaints · <strong>{resRate}%</strong> resolution rate · <strong>{escalated}</strong> escalations
            </div>
            <div style={{display:"flex",gap:10}}>
              <button onClick={()=>{setShowSaveModal(false);setReportName("");}} style={{flex:1,padding:11,background:"#F1F5F9",border:"1.5px solid #E2E8F0",borderRadius:10,fontSize:14,cursor:"pointer"}}>Cancel</button>
              <button onClick={saveReport} disabled={saving} style={{flex:2,padding:11,background:saving?"#93C5FD":"linear-gradient(135deg,#1D4ED8,#0EA5E9)",color:"#fff",border:"none",borderRadius:10,fontSize:14,fontWeight:700,cursor:saving?"not-allowed":"pointer"}}>
                {saving ? "Saving…" : "Save to Archive ✓"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Page Header ── */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:22,flexWrap:"wrap",gap:12}}>
        <div>
          <h2 style={{margin:0,fontSize:20,color:"#0F172A",fontWeight:800}}>Reports & Analytics</h2>
          <p style={{margin:"4px 0 0",fontSize:13,color:"#64748B"}}>Comprehensive view of all municipal complaint activity · {new Date().toLocaleDateString("en-ZA",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</p>
        </div>
        <div style={{display:"flex",gap:10}}>
          <button onClick={downloadCSV} style={{display:"flex",alignItems:"center",gap:7,padding:"10px 18px",background:"#F0FDF4",color:"#166534",border:"1.5px solid #BBF7D0",borderRadius:10,fontSize:13,fontWeight:700,cursor:"pointer"}}>
            ⬇️ Export CSV
          </button>
          <button onClick={()=>printReport({complaints,users,cats,statusList,priorityList,total,resolved,active,critical,high,escalated,resRate,trendData})} style={{display:"flex",alignItems:"center",gap:7,padding:"10px 18px",background:"#FFF7ED",color:"#92400E",border:"1.5px solid #FED7AA",borderRadius:10,fontSize:13,fontWeight:700,cursor:"pointer"}}>
            🖨️ Print / PDF
          </button>
          <button onClick={()=>setShowSaveModal(true)} style={{display:"flex",alignItems:"center",gap:7,padding:"10px 18px",background:"linear-gradient(135deg,#1D4ED8,#0EA5E9)",color:"#fff",border:"none",borderRadius:10,fontSize:13,fontWeight:700,cursor:"pointer"}}>
            💾 Save Report
          </button>
        </div>
      </div>

      {/* ── KPI Row ── */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:14,marginBottom:24}}>
        <KpiCard icon="📋" label="Total Complaints" value={total} color="#1D4ED8" spark={sparkTotals} sub={sparkTotals.length>1?`+${sparkTotals.slice(-1)[0]-sparkTotals[0]} vs prior period`:null}/>
        <KpiCard icon="✅" label="Resolved" value={resolved} color="#10B981" spark={sparkResolved} sub={`${resRate}% resolution rate`}/>
        <KpiCard icon="⏳" label="Active Cases" value={active} color="#F59E0B" sub={`${escalated} escalated to council`}/>
        <KpiCard icon="🚨" label="Critical + High" value={critical+high} color="#EF4444" sub={`${critical} critical · ${high} high`}/>
        <KpiCard icon="👥" label="Registered Users" value={users.length} color="#8B5CF6" sub={`${citizens} citizens · ${technicians} techs`}/>
      </div>

      {/* ── Main Charts Row ── */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:18,marginBottom:20}}>

        {/* LEFT — Vertical bar chart */}
        <div style={{background:"#fff",borderRadius:16,padding:22,border:"1px solid #E2E8F0"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18}}>
            <div>
              <div style={{fontSize:13,fontWeight:700,color:"#64748B",textTransform:"uppercase",letterSpacing:".5px"}}>Complaints by Category</div>
              <div style={{fontSize:11,color:"#94A3B8",marginTop:2}}>{total} total complaints</div>
            </div>
          </div>
          <div style={{display:"flex",alignItems:"flex-end",gap:10,height:170,paddingBottom:0}}>
            {cats.map(cat => {
              const barH = Math.max(8, Math.round((cat.count / maxCatCount) * 140));
              return (
                <div key={cat.id} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:5}}>
                  <div style={{fontSize:12,fontWeight:800,color:cat.color}}>{cat.count}</div>
                  <div style={{position:"relative",width:"100%",display:"flex",justifyContent:"center"}}>
                    <div style={{width:"72%",height:barH,background:`linear-gradient(180deg,${cat.color},${cat.color}99)`,borderRadius:"6px 6px 0 0",transition:"height .6s ease",boxShadow:`0 -2px 8px ${cat.color}40`}}/>
                  </div>
                  <div style={{fontSize:16,textAlign:"center",marginTop:2}}>{cat.icon}</div>
                  <div style={{fontSize:9,color:"#94A3B8",textAlign:"center",lineHeight:1.2,maxWidth:50}}>{cat.label.split(" ")[0]}</div>
                </div>
              );
            })}
          </div>
          {/* X-axis line */}
          <div style={{height:1,background:"#E2E8F0",marginTop:2}}/>
        </div>

        {/* RIGHT — Donut + toggle */}
        <div style={{background:"#fff",borderRadius:16,padding:22,border:"1px solid #E2E8F0"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18}}>
            <div style={{fontSize:13,fontWeight:700,color:"#64748B",textTransform:"uppercase",letterSpacing:".5px"}}>Distribution</div>
            <div style={{display:"flex",gap:4}}>
              {[["category","By Type"],["status","By Status"],["priority","By Priority"]].map(([k,lbl])=>(
                <button key={k} onClick={()=>setActiveChart(k)}
                  style={{padding:"4px 10px",borderRadius:20,fontSize:11,fontWeight:600,cursor:"pointer",border:"none",background:activeChart===k?"#1D4ED8":"#F1F5F9",color:activeChart===k?"#fff":"#64748B",transition:"all .2s"}}>
                  {lbl}
                </button>
              ))}
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:20}}>
            <DonutChart
              segments={donutSegments}
              size={150} thickness={30}
              label={total}
              sublabel="total"
            />
            <div style={{flex:1}}>
              {activeChart==="category" && cats.map(cat=>(
                <div key={cat.id} style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                  <div style={{width:10,height:10,borderRadius:"50%",background:cat.color,flexShrink:0}}/>
                  <span style={{fontSize:12,color:"#374151",flex:1}}>{cat.icon} {cat.label}</span>
                  <span style={{fontSize:12,fontWeight:700,color:cat.color}}>{cat.count}</span>
                  <span style={{fontSize:10,color:"#94A3B8",minWidth:30,textAlign:"right"}}>{cat.pct}%</span>
                </div>
              ))}
              {activeChart==="status" && statusList.map(s=>(
                <div key={s.s} style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                  <div style={{width:10,height:10,borderRadius:"50%",background:s.color,flexShrink:0}}/>
                  <span style={{fontSize:12,color:"#374151",flex:1}}>{s.s}</span>
                  <span style={{fontSize:12,fontWeight:700,color:s.color}}>{s.count}</span>
                  <span style={{fontSize:10,color:"#94A3B8",minWidth:30,textAlign:"right"}}>{s.pct}%</span>
                </div>
              ))}
              {activeChart==="priority" && priorityList.map(p=>(
                <div key={p.p} style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                  <div style={{width:10,height:10,borderRadius:"50%",background:p.color,flexShrink:0}}/>
                  <span style={{fontSize:12,color:"#374151",flex:1}}>{p.p}</span>
                  <span style={{fontSize:12,fontWeight:700,color:p.color}}>{p.count}</span>
                  <span style={{fontSize:10,color:"#94A3B8",minWidth:30,textAlign:"right"}}>{p.pct}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Monthly Trend ── */}
      {trendData && trendData.length > 0 && (
        <div style={{background:"#fff",borderRadius:16,padding:22,border:"1px solid #E2E8F0",marginBottom:20}}>
          <div style={{fontSize:13,fontWeight:700,color:"#64748B",textTransform:"uppercase",letterSpacing:".5px",marginBottom:18}}>Monthly Trend — Submissions vs Resolutions</div>
          <div style={{display:"flex",alignItems:"flex-end",gap:8,height:120,marginBottom:8}}>
            {[...trendData].reverse().slice(0,12).map((m,i)=>{
              const maxT = Math.max(...trendData.map(x=>parseInt(x.total)),1);
              const th = Math.max(4,Math.round((parseInt(m.total)/maxT)*100));
              const rh = Math.max(0,Math.round((parseInt(m.resolved)/maxT)*100));
              return(
                <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:2,justifyContent:"flex-end"}}>
                  <div style={{width:"100%",display:"flex",gap:2,alignItems:"flex-end",height:108,justifyContent:"center"}}>
                    <div style={{width:"45%",height:th,background:"#BFDBFE",borderRadius:"3px 3px 0 0",transition:"height .5s ease"}} title={`Submitted: ${m.total}`}/>
                    <div style={{width:"45%",height:rh,background:"#6EE7B7",borderRadius:"3px 3px 0 0",transition:"height .5s ease"}} title={`Resolved: ${m.resolved}`}/>
                  </div>
                  <div style={{fontSize:8,color:"#94A3B8",textAlign:"center"}}>{m.month?.slice(5)||"—"}</div>
                </div>
              );
            })}
          </div>
          <div style={{display:"flex",gap:16,justifyContent:"center"}}>
            <div style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:"#64748B"}}>
              <div style={{width:12,height:12,background:"#BFDBFE",borderRadius:3}}/> Submitted
            </div>
            <div style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:"#64748B"}}>
              <div style={{width:12,height:12,background:"#6EE7B7",borderRadius:3}}/> Resolved
            </div>
          </div>
        </div>
      )}

      {/* ── Bottom Row: Status bars + Priority + Technician workload ── */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:18,marginBottom:20}}>

        {/* Status */}
        <div style={{background:"#fff",borderRadius:16,padding:20,border:"1px solid #E2E8F0"}}>
          <div style={{fontSize:13,fontWeight:700,color:"#64748B",textTransform:"uppercase",letterSpacing:".5px",marginBottom:16}}>Status Pipeline</div>
          {statusList.map(s=>(
            <HBar key={s.s} label={s.s} value={s.count} max={total} color={s.color} icon={
              s.s==="Resolved"?"✅":s.s==="In Progress"?"🔧":s.s==="Escalated"?"⬆️":s.s==="Assigned"?"👷":"📬"
            } pct={s.pct}/>
          ))}
        </div>

        {/* Priority */}
        <div style={{background:"#fff",borderRadius:16,padding:20,border:"1px solid #E2E8F0"}}>
          <div style={{fontSize:13,fontWeight:700,color:"#64748B",textTransform:"uppercase",letterSpacing:".5px",marginBottom:16}}>Priority Distribution</div>
          {priorityList.map(p=>(
            <HBar key={p.p} label={p.p} value={p.count} max={total} color={p.color} icon={
              p.p==="Critical"?"🔴":p.p==="High"?"🟠":p.p==="Medium"?"🟡":"🟢"
            } pct={p.pct}/>
          ))}
          <div style={{marginTop:16,padding:"12px 14px",background:"#FEF2F2",borderRadius:10,border:"1px solid #FECACA"}}>
            <div style={{fontSize:12,fontWeight:700,color:"#DC2626"}}>⚠️ Needs Attention</div>
            <div style={{fontSize:22,fontWeight:800,color:"#DC2626",marginTop:2}}>{critical+high}</div>
            <div style={{fontSize:11,color:"#EF4444"}}>High + Critical complaints</div>
          </div>
        </div>

        {/* Technician performance */}
        <div style={{background:"#fff",borderRadius:16,padding:20,border:"1px solid #E2E8F0"}}>
          <div style={{fontSize:13,fontWeight:700,color:"#64748B",textTransform:"uppercase",letterSpacing:".5px",marginBottom:16}}>Workforce Summary</div>
          {[
            {label:"Citizens Registered",value:citizens,color:"#1D4ED8",icon:"👤"},
            {label:"Technicians Active",value:technicians,color:"#10B981",icon:"👷"},
            {label:"Administrators",value:users.filter(u=>u.role==="Administrator").length,color:"#8B5CF6",icon:"⚙️"},
            {label:"Councillors",value:users.filter(u=>u.role==="Councillor").length,color:"#EF4444",icon:"⚖️"},
          ].map(row=>(
            <div key={row.label} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 10px",borderRadius:8,background:"#F8FAFC",marginBottom:8}}>
              <span style={{fontSize:18}}>{row.icon}</span>
              <span style={{flex:1,fontSize:13,color:"#374151"}}>{row.label}</span>
              <span style={{fontSize:16,fontWeight:800,color:row.color}}>{row.value}</span>
            </div>
          ))}
          <div style={{marginTop:8,padding:"10px 12px",background:"#EFF6FF",borderRadius:8,border:"1px solid #BFDBFE"}}>
            <div style={{fontSize:11,color:"#1E40AF",fontWeight:600}}>🤖 AI Classifier</div>
            <div style={{fontSize:18,fontWeight:800,color:"#1D4ED8"}}>{complaints.filter(c=>c.ai_category||c.category).length}</div>
            <div style={{fontSize:11,color:"#3B82F6"}}>complaints auto-classified</div>
          </div>
        </div>
      </div>

      {/* ── Saved Reports Archive ── */}
      <div style={{background:"#fff",borderRadius:16,padding:22,border:"1px solid #E2E8F0"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
          <div>
            <div style={{fontSize:13,fontWeight:700,color:"#64748B",textTransform:"uppercase",letterSpacing:".5px"}}>📁 Saved Reports Archive</div>
            <div style={{fontSize:11,color:"#94A3B8",marginTop:2}}>Reports saved here can be retrieved and sent to higher management</div>
          </div>
          <button onClick={()=>setShowSaveModal(true)} style={{padding:"8px 16px",background:"linear-gradient(135deg,#1D4ED8,#0EA5E9)",color:"#fff",border:"none",borderRadius:8,fontSize:12,fontWeight:700,cursor:"pointer"}}>
            + New Snapshot
          </button>
        </div>
        {savedReports.length===0?(
          <div style={{textAlign:"center",padding:"40px 20px",color:"#94A3B8"}}>
            <div style={{fontSize:40,marginBottom:10}}>📂</div>
            <div style={{fontSize:14,fontWeight:600}}>No saved reports yet</div>
            <div style={{fontSize:12,marginTop:4}}>Click "Save Report" to create a snapshot for management</div>
          </div>
        ):(
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
              <thead>
                <tr style={{background:"#F8FAFC"}}>
                  {["Report Name","Generated","Total","Resolved","Critical","Res. Rate","Actions"].map(h=>(
                    <th key={h} style={{padding:"10px 14px",textAlign:"left",fontWeight:700,color:"#64748B",fontSize:11,textTransform:"uppercase",letterSpacing:".5px",borderBottom:"1px solid #E2E8F0"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {savedReports.map((r,i)=>(
                  <tr key={r.id||i} style={{borderBottom:"1px solid #F1F5F9",background:i%2===0?"#fff":"#FAFAFA"}}>
                    <td style={{padding:"11px 14px",fontWeight:600,color:"#0F172A"}}>{r.name}</td>
                    <td style={{padding:"11px 14px",color:"#64748B"}}>{r.created_at?.slice(0,10)||r.generated_at||"—"}</td>
                    <td style={{padding:"11px 14px",fontWeight:700,color:"#1D4ED8"}}>{r.total_complaints}</td>
                    <td style={{padding:"11px 14px",fontWeight:700,color:"#10B981"}}>{r.resolved}</td>
                    <td style={{padding:"11px 14px",fontWeight:700,color:"#EF4444"}}>{r.critical}</td>
                    <td style={{padding:"11px 14px"}}>
                      <span style={{padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:700,background:r.resolution_rate>=70?"#D1FAE5":r.resolution_rate>=40?"#FEF3C7":"#FEE2E2",color:r.resolution_rate>=70?"#065F46":r.resolution_rate>=40?"#92400E":"#DC2626"}}>
                        {r.resolution_rate}%
                      </span>
                    </td>
                    <td style={{padding:"11px 14px"}}>
                      <div style={{display:"flex",gap:6}}>
                        <button onClick={()=>{
                          const rows = [
                            ["Field","Value"],
                            ["Report Name",r.name],
                            ["Generated",r.created_at?.slice(0,10)||""],
                            ["Total Complaints",r.total_complaints],
                            ["Resolved",r.resolved],
                            ["Active",r.active],
                            ["Critical",r.critical],
                            ["High",r.high],
                            ["Escalated",r.escalated],
                            ["Resolution Rate",r.resolution_rate+"%"],
                          ];
                          const csv = rows.map(row=>row.join(",")).join("\n");
                          const blob = new Blob([csv],{type:"text/csv"});
                          const url  = URL.createObjectURL(blob);
                          const a    = document.createElement("a");
                          a.href=url; a.download=`${r.name.replace(/\s+/g,"-")}.csv`; a.click();
                          URL.revokeObjectURL(url);
                        }} style={{fontSize:11,color:"#1E40AF",background:"#EFF6FF",border:"1px solid #BFDBFE",padding:"4px 10px",borderRadius:6,cursor:"pointer",fontWeight:600}}>
                          ⬇️ CSV
                        </button>
                        <button onClick={async()=>{
                          if(!window.confirm(`Delete report "${r.name}"?`)) return;
                          try{
                            const res = await fetch(`${API}/api/analytics/reports/${r.id}`,{
                              method:"DELETE",
                              headers:{Authorization:`Bearer ${token}`}
                            });
                            const data = await res.json();
                            if(data.success){
                              setSavedReports(prev=>prev.filter(x=>x.id!==r.id));
                              notify("Report deleted","info");
                            } else {
                              notify(data.message||"Delete failed","error");
                            }
                          }catch(_){notify("Network error","error");}
                        }} style={{fontSize:11,color:"#DC2626",background:"#FEE2E2",border:"1px solid #FECACA",padding:"4px 10px",borderRadius:6,cursor:"pointer",fontWeight:600}}>
                          🗑️
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
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
  const [assignments,setAssignments]=useState([]);
  const [editUserModal,setEditUserModal]=useState(null);
  const [deleteConfirm,setDeleteConfirm]=useState(null);
  const [editForm,setEditForm]=useState({full_name:"",email:"",phone:"",role:""});
  const [userFilter,setUserFilter]=useState("all");
  const token=localStorage.getItem("token");

  const load=useCallback(async()=>{
    setLoading(true);
    try{
      const [cr,ur,ar]=await Promise.all([
        fetch(`${API}/api/complaints`,{headers:{Authorization:`Bearer ${token}`}}).then(r=>r.json()),
        fetch(`${API}/api/users`,{headers:{Authorization:`Bearer ${token}`}}).then(r=>r.json()),
        fetch(`${API}/api/assignments`,{headers:{Authorization:`Bearer ${token}`}}).then(r=>r.json()),
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
      if(ar.success)setAssignments(ar.assignments||[]);
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
    if(!councillors.length){notify("No councillor account found. Register a Councillor user first.","error");return;}

    // Try every possible numeric DB id field — dbId is set by load(), id is the raw API field
    const complaintDbId = complaint.dbId || complaint.db_id || complaint.id;
    if(!complaintDbId){notify("Cannot escalate — complaint database ID missing.","error");return;}

    // Ensure we are sending a number, not a ref_id string like "CMP-001"
    const numericId = parseInt(complaintDbId, 10);
    if(isNaN(numericId)){notify("Cannot escalate — invalid complaint ID: "+complaintDbId,"error");return;}

    try{
      const res=await fetch(`${API}/api/escalations`,{
        method:"POST",
        headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},
        body:JSON.stringify({complaint_id:numericId, councillor_id:councillors[0].id}),
      });
      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        const text = await res.text();
        console.error("Non-JSON from /api/escalations:", res.status, text.slice(0,200));
        notify(`Server error (${res.status}): escalation route not found — check backend router`, "error");
        return;
      }
      const data=await res.json();
      if(data.success){notify(`${complaint.ref_id||complaint.id} escalated to Councillor!`,"info");load();}
      else notify(data.message||"Escalation failed","error");
    }catch(err){console.error("Escalation error:",err);notify("Network error — could not escalate","error");}
  };

  const technicians=users.filter(u=>u.role==="Technician");

  const openEditUser=(u)=>{
    setEditForm({full_name:u.full_name||"",email:u.email||"",phone:u.phone||"",role:u.role||""});
    setEditUserModal(u);
  };
  const saveEditUser=async()=>{
    if(!editUserModal)return;
    const res=await fetch(`${API}/api/users/${editUserModal.id}`,{
      method:"PATCH",
      headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},
      body:JSON.stringify(editForm),
    });
    const data=await res.json();
    if(data.success){notify("User updated successfully");setEditUserModal(null);load();}
    else notify(data.message||"Failed to update user","error");
  };
  const confirmDelete=async()=>{
    if(!deleteConfirm)return;
    const res=await fetch(`${API}/api/users/${deleteConfirm.id}`,{
      method:"DELETE",
      headers:{Authorization:`Bearer ${token}`},
    });
    const data=await res.json();
    if(data.success){notify(`${deleteConfirm.full_name} deactivated`,"info");setDeleteConfirm(null);load();}
    else notify(data.message||"Failed to delete user","error");
  };

  const cats=CATEGORIES.map(cat=>({...cat,count:complaints.filter(c=>c.category===cat.id).length}));
  const statuses=ALL_STATUSES.map(s=>({s,count:complaints.filter(c=>c.status===s).length}));
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

      {/* EDIT USER MODAL */}
      {editUserModal&&(
        <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.65)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:"#fff",borderRadius:18,padding:28,maxWidth:460,width:"90%"}}>
            <h3 style={{margin:"0 0 4px",color:"#1E293B"}}>✏️ Edit {editUserModal.role}</h3>
            <p style={{color:"#64748B",fontSize:13,marginTop:0,marginBottom:18}}>Updating details for <strong>{editUserModal.full_name}</strong></p>
            {[
              {label:"Full Name",key:"full_name",placeholder:"e.g. Sipho Dlamini"},
              {label:"Email",key:"email",placeholder:"user@domain.gov.za"},
              {label:"Phone",key:"phone",placeholder:"+27 81 234 5678"},
            ].map(({label,key,placeholder})=>(
              <div key={key} style={{marginBottom:14}}>
                <label style={{fontSize:12,fontWeight:700,color:"#64748B",display:"block",marginBottom:5,textTransform:"uppercase",letterSpacing:".4px"}}>{label}</label>
                <input value={editForm[key]} onChange={e=>setEditForm(f=>({...f,[key]:e.target.value}))} placeholder={placeholder}
                  style={{width:"100%",padding:"10px 12px",borderRadius:10,border:"1.5px solid #E2E8F0",fontSize:14,boxSizing:"border-box",fontFamily:"inherit"}}/>
              </div>
            ))}
            <div style={{marginBottom:18}}>
              <label style={{fontSize:12,fontWeight:700,color:"#64748B",display:"block",marginBottom:5,textTransform:"uppercase",letterSpacing:".4px"}}>Role</label>
              <select value={editForm.role} onChange={e=>setEditForm(f=>({...f,role:e.target.value}))}
                style={{width:"100%",padding:"10px 12px",borderRadius:10,border:"1.5px solid #E2E8F0",fontSize:14,boxSizing:"border-box"}}>
                <option value="Technician">👷 Technician</option>
                <option value="Councillor">⚖️ Councillor</option>
              </select>
            </div>
            <div style={{display:"flex",gap:10}}>
              <button onClick={()=>setEditUserModal(null)} style={{flex:1,padding:11,background:"#F8FAFC",border:"1.5px solid #E2E8F0",borderRadius:10,fontSize:14,cursor:"pointer"}}>Cancel</button>
              <button onClick={saveEditUser} style={{flex:2,padding:11,background:"linear-gradient(135deg,#7C3AED,#6D28D9)",color:"#fff",border:"none",borderRadius:10,fontSize:14,fontWeight:700,cursor:"pointer"}}>💾 Save Changes</button>
            </div>
          </div>
        </div>
      )}

      {/* DELETE CONFIRM MODAL */}
      {deleteConfirm&&(
        <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.65)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:"#fff",borderRadius:18,padding:28,maxWidth:400,width:"90%",textAlign:"center"}}>
            <div style={{fontSize:52,marginBottom:8}}>⚠️</div>
            <h3 style={{margin:"0 0 10px",color:"#DC2626"}}>Deactivate Account?</h3>
            <p style={{color:"#64748B",fontSize:14,margin:"0 0 16px"}}>
              <strong>{deleteConfirm.full_name}</strong> ({deleteConfirm.role}) will no longer be able to log in.
            </p>
            <div style={{background:"#FEF2F2",borderRadius:10,padding:"10px 14px",marginBottom:20,fontSize:13,color:"#DC2626",border:"1px solid #FECACA",textAlign:"left"}}>
              🔒 Soft-delete only — the account stays in the database and can be reactivated if needed.
            </div>
            <div style={{display:"flex",gap:10}}>
              <button onClick={()=>setDeleteConfirm(null)} style={{flex:1,padding:11,background:"#F8FAFC",border:"1.5px solid #E2E8F0",borderRadius:10,fontSize:14,cursor:"pointer"}}>Cancel</button>
              <button onClick={confirmDelete} style={{flex:1,padding:11,background:"linear-gradient(135deg,#DC2626,#B91C1C)",color:"#fff",border:"none",borderRadius:10,fontSize:14,fontWeight:700,cursor:"pointer"}}>🗑️ Deactivate</button>
            </div>
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
        tabs={[["overview","📊 Overview"],["complaints","📋 All Complaints"],["map","🗺️ Heat Map"],["assign","👷 Assign Work"],["users","👥 Manage Users"],["reports","📈 Reports & Trends"],["notifications","📢 Send Notifications"]]}
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
                    <div style={{width:10,height:10,borderRadius:"50%",background:
                    s==="Resolved"?"#10B981":
                    s==="In Progress"?"#1D4ED8":
                    s==="Escalated"?"#DC2626":
                    s==="Assigned"?"#0EA5E9":
                    s==="Classified"?"#8B5CF6":"#F59E0B"
                  }}/>
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
                        <td style={{padding:"10px 14px"}}><span style={{fontSize:11,padding:"3px 9px",borderRadius:20,background:c.status==="Resolved"?"#D1FAE5":c.status==="Escalated"?"#FEE2E2":c.status==="In Progress"?"#DBEAFE":"#F1F5F9",
                    color:c.status==="Resolved"?"#065F46":c.status==="Escalated"?"#DC2626":c.status==="In Progress"?"#1E40AF":"#64748B",fontWeight:600}}>{c.status}</span></td>
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
              <LiveTrackingMap complaints={complaints.map(c=>({...c,id:c.ref_id,lat:parseFloat(c.latitude)||null,lng:parseFloat(c.longitude)||null,status:c.status||"Submitted",priority:c.priority||"Medium"}))} technicians={users.filter(u=>u.role==="Technician").map((t,i)=>({...t,name:t.full_name,lat:null,lng:null,color:"#378ADD",status_label:"Available"}))} selected={selected} onSelect={setSelected} title="Complaint Heat Map — All Areas" height={420}/>
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
                  const techActive=assignments.filter(a=>a.technician_id===t.id&&(a.status==="In Progress"||a.status==="Assigned"||a.complaint_status==="In Progress"||a.complaint_status==="Assigned")).length;
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

        {/* MANAGE USERS */}
        {view==="users"&&(
          <div>
            <div style={{display:"flex",gap:10,marginBottom:18,flexWrap:"wrap",alignItems:"center"}}>
              <h2 style={{margin:0,fontSize:18,color:"#1E293B",flex:1}}>👥 Manage Technicians & Councillors</h2>
              <button onClick={load} style={{padding:"9px 14px",background:"#0EA5E9",color:"#fff",border:"none",borderRadius:10,fontSize:13,cursor:"pointer",fontWeight:600}}>🔄 Refresh</button>
            </div>
            <div style={{display:"flex",gap:8,marginBottom:18,flexWrap:"wrap"}}>
              {[["all","All Staff"],["Technician","👷 Technicians"],["Councillor","⚖️ Councillors"]].map(([val,label])=>(
                <button key={val} onClick={()=>setUserFilter(val)}
                  style={{padding:"8px 18px",borderRadius:20,border:`2px solid ${userFilter===val?"#7C3AED":"#E2E8F0"}`,
                    background:userFilter===val?"#7C3AED":"#fff",color:userFilter===val?"#fff":"#1E293B",
                    fontSize:13,fontWeight:600,cursor:"pointer"}}>
                  {label}
                </button>
              ))}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:12,marginBottom:20}}>
              <div style={{background:"#fff",borderRadius:14,padding:16,border:"1.5px solid #10B98133",textAlign:"center"}}>
                <div style={{fontSize:30,fontWeight:800,color:"#10B981"}}>{users.filter(u=>u.role==="Technician"&&u.is_active!==false).length}</div>
                <div style={{fontSize:12,color:"#64748B",fontWeight:600,marginTop:4}}>👷 Active Technicians</div>
              </div>
              <div style={{background:"#fff",borderRadius:14,padding:16,border:"1.5px solid #EF444433",textAlign:"center"}}>
                <div style={{fontSize:30,fontWeight:800,color:"#EF4444"}}>{users.filter(u=>u.role==="Councillor"&&u.is_active!==false).length}</div>
                <div style={{fontSize:12,color:"#64748B",fontWeight:600,marginTop:4}}>⚖️ Active Councillors</div>
              </div>
              <div style={{background:"#fff",borderRadius:14,padding:16,border:"1.5px solid #94A3B833",textAlign:"center"}}>
                <div style={{fontSize:30,fontWeight:800,color:"#94A3B8"}}>{users.filter(u=>(u.role==="Technician"||u.role==="Councillor")&&u.is_active===false).length}</div>
                <div style={{fontSize:12,color:"#64748B",fontWeight:600,marginTop:4}}>🔒 Deactivated</div>
              </div>
            </div>
            <div style={{background:"#fff",borderRadius:14,border:"1px solid #E2E8F0",overflow:"hidden"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                <thead>
                  <tr style={{background:"#F8FAFC"}}>
                    {["User","Role","Email","Phone","Status","Actions"].map(h=>(
                      <th key={h} style={{padding:"12px 16px",textAlign:"left",fontWeight:700,color:"#64748B",fontSize:11,textTransform:"uppercase",letterSpacing:".5px",borderBottom:"1px solid #E2E8F0"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {users
                    .filter(u=>u.role==="Technician"||u.role==="Councillor")
                    .filter(u=>userFilter==="all"||u.role===userFilter)
                    .map((u,i)=>{
                      const isTech=u.role==="Technician";
                      const roleColor=isTech?"#059669":"#DC2626";
                      const roleBg=isTech?"#D1FAE5":"#FEE2E2";
                      const active=u.is_active!==false;
                      return(
                        <tr key={u.id} style={{background:i%2===0?"#fff":"#F8FAFC",borderBottom:"1px solid #E2E8F0",opacity:active?1:.6}}>
                          <td style={{padding:"12px 16px"}}>
                            <div style={{display:"flex",alignItems:"center",gap:10}}>
                              <div style={{width:38,height:38,borderRadius:"50%",background:roleBg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>
                                {isTech?"👷":"⚖️"}
                              </div>
                              <div>
                                <div style={{fontWeight:700,color:"#1E293B",fontSize:13}}>{u.full_name}</div>
                                <div style={{fontSize:11,color:"#94A3B8"}}>ID: {u.id_number||"—"}</div>
                              </div>
                            </div>
                          </td>
                          <td style={{padding:"12px 16px"}}>
                            <span style={{fontSize:11,padding:"4px 10px",borderRadius:20,background:roleBg,color:roleColor,fontWeight:700}}>{u.role}</span>
                          </td>
                          <td style={{padding:"12px 16px",color:"#64748B",fontSize:12}}>{u.email}</td>
                          <td style={{padding:"12px 16px",color:"#64748B",fontSize:12}}>{u.phone||"—"}</td>
                          <td style={{padding:"12px 16px"}}>
                            <span style={{fontSize:11,padding:"4px 10px",borderRadius:20,fontWeight:700,
                              background:active?"#D1FAE5":"#F1F5F9",color:active?"#065F46":"#64748B"}}>
                              {active?"● Active":"○ Inactive"}
                            </span>
                          </td>
                          <td style={{padding:"12px 16px"}}>
                            <div style={{display:"flex",gap:6}}>
                              <button onClick={()=>openEditUser(u)}
                                style={{fontSize:12,color:"#7C3AED",background:"#EDE9FE",border:"none",padding:"6px 12px",borderRadius:8,cursor:"pointer",fontWeight:700}}>
                                ✏️ Edit
                              </button>
                              {active&&(
                                <button onClick={()=>setDeleteConfirm(u)}
                                  style={{fontSize:12,color:"#DC2626",background:"#FEE2E2",border:"none",padding:"6px 12px",borderRadius:8,cursor:"pointer",fontWeight:700}}>
                                  🗑️ Remove
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  }
                </tbody>
              </table>
              {users.filter(u=>u.role==="Technician"||u.role==="Councillor").filter(u=>userFilter==="all"||u.role===userFilter).length===0&&(
                <div style={{textAlign:"center",padding:52,color:"#64748B"}}>
                  <div style={{fontSize:40,marginBottom:10}}>👤</div>
                  <div style={{fontWeight:600,fontSize:15,marginBottom:4}}>No {userFilter==="all"?"staff":userFilter} accounts found</div>
                  <div style={{fontSize:13}}>Register Technician or Councillor accounts to see them here.</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* REPORTS */}
        {view==="reports"&&(
          <ReportsHub complaints={complaints} users={users} token={token} currentUser={user} notify={notify}/>
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
        tabs={[["jobs","🔧 My Jobs"],["inprogress","⏳ In Progress"],["completed","✅ Completed"],["map","🗺️ Job Map"],["reports","📈 My Reports"]]}
        activeTab={view} setActiveTab={setView}/>

      <div style={{maxWidth:1100,margin:"0 auto",padding:"24px 20px"}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:14,marginBottom:22}}>
          <StatCard icon="📋" label="Total Assigned" value={loading?"…":assignments.length} color={C.blue}/>
          <StatCard icon="🔧" label="Active Jobs" value={loading?"…":active.length} color="#F59E0B"/>
          <StatCard icon="✅" label="Completed" value={loading?"…":done.length} color="#10B981"/>
          <StatCard icon="⭐" label="Avg Rating" value={loading?"…":(()=>{
            const rated=assignments.filter(a=>a.rating>0);
            if(!rated.length)return"N/A";
            return(rated.reduce((s,a)=>s+(parseFloat(a.rating)||0),0)/rated.length).toFixed(1);
          })()} color="#F59E0B"/>
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
              <LiveTrackingMap complaints={assignments.map(a=>({...a,id:a.ref_id,category:a.category,status:a.status||"Assigned",priority:a.priority||"Medium",lat:parseFloat(a.latitude||a.lat)||null,lng:parseFloat(a.longitude||a.lng)||null}))} technicians={[{name:user.full_name,role:"Technician",color:"#10B981",status_label:"On duty",lat:null,lng:null}]} selected={null} onSelect={()=>{}} title="My Job Locations" height={380}/>
            </div>
          </div>
        )}

        {view==="reports"&&(
          <ReportsHub complaints={[]} users={[]} token={token} currentUser={user} notify={notify}/>
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
        tabs={[["queue",`🚨 Council Queue${pending.length>0?` (${pending.length})`:""}`],["decided","✅ Decided Cases"],["map","🗺️ Escalation Map"],["reports","📈 Reports"]]}
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
              <LiveTrackingMap complaints={escalations.map(e=>({...e,id:e.ref_id,lat:parseFloat(e.latitude)||null,lng:parseFloat(e.longitude)||null}))} selected={null} onSelect={()=>{}} title="Escalation Locations — Council View" height={400}/>
            </div>
          </div>
        )}

        {/* REPORTS */}
        {view==="reports"&&(
          <ReportsHub complaints={[]} users={[]} token={token} currentUser={user} notify={notify}/>
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