"use client";

import { useState, useEffect, useRef } from "react";

// ─── RESPONSIVE HOOK ─────────────────────────────────────────────────────────
function useBreakpoint() {
  const [width, setWidth] = useState(typeof window !== "undefined" ? window.innerWidth : 1200);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return { isMobile: width < 640, isTablet: width >= 640 && width < 1024, isDesktop: width >= 1024, width };
}

// ─── CONSTANTS ───────────────────────────────────────────────────────────────
const DEFAULT_START_DATE = new Date(2026, 2, 8); // Sunday Mar 8 — long run kickoff
const DEFAULT_PROGRAM_WEEKS = 8;
const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

const TYPE_META: Record<string, { color: string; label: string; icon: string }> = {
  threshold: { color: "#FF6B35", label: "THRESHOLD",   icon: "🔥" },
  strength:  { color: "#4ECDC4", label: "STRENGTH",    icon: "💪" },
  subthresh: { color: "#FFE66D", label: "SUB-THR",     icon: "🏃" },
  vest:      { color: "#C084FC", label: "VEST/INCLINE",icon: "🔺" },
  z2:        { color: "#60A5FA", label: "Z2 RUN",      icon: "💨" },
  hyrox:     { color: "#F97316", label: "HYROX SIM",   icon: "⚡" },
  longrun:   { color: "#34D399", label: "LONG RUN",    icon: "🌿" },
  rest:      { color: "#4B5563", label: "REST",         icon: "😴" },
};

// ─── THEME ────────────────────────────────────────────────────────────────────
interface Theme {
  bg: string; bgAlt: string; bgCard: string; bgInput: string; bgHover: string;
  border: string; borderLight: string; borderFocus: string;
  text: string; textSecondary: string; textMuted: string; textFaint: string; textGhost: string;
  chatBg: string; overlayBg: string; modalBg: string;
  cardTodayBg: string; scrollThumb: string;
}

const DARK_THEME: Theme = {
  bg:"#080808", bgAlt:"#090909", bgCard:"#0D0D0D", bgInput:"#111", bgHover:"#0F0A07",
  border:"#1a1a1a", borderLight:"#141414", borderFocus:"#222",
  text:"#E8E8E0", textSecondary:"#CCC", textMuted:"#888", textFaint:"#555", textGhost:"#333",
  chatBg:"#090909", overlayBg:"#000000CC", modalBg:"#0D0D0D",
  cardTodayBg:"#0F0A07", scrollThumb:"#FF6B35",
};

const LIGHT_THEME: Theme = {
  bg:"#F5F5F3", bgAlt:"#EEEEE9", bgCard:"#FFFFFF", bgInput:"#F0F0EC", bgHover:"#FFF5EE",
  border:"#D4D4D0", borderLight:"#E0E0DC", borderFocus:"#BBB",
  text:"#1A1A1A", textSecondary:"#333", textMuted:"#666", textFaint:"#888", textGhost:"#AAA",
  chatBg:"#EEEEE9", overlayBg:"#00000066", modalBg:"#FFFFFF",
  cardTodayBg:"#FFF5EE", scrollThumb:"#FF6B35",
};

// ─── TYPES ───────────────────────────────────────────────────────────────────
interface Workout {
  type: string;
  title: string;
  sets: string;
  pace: string;
  rest: string;
  hr: string;
  notes: string;
  weekNum?: number;
  dayIndex?: number;
  key?: string;
  isOverridden?: boolean;
  aiGenerated?: boolean;
}

interface Adjustments {
  fatigue?: number;
  performance?: number;
  compliance?: number;
}

interface Feedback {
  rpe: number;
  hrAvg: number | null;
  hrTarget: number | null;
  completed: string;
  notes: string;
}

interface LogEntry {
  status: string;
  feedback?: {
    rpe: number;
    completed: string;
    notes: string;
    hrAvg: number | null;
    hrMax?: number | null;
    paceAvg?: string;
  };
  adjustments?: { fatigue: number; performance: number };
}

interface ParsedResponse {
  cleanText: string;
  workoutUpdate: Workout | null;
  progressionUpdate: { type: string; weeklyAdjustments: Record<string, { fatigueOverride?: number; performanceOverride?: number }>; message?: string } | null;
}

interface ChatMessage {
  role: string;
  content: string;
  parsed?: ParsedResponse;
}

// ─── WORKOUT GENERATION ──────────────────────────────────────────────────────
function weekProfile(w: number, totalWeeks: number = 8) {
  const raceWeek = w === totalWeeks;
  // Deload every 3–4 weeks: at ~halfway and ~week before race
  const deloadWeeks = new Set<number>();
  if (totalWeeks >= 6) deloadWeeks.add(totalWeeks - 1); // penultimate week
  if (totalWeeks >= 4) deloadWeeks.add(Math.ceil(totalWeeks / 2)); // midpoint
  const deload = deloadWeeks.has(w);

  // Progressive volume/intensity scaling
  let volMultiplier: number, intMultiplier: number;
  if (raceWeek) { volMultiplier = 0.4; intMultiplier = 0.9; }
  else if (deload) { volMultiplier = 0.65; intMultiplier = 0.8; }
  else {
    const buildWeeks = Array.from({length: totalWeeks}, (_, i) => i + 1).filter(wk => !deloadWeeks.has(wk) && wk !== totalWeeks);
    const idx = buildWeeks.indexOf(w);
    const progression = idx >= 0 ? idx / Math.max(1, buildWeeks.length - 1) : 0;
    volMultiplier = 1 + progression * 0.4; // 1.0 → 1.4
    intMultiplier = 1 + progression * 0.2; // 1.0 → 1.2
  }
  return { deload, raceWeek, volMultiplier, intMultiplier };
}

function generateWorkout(dayOfWeek: number, weekNum: number, adjustments: Adjustments = {}, totalWeeks: number = 8): Workout {
  const { fatigue=5, performance=5, compliance=1.0 } = adjustments;
  const { volMultiplier:vm, intMultiplier:im, deload, raceWeek } = weekProfile(weekNum, totalWeeks);
  const fatigueAdj  = 1 - (fatigue-5)*0.06;
  const perfAdj     = 1 + (performance-5)*0.04;
  const compAdj     = 0.8 + compliance*0.2;
  const totalAdj    = fatigueAdj * perfAdj * compAdj;
  const wedIsVest   = weekNum % 2 === 0;
  const fns = [
    ()=>buildThreshold(weekNum,vm*totalAdj,im),
    ()=>buildStrength(weekNum,vm*totalAdj,deload),
    ()=>wedIsVest?buildVest(weekNum,vm*totalAdj,im,deload,raceWeek):buildSubThresh(weekNum,vm*totalAdj,im,deload),
    ()=>buildZ2(weekNum,vm*totalAdj,deload),
    ()=>buildHyrox(weekNum,vm*totalAdj,im,deload,raceWeek),
    ()=>buildHeavyLift(weekNum,vm*totalAdj,deload,raceWeek),
    ()=>buildLongRun(weekNum,vm*totalAdj,deload,raceWeek),
  ];
  return fns[dayOfWeek]();
}

function buildThreshold(w: number,vm: number,im: number): Workout {
  if(w===8)return{type:"threshold",title:"Shakeout Strides",sets:"3 × 600m",pace:"Race pace",rest:"2 min",hr:"163–168",notes:"Wake the legs. Nothing more."};
  const baseReps=w<=2?6:7; const dist=w===1?"800m":"1000m";
  const reps=Math.max(3,Math.round(baseReps*vm));
  const pace=im>=1.1?"7:10–7:20/mi":im>=1.0?"7:20–7:30/mi":"7:30–7:45/mi";
  return{type:"threshold",title:`${dist} Threshold Repeats`,sets:`${reps} × ${dist}`,pace,rest:"60 sec",hr:`163–${im>=1.1?172:170}`,notes:`${reps<5?"Reduced volume. ":""}Push final 2 reps. Extend to 75s rest if HR exceeds ceiling by rep ${reps-2}.`};
}
function buildStrength(w: number,vm: number,deload: boolean): Workout {
  if(w===8)return{type:"strength",title:"Mobility + Light Stations",sets:"30 min",pace:"—",rest:"—",hr:"—",notes:"No lifting. Foam roll, hip & shoulder mobility. Light wall balls 2×15."};
  const s=Math.max(2,Math.round((deload?3:4)*Math.min(vm,1.2)));
  return{type:"strength",title:`${deload?"Light":vm>=1.2?"Heavy":"Moderate"} Compound Day`,sets:`~${deload?55:75} min`,pace:"—",rest:"2–3 min",hr:"—",notes:`Deadlift ${s}×5, Bench ${s}×${deload?6:5}, Clean ${Math.max(2,s-1)}×${deload?4:3}, Pull-ups ${Math.max(2,s-1)}×5, Dips ${Math.max(2,s-1)}×10${deload?". All 70% max.":"."}`};
}
function buildSubThresh(w: number,vm: number,im: number,deload: boolean): Workout {
  const base=deload?4:w<=2?5:w<=4?6:7; const reps=Math.max(3,Math.round(base*vm));
  return{type:"subthresh",title:"1000m Sub-Threshold Repeats",sets:`${reps} × 1000m`,pace:im>=1.15?"7:25–7:45/mi":im>=1.0?"7:30–8:00/mi":"7:45–8:15/mi",rest:deload?"2 min":"90 sec",hr:`155–${im>=1.1?165:163}`,notes:`${deload?"Deliberately easy. ":""}Controlled hard. 5–8 bpm below threshold. ${reps>=7?"Drop to 6 if form degrades.":""}`};
}
function buildVest(w: number,vm: number,im: number,deload: boolean,raceWeek: boolean): Workout {
  if(raceWeek)return{type:"vest",title:"Light Vest Incline Walk",sets:"25 min",pace:"3.0 mph @ 10%",rest:"—",hr:"130–145",notes:"10lb vest. Movement flush only."};
  if(deload)return{type:"vest",title:"Vest Incline Walk — Deload",sets:"40 min",pace:"3.0–3.5 mph @ 12–14%",rest:"—",hr:"148–158",notes:"15lb vest. HR cap 160."};
  const sets=Math.max(3,Math.round((w<=3?5:6)*Math.min(vm,1.1)));
  const vest=im>=1.15?25:im>=1.0?20:15;
  return{type:"vest",title:"Weighted Vest Stair Stepper",sets:`${sets} × 8 min`,pace:`${im>=1.1?"70–80":"65–75"} steps/min`,rest:im>=1.1?"90 sec":"2 min",hr:`155–${im>=1.1?168:163}`,notes:`${vest}lb vest. No rail gripping. ${sets>=6?"Last 2 blocks genuinely hard.":""}`};
}
function buildZ2(w: number,vm: number,deload: boolean): Workout {
  const base=deload?45:w<=2?52:w<=5?58:55;
  const mins=Math.max(30,Math.round(base*Math.min(vm,1.0)));
  return{type:"z2",title:"Zone 2 Easy Run",sets:`${mins} min`,pace:"9:00–10:00/mi",rest:"—",hr:"135–148",notes:`Strict Z2. Nasal breathe. ${deload?"Walk freely if needed.":""}`};
}
function buildHyrox(w: number,vm: number,im: number,deload: boolean,raceWeek: boolean): Workout {
  if(raceWeek)return{type:"hyrox",title:"Pre-Race Strides",sets:"5 × 30 sec",pace:"Race effort",rest:"90 sec walk",hr:"165–170 briefly",notes:"10 min jog → 5 strides → cooldown."};
  if(deload)return{type:"hyrox",title:"Hyrox Review — Technique",sets:"4 × (800m + 2 stations)",pace:"Comfortable",rest:"2 min",hr:"150–162",notes:"Form focus: wall ball depth, lunge stride, row mechanics."};
  const stations=Math.min(8,Math.max(4,Math.round((2+w)*Math.min(vm,1.0))));
  const all=["SkiErg 1km","Wall Balls 100","Row 1km","Burpee BJ 80m","Sandbag Lunges 24","KB Carries 2×24m","Sled Pull 50m","Sled Push 50m"];
  return{type:"hyrox",title:`Hyrox Sim — ${stations} Stations`,sets:`${stations} × ${im>=1.1?"1km":"800m"} + ${stations} stations`,pace:im>=1.1?"Sub 7:45/mi":"Sub 8:00/mi",rest:"Transition only",hr:`160–${im>=1.1?172:168}`,notes:`${all.slice(0,stations).join(" → ")}.`};
}
function buildHeavyLift(w: number,vm: number,deload: boolean,raceWeek: boolean): Workout {
  if(raceWeek)return{type:"rest",title:"Rest Day",sets:"—",pace:"—",rest:"—",hr:"—",notes:"Legs up. Carb load 8–10g/kg. Hydrate."};
  if(deload)return{type:"strength",title:"Deload Lift",sets:"~55 min",pace:"—",rest:"2 min",hr:"—",notes:"65–70% max. 3×5 board. No PRs."};
  const h=vm>=1.2;
  return{type:"strength",title:`${h?"Peak":"Heavy"} Compound Day`,sets:`~${h?80:70} min`,pace:"—",rest:"2–3 min",hr:"—",notes:`DL ${h?5:4}×${h?4:5}, Bench 4×5, Clean 4×${h?3:4}, Pull-ups 4×5, Dips 3×10, ${h?"Broad Jumps 3×5":"Box Jumps 4×5"}.`};
}
function buildLongRun(w: number,vm: number,deload: boolean,raceWeek: boolean): Workout {
  if(raceWeek)return{type:"rest",title:"Post-Race Recovery",sets:"—",pace:"—",rest:"—",hr:"—",notes:"Walk, stretch, eat everything. Compression socks. 🎉"};
  const base=deload?55:[70,75,80,55,85,85,55,0][w-1]||70;
  const mins=Math.max(40,Math.round(base*Math.min(vm,1.0)));
  return{type:"longrun",title:"Long Aerobic Run",sets:`${mins} min`,pace:deload?"9:30–10:15/mi":"8:45–9:30/mi",rest:"—",hr:"140–162",notes:`Z2 first ${Math.round(mins*0.7)} min, Z3 drift final ${Math.round(mins*0.3)} min.`};
}

function processFeedback(fb: Feedback) {
  const {rpe=5,hrAvg=null,hrTarget=null,completed="yes",notes=""}=fb;
  let fatigue=rpe, performance=10-rpe+2;
  if(hrAvg&&hrTarget){const d=hrAvg-hrTarget;if(d>8){fatigue+=1.5;performance-=1;}else if(d<-8){fatigue-=1;performance+=1;}}
  if(completed==="partial"){fatigue+=1;performance-=1;}
  if(completed==="no"){fatigue+=2;performance-=2;}
  ["exhausted","sore","struggled","dying","heavy","tired"].forEach(k=>{if(notes.toLowerCase().includes(k))fatigue+=0.5;});
  ["strong","easy","felt great","crushed","solid","good"].forEach(k=>{if(notes.toLowerCase().includes(k)){fatigue-=0.3;performance+=0.3;}});
  return{fatigue:Math.max(1,Math.min(10,Math.round(fatigue*10)/10)),performance:Math.max(1,Math.min(10,Math.round(performance*10)/10))};
}

// ─── SYSTEM PROMPT ───────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an elite Hyrox and endurance coach working with Johnny (Jonathan Wu), a highly driven athlete.

ATHLETE PROFILE:
- Hyrox target: Sub 1:25 finish
- Threshold HR: 168 bpm
- Z2 range: 135–148 bpm
- Current running paces: threshold ~7:20–7:30/mi, sub-threshold ~7:45–8:15/mi, Z2 9:00–10:00/mi
- SkiErg 1km benchmark: 4:20–4:30
- Row 1km benchmark: 4:10–4:30
- Sled push/pull: highest variance station
- Weekly structure: Mon threshold / Tue strength+stations / Wed sub-thresh or vest / Thu Z2 / Fri Hyrox sim / Sat heavy lift / Sun long run
- Training program: configurable (default 8 weeks). Deloads auto-placed at midpoint and penultimate week. Final week is race week.
- Also training for sub-3:40 marathon and Hyrox dual-discipline
- 12-handicap golfer (plays Mon/Tue/Thu/Fri off-season)

WORKOUT ADJUSTMENT CAPABILITIES:
When asked to adjust a specific workout, respond with a JSON block EXACTLY in this format (plus any explanation after):
<WORKOUT_UPDATE>
{
  "type": "workout",
  "title": "New workout title",
  "sets": "e.g. 5 × 1000m",
  "pace": "e.g. 7:30–7:45/mi",
  "rest": "e.g. 90 sec",
  "hr": "e.g. 160–168",
  "notes": "Coaching notes here"
}
</WORKOUT_UPDATE>

When asked to adjust overall progression (e.g. make the whole plan easier/harder, shift deload weeks, modify weekly volume), respond with a JSON block:
<PROGRESSION_UPDATE>
{
  "type": "progression",
  "weeklyAdjustments": {
    "1": { "fatigueOverride": 3, "performanceOverride": 7 },
    "2": { "fatigueOverride": 3, "performanceOverride": 7 }
  },
  "message": "Human-readable explanation of changes"
}
</PROGRESSION_UPDATE>

Be direct, data-driven, and specific. Use bpm numbers, pace targets, and rep counts.
Keep explanations concise (3–5 sentences max unless asked for more).
Always explain the physiological reason for any adjustment.`;

// ─── PARSE AI RESPONSE ───────────────────────────────────────────────────────
function parseAIResponse(text: string): ParsedResponse {
  const workoutMatch = text.match(/<WORKOUT_UPDATE>([\s\S]*?)<\/WORKOUT_UPDATE>/);
  const progressionMatch = text.match(/<PROGRESSION_UPDATE>([\s\S]*?)<\/PROGRESSION_UPDATE>/);
  let workoutUpdate: Workout | null = null, progressionUpdate: ParsedResponse["progressionUpdate"] = null;
  if (workoutMatch) { try { workoutUpdate = JSON.parse(workoutMatch[1].trim()); } catch{/* ignore */} }
  if (progressionMatch) { try { progressionUpdate = JSON.parse(progressionMatch[1].trim()); } catch{/* ignore */} }
  const cleanText = text.replace(/<WORKOUT_UPDATE>[\s\S]*?<\/WORKOUT_UPDATE>/g,"").replace(/<PROGRESSION_UPDATE>[\s\S]*?<\/PROGRESSION_UPDATE>/g,"").trim();
  return { cleanText, workoutUpdate, progressionUpdate };
}

// ─── HR ZONE CALCULATORS ──────────────────────────────────────────────────────
function zonesFromMaxHr(maxHr: number): HRZones {
  // Standard zone percentages based on %maxHR (Karvonen-aligned)
  const thresholdHr = Math.round(maxHr * 0.908); // ~90.8% of max (LT2)
  return {
    maxHr,
    thresholdHr,
    z5Low: thresholdHr,                            // Z5 starts at threshold
    z5High: Math.round(maxHr * 0.984),             // Z5 top ~98% max
    z3Low: Math.round(maxHr * 0.73),               // Z3 low ~73% max
    z3High: Math.round(maxHr * 0.838),             // Z3 high ~84% max
    z2Max: Math.round(maxHr * 0.73),               // Z2 ceiling = Z3 floor
  };
}

function zonesFromThreshold(thr: number, currentMax: number): HRZones {
  // Derive max from threshold (~90.8% of max), or keep current max if it's higher
  const derivedMax = Math.round(thr / 0.908);
  const maxHr = Math.max(derivedMax, currentMax > thr ? currentMax : derivedMax);
  return {
    maxHr,
    thresholdHr: thr,
    z5Low: thr,
    z5High: Math.round(maxHr * 0.984),
    z3Low: Math.round(maxHr * 0.73),
    z3High: Math.round(maxHr * 0.838),
    z2Max: Math.round(maxHr * 0.73),
  };
}

// ─── MAIN APP ────────────────────────────────────────────────────────────────
// ─── LOCALSTORAGE HELPERS ─────────────────────────────────────────────────────
interface HRZones {
  maxHr: number;
  thresholdHr: number;
  z5Low: number;
  z5High: number;
  z3Low: number;
  z3High: number;
  z2Max: number;
}

const DEFAULT_HR_ZONES: HRZones = {
  maxHr: 185,
  thresholdHr: 168,
  z5Low: 168,
  z5High: 182,
  z3Low: 135,
  z3High: 155,
  z2Max: 135,
};

interface AppSettings {
  startDate: Date;
  programWeeks: number;
  hrZones: HRZones;
  themeMode: "dark" | "light";
}

function loadSettings(): AppSettings {
  if (typeof window === "undefined") return { startDate: DEFAULT_START_DATE, programWeeks: DEFAULT_PROGRAM_WEEKS, hrZones: DEFAULT_HR_ZONES, themeMode: "dark" };
  try {
    const raw = localStorage.getItem("hyrox-settings");
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        startDate: new Date(parsed.startDate),
        programWeeks: parsed.programWeeks || DEFAULT_PROGRAM_WEEKS,
        hrZones: parsed.hrZones ? { ...DEFAULT_HR_ZONES, ...parsed.hrZones } : DEFAULT_HR_ZONES,
        themeMode: parsed.themeMode || "dark",
      };
    }
  } catch { /* ignore */ }
  return { startDate: DEFAULT_START_DATE, programWeeks: DEFAULT_PROGRAM_WEEKS, hrZones: DEFAULT_HR_ZONES, themeMode: "dark" };
}

function saveSettings(startDate: Date, programWeeks: number, hrZones: HRZones, themeMode: "dark" | "light" = "dark") {
  localStorage.setItem("hyrox-settings", JSON.stringify({ startDate: startDate.toISOString(), programWeeks, hrZones, themeMode }));
}

export default function HyroxCalendar() {
  const [view, setView] = useState("calendar");
  const [currentMonth, setCurrentMonth] = useState(2);
  const [currentYear, setCurrentYear] = useState(2026);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [workoutLog, setWorkoutLog] = useState<Record<string, LogEntry>>({});
  const [workoutOverrides, setWorkoutOverrides] = useState<Record<string, Workout>>({});
  const [progressionOverrides, setProgressionOverrides] = useState<Record<number, { fatigueOverride?: number; performanceOverride?: number }>>({});
  const [feedbackModal, setFeedbackModal] = useState<string | null>(null);
  const [feedbackForm, setFeedbackForm] = useState({rpe:5,completed:"yes",notes:"",hrAvg:"",hrMax:"",paceAvg:""});
  // Settings state
  const [startDate, setStartDate] = useState<Date>(DEFAULT_START_DATE);
  const [programWeeks, setProgramWeeks] = useState(DEFAULT_PROGRAM_WEEKS);
  const [hrZones, setHrZones] = useState<HRZones>(DEFAULT_HR_ZONES);
  const [themeMode, setThemeMode] = useState<"dark"|"light">("dark");
  const t = themeMode === "dark" ? DARK_THEME : LIGHT_THEME;
  const isDark = themeMode === "dark";
  // Chat state
  const [chatMode, setChatMode] = useState("day"); // "day" | "plan"
  const [dayMessages, setDayMessages] = useState<Record<string, ChatMessage[]>>({});
  const [planMessages, setPlanMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [showMobileChat, setShowMobileChat] = useState(false);
  const [calendarMode, setCalendarMode] = useState<"month"|"week"|"day">("month");
  const [focusDate, setFocusDate] = useState<Date>(new Date()); // for week/day navigation
  const chatEndRef = useRef<HTMLDivElement>(null);
  const bp = useBreakpoint();

  // Load settings from localStorage on mount
  useEffect(() => {
    const s = loadSettings();
    setStartDate(s.startDate);
    setProgramWeeks(s.programWeeks);
    setHrZones(s.hrZones);
    setThemeMode(s.themeMode);
    setCurrentMonth(s.startDate.getMonth());
    setCurrentYear(s.startDate.getFullYear());
  }, []);

  // Keyboard shortcuts: D/W/M for calendar modes
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't fire when typing in inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === "d" || e.key === "D") { setCalendarMode("day"); setView("calendar"); setSelectedDate(null); }
      if (e.key === "w" || e.key === "W") { setCalendarMode("week"); setView("calendar"); setSelectedDate(null); }
      if (e.key === "m" || e.key === "M") { setCalendarMode("month"); setView("calendar"); setSelectedDate(null); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const totalDays = programWeeks * 7 + 1; // +1 for opening Sunday

  useEffect(() => { chatEndRef.current?.scrollIntoView({behavior:"smooth"}); });

  const dateKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  const keyToDate = (k: string) => { const [y,m,d]=k.split("-").map(Number); return new Date(y,m-1,d); };

  function getWorkoutForDate(date: Date, ignoreOverride=false): (Workout & { weekNum: number; dayIndex: number; key: string; isOverridden?: boolean }) | null {
    const dayIndex = (date.getDay()+6)%7;
    const diff = Math.floor((date.getTime()-startDate.getTime())/86400000);
    if (diff<0||diff>=totalDays) return null;
    const weekNum = Math.floor(diff/7)+1;
    const key = dateKey(date);
    if (!ignoreOverride && workoutOverrides[key]) {
      return { ...workoutOverrides[key], weekNum, dayIndex, key, isOverridden: true };
    }
    const log = workoutLog[key];
    const adj = log?.adjustments || {};
    const progAdj = progressionOverrides[weekNum] || {};
    const mergedAdj: Adjustments = {
      ...adj,
      ...(progAdj.fatigueOverride !== undefined ? {fatigue: progAdj.fatigueOverride} : {}),
      ...(progAdj.performanceOverride !== undefined ? {performance: progAdj.performanceOverride} : {}),
    };
    return { ...generateWorkout(dayIndex, weekNum, mergedAdj, programWeeks), weekNum, dayIndex, key };
  }

  function getWeekNumber(date: Date): number | null {
    const diff = Math.floor((date.getTime()-startDate.getTime())/86400000);
    if (diff<0||diff>=totalDays) return null;
    return Math.floor(diff/7)+1;
  }

  function buildCalendarDays(month: number, year: number) {
    const firstDay = new Date(year,month,1).getDay();
    const daysInMonth = new Date(year,month+1,0).getDate();
    const offset = (firstDay+6)%7;
    const days: (Date | null)[] = [];
    for(let i=0;i<offset;i++) days.push(null);
    for(let d=1;d<=daysInMonth;d++) days.push(new Date(year,month,d));
    return days;
  }

  function submitFeedback(dateStr: string) {
    const fb = {
      ...feedbackForm,
      hrAvg: feedbackForm.hrAvg?parseInt(feedbackForm.hrAvg):null,
      hrMax: feedbackForm.hrMax?parseInt(feedbackForm.hrMax):null,
      paceAvg: feedbackForm.paceAvg||undefined,
    };
    const workout = getWorkoutForDate(keyToDate(dateStr));
    const hrTarget = workout?.hr ? parseInt(workout.hr.split("–")[1])-5 : null;
    const adj = processFeedback({...fb, hrTarget, rpe: fb.rpe, completed: fb.completed, notes: fb.notes});
    setWorkoutLog(prev=>({...prev,[dateStr]:{...prev[dateStr],status:fb.completed,feedback:fb,adjustments:adj}}));
    setFeedbackModal(null);
    setFeedbackForm({rpe:5,completed:"yes",notes:"",hrAvg:"",hrMax:"",paceAvg:""});
  }

  // ── AI CHAT (via server-side proxy) ───────────────────────────────────────
  async function sendMessage(mode: string, userText: string, dateStr: string | null = null) {
    if (!userText.trim()) return;
    setChatLoading(true);
    setChatInput("");

    const workout = dateStr ? getWorkoutForDate(keyToDate(dateStr)) : null;
    const log = dateStr ? workoutLog[dateStr] : null;

    // Build context
    let contextBlock = "";
    if (mode==="day" && workout) {
      contextBlock = `\n\nCURRENT WORKOUT CONTEXT:\nDate: ${dateStr}\nWeek: ${workout.weekNum}\nWorkout: ${workout.title}\nSets: ${workout.sets}\nPace: ${workout.pace}\nRest: ${workout.rest}\nHR target: ${workout.hr} bpm\nNotes: ${workout.notes}`;
      if (log?.feedback) contextBlock += `\n\nFEEDBACK LOGGED:\nRPE: ${log.feedback.rpe}/10\nStatus: ${log.feedback.completed}\nNotes: ${log.feedback.notes || "none"}\nAdjusted fatigue: ${log.adjustments?.fatigue}/10\nAdjusted performance: ${log.adjustments?.performance}/10`;
      if (workout.isOverridden) contextBlock += "\n\n(This workout has been manually overridden by a previous AI adjustment)";
    } else if (mode==="plan") {
      const overrideSummary = Object.keys(progressionOverrides).length > 0
        ? `Active progression overrides: ${JSON.stringify(progressionOverrides)}`
        : "No active progression overrides.";
      contextBlock = `\n\nPLAN CONTEXT:\nCurrent week: ${getWeekNumber(new Date()) || "pre-program"}\n${overrideSummary}\nLogged sessions: ${Object.values(workoutLog).filter(l=>l.status==="yes").length} completed, ${Object.values(workoutLog).filter(l=>l.status==="partial").length} partial, ${Object.values(workoutLog).filter(l=>l.status==="no").length} missed.`;
    }

    // Build message history
    const history = mode==="day"
      ? (dayMessages[dateStr!]||[]).map(m=>({role:m.role,content:m.content}))
      : planMessages.map(m=>({role:m.role,content:m.content}));

    const newUserMsg = { role:"user", content: userText + contextBlock };

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system: SYSTEM_PROMPT,
          messages: [...history, newUserMsg],
        }),
      });
      const data = await res.json();

      if (data.error) {
        throw new Error(data.error);
      }

      const rawText = data.content?.find((b: { type: string; text?: string }) => b.type==="text")?.text || "No response.";
      const parsed = parseAIResponse(rawText);

      const assistantMsg: ChatMessage = { role:"assistant", content: rawText, parsed };
      const userDisplay: ChatMessage  = { role:"user", content: userText };

      if (mode==="day" && dateStr) {
        setDayMessages(prev=>({...prev,[dateStr]:[...(prev[dateStr]||[]),userDisplay,assistantMsg]}));
        // Apply workout override if present
        if (parsed.workoutUpdate) {
          setWorkoutOverrides(prev=>({...prev,[dateStr]:{...parsed.workoutUpdate!,aiGenerated:true}}));
        }
      } else {
        setPlanMessages(prev=>[...prev, userDisplay, assistantMsg]);
        // Apply progression overrides
        if (parsed.progressionUpdate?.weeklyAdjustments) {
          setProgressionOverrides(prev=>({...prev,...Object.fromEntries(
            Object.entries(parsed.progressionUpdate!.weeklyAdjustments).map(([k,v])=>[parseInt(k),v])
          )}));
        }
      }
    } catch(e: unknown) {
      const errorMessage = e instanceof Error ? e.message : "Connection error.";
      const errMsg: ChatMessage = {role:"assistant",content:errorMessage,parsed:{cleanText:errorMessage,workoutUpdate:null,progressionUpdate:null}};
      if(mode==="day" && dateStr) setDayMessages(prev=>({...prev,[dateStr]:[...(prev[dateStr]||[]),{role:"user",content:userText},errMsg]}));
      else setPlanMessages(prev=>[...prev,{role:"user",content:userText},errMsg]);
    }
    setChatLoading(false);
  }

  const today = new Date(); today.setHours(0,0,0,0);
  const statusColor = (s: string)=>s==="yes"?"#34D399":s==="partial"?"#FFE66D":s==="no"?"#F87171":null;
  const calDays = buildCalendarDays(currentMonth, currentYear);

  // ── CHAT PANEL ────────────────────────────────────────────────────────────
  function ChatPanel({ mode, dateStr }: { mode: string; dateStr?: string | null }) {
    const messages = mode==="day" ? (dayMessages[dateStr!]||[]) : planMessages;
    const hasOverride = dateStr && workoutOverrides[dateStr];

    const quickPrompts = mode==="day" ? [
      "Make this workout easier — I'm feeling fatigued",
      "Push the intensity — I'm feeling strong",
      "I only have 30 minutes — condense this",
      "Swap this for a vest stair stepper session",
      "What should I focus on for this workout?",
    ] : [
      "I'm running behind — compress weeks 5–6 intensity",
      "Add an extra deload — I'm feeling overtrained",
      "I want to peak harder before race week",
      "Make the Hyrox sims more progressive",
      "I have a race in 6 weeks not 8 — adjust",
    ];

    return (
      <div style={{display:"flex",flexDirection:"column",height:"100%",background:t.chatBg}}>
        {/* Mode toggle (only in day view) */}
        {dateStr && (
          <div style={{display:"flex",borderBottom:`1px solid ${t.border}`,flexShrink:0}}>
            {([["day","📅 This Workout"],["plan","📋 Full Plan"]] as const).map(([m,l])=>(
              <button key={m} onClick={()=>setChatMode(m)} style={{flex:1,padding:"10px 0",background:chatMode===m?t.bgInput:"transparent",border:"none",borderBottom:chatMode===m?"2px solid #FF6B35":"2px solid transparent",color:chatMode===m?t.text:t.textFaint,cursor:"pointer",fontSize:10,fontFamily:"Barlow Condensed",fontWeight:700,letterSpacing:"0.15em"}}>
                {l}
              </button>
            ))}
          </div>
        )}

        {/* Override badge */}
        {chatMode==="day" && hasOverride && (
          <div style={{padding:"6px 14px",background:isDark?"#FF6B3511":"#FF6B3518",borderBottom:"1px solid #FF6B3533",fontSize:9,color:"#FF6B35",letterSpacing:"0.12em",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
            <span>⚡ AI OVERRIDE ACTIVE</span>
            <button onClick={()=>setWorkoutOverrides(p=>{const n={...p};delete n[dateStr!];return n;})} style={{background:"none",border:"1px solid #FF6B3544",borderRadius:3,color:"#FF6B35",cursor:"pointer",padding:"2px 6px",fontSize:8}}>RESET</button>
          </div>
        )}
        {chatMode==="plan" && Object.keys(progressionOverrides).length>0 && (
          <div style={{padding:"6px 14px",background:"#C084FC11",borderBottom:"1px solid #C084FC33",fontSize:9,color:"#C084FC",letterSpacing:"0.12em",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
            <span>🔺 PROGRESSION OVERRIDES: {Object.keys(progressionOverrides).length} WEEK(S)</span>
            <button onClick={()=>setProgressionOverrides({})} style={{background:"none",border:"1px solid #C084FC44",borderRadius:3,color:"#C084FC",cursor:"pointer",padding:"2px 6px",fontSize:8}}>RESET ALL</button>
          </div>
        )}

        {/* Messages */}
        <div style={{flex:1,overflowY:"auto",padding:"14px 16px",display:"flex",flexDirection:"column",gap:10}}>
          {messages.length===0 && (
            <div style={{textAlign:"center",padding:"20px 10px"}}>
              <div style={{fontSize:24,marginBottom:10}}>{chatMode==="day"?"🎯":"📋"}</div>
              <div style={{fontFamily:"Barlow Condensed",fontSize:14,letterSpacing:"0.1em",color:t.textFaint,marginBottom:14}}>
                {chatMode==="day"?"ASK ABOUT THIS WORKOUT":"ASK ABOUT YOUR PLAN"}
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {quickPrompts.map((p,i)=>(
                  <button key={i} onClick={()=>sendMessage(chatMode,p,chatMode==="day"?dateStr??null:null)} style={{background:t.bgInput,border:`1px solid ${t.border}`,borderRadius:4,color:t.textMuted,cursor:"pointer",padding:"7px 10px",fontSize:12,fontFamily:"DM Mono",textAlign:"left",lineHeight:1.4}}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => {
            const isUser = msg.role==="user";
            const parsed = msg.parsed;
            return (
              <div key={i} style={{display:"flex",justifyContent:isUser?"flex-end":"flex-start"}}>
                <div style={{maxWidth:"88%",background:isUser?(isDark?"#FF6B3522":"#FF6B3518"):t.bgInput,border:`1px solid ${isUser?"#FF6B3544":t.border}`,borderRadius:isUser?"8px 8px 2px 8px":"8px 8px 8px 2px",padding:"10px 13px"}}>
                  {!isUser && parsed && (
                    <>
                      <div style={{fontSize:13,color:t.textSecondary,lineHeight:1.75,whiteSpace:"pre-wrap"}}>{parsed.cleanText}</div>
                      {parsed.workoutUpdate && (
                        <div style={{marginTop:10,padding:"10px 12px",background:isDark?"#FF6B3511":"#FF6B3518",border:"1px solid #FF6B3533",borderRadius:4}}>
                          <div style={{fontSize:9,color:"#FF6B35",letterSpacing:"0.15em",marginBottom:6}}>⚡ WORKOUT UPDATED</div>
                          <div style={{fontSize:12,color:t.textMuted,lineHeight:1.7}}>
                            <div><span style={{color:t.textFaint}}>Title: </span>{parsed.workoutUpdate.title}</div>
                            <div><span style={{color:t.textFaint}}>Sets: </span>{parsed.workoutUpdate.sets}</div>
                            <div><span style={{color:t.textFaint}}>Pace: </span>{parsed.workoutUpdate.pace}</div>
                            <div><span style={{color:t.textFaint}}>HR: </span>{parsed.workoutUpdate.hr} bpm</div>
                          </div>
                        </div>
                      )}
                      {parsed.progressionUpdate && (
                        <div style={{marginTop:10,padding:"10px 12px",background:isDark?"#C084FC11":"#C084FC18",border:"1px solid #C084FC33",borderRadius:4}}>
                          <div style={{fontSize:9,color:"#C084FC",letterSpacing:"0.15em",marginBottom:6}}>🔺 PROGRESSION UPDATED</div>
                          <div style={{fontSize:12,color:t.textMuted,lineHeight:1.7}}>
                            Weeks adjusted: {Object.keys(parsed.progressionUpdate.weeklyAdjustments||{}).join(", ")}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                  {isUser && <div style={{fontSize:13,color:isDark?"#FFB899":"#C04400",lineHeight:1.6}}>{msg.content}</div>}
                </div>
              </div>
            );
          })}

          {chatLoading && (
            <div style={{display:"flex",gap:4,padding:"10px 14px",alignItems:"center"}}>
              {[0,1,2].map(i=>(
                <div key={i} style={{width:5,height:5,borderRadius:"50%",background:"#FF6B35",animation:"bounce 1s infinite",animationDelay:`${i*0.2}s`}} />
              ))}
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input */}
        <div style={{borderTop:`1px solid ${t.border}`,padding:"12px 14px",flexShrink:0}}>
          <div style={{display:"flex",gap:8,alignItems:"flex-end"}}>
            <textarea
              value={chatInput}
              onChange={e=>setChatInput(e.target.value)}
              onKeyDown={e=>{ if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMessage(chatMode,chatInput,chatMode==="day"?dateStr??null:null);}}}
              placeholder={chatMode==="day"?"Ask about this workout or request changes…":"Ask about your overall plan…"}
              rows={2}
              style={{flex:1,background:t.bgInput,border:`1px solid ${t.borderFocus}`,borderRadius:6,color:t.textSecondary,padding:"8px 12px",fontSize:13,fontFamily:"DM Mono",outline:"none",resize:"none",lineHeight:1.5}}
            />
            <button
              onClick={()=>sendMessage(chatMode,chatInput,chatMode==="day"?dateStr??null:null)}
              disabled={chatLoading||!chatInput.trim()}
              style={{background:chatInput.trim()?"#FF6B35":t.border,border:"none",borderRadius:6,color:chatInput.trim()?(isDark?"#0A0A0A":"#FFF"):t.textGhost,cursor:chatInput.trim()?"pointer":"default",padding:"10px 14px",fontFamily:"Barlow Condensed",fontWeight:900,fontSize:14,letterSpacing:"0.1em",minWidth:48,flexShrink:0}}
            >
              ↑
            </button>
          </div>
          <div style={{fontSize:8,color:t.textGhost,marginTop:5,letterSpacing:"0.1em"}}>ENTER TO SEND · SHIFT+ENTER FOR NEWLINE · {chatMode==="day"?"CHANGES APPLY TO THIS WORKOUT ONLY":"CHANGES AFFECT WHOLE PLAN"}</div>
        </div>
      </div>
    );
  }

  // ── DAY VIEW ──────────────────────────────────────────────────────────────
  function DayView({ date }: { date: Date }) {
    const workout = getWorkoutForDate(date);
    const key = dateKey(date);
    const log = workoutLog[key];
    const meta = workout ? TYPE_META[workout.type] : null;
    const wn = getWeekNumber(date);
    const isToday = dateKey(date)===dateKey(today);
    const isPast = date<today;

    if (!workout || !meta) return (
      <div style={{padding:60,textAlign:"center",color:t.textFaint}}>
        <div style={{fontSize:40,marginBottom:12}}>📅</div>
        <div style={{fontFamily:"Barlow Condensed",fontSize:18,letterSpacing:"0.1em"}}>Outside training window</div>
        <div style={{fontSize:13,marginTop:6,color:t.textFaint}}>Program: {startDate.toLocaleDateString("en-US",{month:"short",day:"numeric"})} – {new Date(startDate.getTime()+(programWeeks*7)*86400000).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}</div>
        <button onClick={()=>setSelectedDate(null)} style={{marginTop:20,background:"none",border:`1px solid ${t.borderFocus}`,borderRadius:4,color:t.textFaint,cursor:"pointer",padding:"8px 18px",fontSize:11,fontFamily:"Barlow Condensed",letterSpacing:"0.1em"}}>← BACK TO CALENDAR</button>
      </div>
    );

    return (
      <div style={bp.isMobile
        ? {display:"flex",flexDirection:"column",height:"calc(100vh - 44px)",overflow:"hidden"}
        : {display:"grid",gridTemplateColumns:`1fr ${bp.isTablet?"320px":"380px"}`,height:"calc(100vh - 56px)"}
      }>
        {/* Left: workout detail */}
        <div style={{overflowY:"auto",padding:bp.isMobile?"14px 12px":"20px 24px",flex:bp.isMobile?1:undefined}}>
          <div style={{display:"flex",alignItems:"center",gap:bp.isMobile?8:12,marginBottom:bp.isMobile?14:20}}>
            <button onClick={()=>setSelectedDate(null)} style={{background:"none",border:`1px solid ${t.border}`,borderRadius:4,color:t.textFaint,cursor:"pointer",padding:"5px 12px",fontSize:10,fontFamily:"Barlow Condensed",letterSpacing:"0.1em",flexShrink:0}}>← BACK</button>
            <div style={{fontFamily:"Barlow Condensed",fontSize:bp.isMobile?10:12,letterSpacing:"0.18em",color:t.textFaint,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
              WEEK {wn} // {bp.isMobile
                ? date.toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"}).toUpperCase()
                : date.toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"}).toUpperCase()}
              {isToday&&<span style={{marginLeft:8,color:"#FF6B35",fontSize:9}}>● TODAY</span>}
              {workout.isOverridden&&<span style={{marginLeft:8,color:"#C084FC",fontSize:9}}>⚡ AI MODIFIED</span>}
            </div>
          </div>

          {/* Main workout card */}
          <div style={{background:t.bgCard,border:`1px solid ${meta.color}44`,borderRadius:8,overflow:"hidden",marginBottom:14}}>
            <div style={{height:4,background:meta.color}} />
            <div style={{padding:bp.isMobile?"14px 14px":"18px 22px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:bp.isMobile?10:14,gap:8}}>
                <div style={{minWidth:0}}>
                  <div style={{fontSize:9,letterSpacing:"0.2em",color:t.textFaint,marginBottom:3}}>{meta.icon} {meta.label}</div>
                  <div style={{fontFamily:"Barlow Condensed",fontSize:bp.isMobile?22:28,fontWeight:900,color:t.text,lineHeight:1}}>{workout.title}</div>
                </div>
                {log?.status&&<div style={{background:statusColor(log.status)+"22",border:`1px solid ${statusColor(log.status)}`,borderRadius:4,padding:"3px 9px",fontSize:9,color:statusColor(log.status)!,letterSpacing:"0.1em",whiteSpace:"nowrap",flexShrink:0}}>{log.status==="yes"?"✓ DONE":log.status==="partial"?"½ PARTIAL":"✗ MISSED"}</div>}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:bp.isMobile?6:8,marginBottom:bp.isMobile?10:14}}>
                {([["SETS",workout.sets],["PACE",workout.pace],["REST",workout.rest],["HR (bpm)",workout.hr]] as const).map(([l,v])=>(
                  <div key={l} style={{background:t.bgInput,borderRadius:4,padding:bp.isMobile?"7px 10px":"9px 12px"}}>
                    <div style={{fontSize:8,letterSpacing:"0.2em",color:t.textFaint,marginBottom:3}}>{l}</div>
                    <div style={{fontSize:bp.isMobile?12:13,color:t.textSecondary}}>{v}</div>
                  </div>
                ))}
              </div>
              <div style={{fontSize:bp.isMobile?12:13,color:t.textMuted,lineHeight:1.8,borderTop:`1px solid ${t.border}`,paddingTop:12}}>{workout.notes}</div>
            </div>
          </div>

          {/* Feedback */}
          {(isPast||isToday)&&(
            <div style={{background:t.bgCard,border:`1px solid ${t.border}`,borderRadius:8,padding:bp.isMobile?"12px 14px":"16px 18px",marginBottom:14}}>
              <div style={{fontFamily:"Barlow Condensed",fontSize:11,fontWeight:700,letterSpacing:"0.2em",color:t.textFaint,marginBottom:12}}>LOG WORKOUT</div>
              {log?.feedback?(
                <div>
                  <div style={{fontSize:12,color:t.textMuted,lineHeight:1.9}}>
                    <div><span style={{color:t.textFaint}}>RPE: </span>{log.feedback.rpe}/10</div>
                    <div><span style={{color:t.textFaint}}>Status: </span>{log.feedback.completed}</div>
                    {log.feedback.hrAvg&&<div><span style={{color:t.textFaint}}>Avg HR: </span>{log.feedback.hrAvg} bpm</div>}
                    {log.feedback.hrMax&&<div><span style={{color:t.textFaint}}>Max HR: </span>{log.feedback.hrMax} bpm</div>}
                    {log.feedback.paceAvg&&<div><span style={{color:t.textFaint}}>Avg Pace: </span>{log.feedback.paceAvg}/mi</div>}
                    {log.feedback.notes&&<div><span style={{color:t.textFaint}}>Notes: </span>{log.feedback.notes}</div>}
                    <div style={{marginTop:8,padding:"7px 10px",background:t.bgInput,borderRadius:4,fontSize:9,display:"flex",gap:16,flexWrap:"wrap"}}>
                      <span style={{color:"#FF6B35"}}>Fatigue {log.adjustments?.fatigue}/10</span>
                      <span style={{color:"#4ECDC4"}}>Perf {log.adjustments?.performance}/10</span>
                    </div>
                  </div>
                  <button onClick={()=>setFeedbackModal(key)} style={{marginTop:10,background:"none",border:`1px solid ${t.borderFocus}`,borderRadius:4,color:t.textFaint,cursor:"pointer",padding:"5px 10px",fontSize:9,fontFamily:"DM Mono",letterSpacing:"0.1em",width:"100%"}}>UPDATE</button>
                </div>
              ):(
                <button onClick={()=>setFeedbackModal(key)} style={{background:"#FF6B3522",border:"1px solid #FF6B35",borderRadius:4,color:"#FF6B35",cursor:"pointer",padding:"9px",fontSize:11,fontFamily:"Barlow Condensed",fontWeight:700,letterSpacing:"0.12em",width:"100%"}}>+ LOG THIS WORKOUT</button>
              )}
            </div>
          )}

          {/* Mobile: chat toggle button */}
          {bp.isMobile && (
            <button onClick={()=>setShowMobileChat(true)} style={{width:"100%",background:t.bgInput,border:`1px solid ${t.borderFocus}`,borderRadius:6,color:t.textMuted,cursor:"pointer",padding:"12px",fontSize:11,fontFamily:"Barlow Condensed",fontWeight:700,letterSpacing:"0.12em",marginBottom:14,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
              💬 ASK AI COACH
            </button>
          )}
        </div>

        {/* Right: chat — desktop/tablet inline, mobile fullscreen overlay */}
        {bp.isMobile ? (
          showMobileChat && (
            <div className="mobile-chat-overlay">
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",borderBottom:`1px solid ${t.border}`,flexShrink:0}}>
                <div style={{fontFamily:"Barlow Condensed",fontSize:12,fontWeight:700,letterSpacing:"0.15em",color:t.textMuted}}>AI COACH</div>
                <button onClick={()=>setShowMobileChat(false)} style={{background:"none",border:`1px solid ${t.borderFocus}`,borderRadius:4,color:t.textFaint,cursor:"pointer",padding:"4px 10px",fontSize:10,fontFamily:"Barlow Condensed"}}>✕ CLOSE</button>
              </div>
              <div style={{flex:1,overflow:"hidden"}}><ChatPanel mode={chatMode} dateStr={key} /></div>
            </div>
          )
        ) : (
          <div style={{borderLeft:`1px solid ${t.border}`,display:"flex",flexDirection:"column",height:"100%"}}>
            <ChatPanel mode={chatMode} dateStr={key} />
          </div>
        )}
      </div>
    );
  }

  // ── RENDER ────────────────────────────────────────────────────────────────
  return (
    <div style={{fontFamily:"'DM Mono','Courier New',monospace",background:t.bg,minHeight:"100vh",color:t.text,fontSize:13}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Barlow+Condensed:wght@700;900&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:3px;height:3px;}
        ::-webkit-scrollbar-thumb{background:${t.scrollThumb};border-radius:2px;}
        .cal-day:hover{border-color:#FF6B35!important;cursor:pointer;}
        .cal-day{transition:all 0.15s ease;}
        @keyframes bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
        @media(max-width:639px){
          .hide-mobile{display:none!important;}
          .mobile-chat-overlay{position:fixed;inset:0;z-index:90;background:${t.chatBg};display:flex;flex-direction:column;}
        }
      `}</style>

      {/* Top bar */}
      <div style={{borderBottom:`1px solid ${t.border}`,padding:bp.isMobile?"8px 10px":"10px 22px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:bp.isMobile?4:8,minHeight:bp.isMobile?44:56,flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:bp.isMobile?4:12,flexShrink:0}}>
          <div style={{fontFamily:"Barlow Condensed",fontSize:bp.isMobile?18:26,fontWeight:900,color:"#FF6B35",letterSpacing:"0.08em",cursor:"pointer"}} onClick={()=>{setView("calendar");setSelectedDate(null);}}>HYROX</div>
          {!bp.isMobile && <div style={{fontFamily:"Barlow Condensed",fontSize:10,letterSpacing:"0.2em",color:t.textGhost}}>ADAPTIVE TRAINING CALENDAR</div>}
        </div>
        <div style={{display:"flex",gap:bp.isMobile?3:10,alignItems:"center",flexWrap:bp.isMobile?"nowrap":"wrap",overflow:bp.isMobile?"auto":"visible"}}>
          {/* Theme toggle — icon only on mobile */}
          <button
            onClick={()=>{const next=isDark?"light":"dark";setThemeMode(next);saveSettings(startDate,programWeeks,hrZones,next);}}
            style={{background:t.bgInput,border:`1px solid ${t.borderFocus}`,borderRadius:4,color:t.textFaint,cursor:"pointer",padding:bp.isMobile?"4px 6px":"5px 12px",fontSize:bp.isMobile?12:9,fontFamily:"Barlow Condensed",fontWeight:700,letterSpacing:"0.15em",flexShrink:0}}
            title={`Switch to ${isDark?"light":"dark"} mode`}
          >
            {bp.isMobile?(isDark?"☀":"●"):(isDark?"☀ LIGHT":"● DARK")}
          </button>
          {/* D/W/M view switcher */}
          <div style={{display:"flex",gap:1,background:t.bgInput,borderRadius:4,padding:1,border:`1px solid ${t.borderFocus}`,flexShrink:0}}>
            {(["day","week","month"] as const).map(mode=>{
              const label=mode[0].toUpperCase();
              const active=view==="calendar"&&calendarMode===mode;
              return(
                <button key={mode} onClick={()=>{setCalendarMode(mode);setView("calendar");setSelectedDate(null);}} style={{
                  background:active?"#FF6B3522":"transparent",border:"none",borderRadius:3,
                  color:active?"#FF6B35":t.textFaint,cursor:"pointer",padding:bp.isMobile?"4px 7px":"4px 10px",
                  fontSize:bp.isMobile?9:9,fontFamily:"Barlow Condensed",fontWeight:700,letterSpacing:"0.12em",
                }} title={`${mode} view (${label})`}>{label}</button>
              );
            })}
          </div>
          <button
            onClick={()=>{setSelectedDate(null);setChatMode("plan");setView("planchat");}}
            style={{background:view==="planchat"?"#C084FC22":t.bgInput,border:`1px solid ${view==="planchat"?"#C084FC":t.borderFocus}`,borderRadius:4,color:view==="planchat"?"#C084FC":t.textFaint,cursor:"pointer",padding:bp.isMobile?"4px 7px":"5px 12px",fontSize:bp.isMobile?9:9,fontFamily:"Barlow Condensed",fontWeight:700,letterSpacing:"0.15em",flexShrink:0}}
          >
            📋 {bp.isMobile?"":"ADJUST FULL PLAN"}
          </button>
          <button
            onClick={()=>{setSelectedDate(null);setView("settings");}}
            style={{background:view==="settings"?"#60A5FA22":t.bgInput,border:`1px solid ${view==="settings"?"#60A5FA":t.borderFocus}`,borderRadius:4,color:view==="settings"?"#60A5FA":t.textFaint,cursor:"pointer",padding:bp.isMobile?"4px 7px":"5px 12px",fontSize:bp.isMobile?9:9,fontFamily:"Barlow Condensed",fontWeight:700,letterSpacing:"0.15em",flexShrink:0}}
          >
            ⚙{bp.isMobile?"":" SETTINGS"}
          </button>
          {!bp.isMobile && (
            <div style={{fontSize:9,color:t.textGhost,letterSpacing:"0.1em"}}>
              {Object.values(workoutLog).filter(l=>l.status==="yes").length} DONE ·&nbsp;
              {Object.keys(progressionOverrides).length} WK OVERRIDES ·&nbsp;
              {Object.keys(workoutOverrides).length} DAY OVERRIDES
            </div>
          )}
        </div>
      </div>

      {/* Plan-level chat view */}
      {view==="planchat" && !selectedDate && (
        <div style={bp.isMobile
          ? {display:"flex",flexDirection:"column",height:"calc(100vh - 44px)"}
          : {display:"grid",gridTemplateColumns:`1fr ${bp.isTablet?"320px":"420px"}`,height:"calc(100vh - 56px)"}
        }>
          <div style={{overflowY:"auto",padding:bp.isMobile?"14px 12px":"20px 24px",flex:bp.isMobile?1:undefined}}>
            <div style={{display:"flex",alignItems:"center",gap:bp.isMobile?8:12,marginBottom:bp.isMobile?12:18}}>
              <button onClick={()=>setView("calendar")} style={{background:"none",border:`1px solid ${t.border}`,borderRadius:4,color:t.textFaint,cursor:"pointer",padding:"5px 12px",fontSize:10,fontFamily:"Barlow Condensed",letterSpacing:"0.1em"}}>← CALENDAR</button>
              <div style={{fontFamily:"Barlow Condensed",fontSize:bp.isMobile?13:16,fontWeight:900,letterSpacing:"0.15em",color:"#C084FC"}}>FULL PLAN{!bp.isMobile && " ADJUSTMENTS"}</div>
            </div>
            {/* Week overview */}
            <div style={{display:"grid",gridTemplateColumns:bp.isMobile?"repeat(2,1fr)":"repeat(4,1fr)",gap:bp.isMobile?6:8}}>
              {Array.from({length:programWeeks},(_,i)=>i+1).map(w=>{
                const p=weekProfile(w, programWeeks);
                const po=progressionOverrides[w];
                return(
                  <div key={w} style={{background:t.bgCard,border:`1px solid ${po?"#C084FC33":p.deload?"#4ECDC433":p.raceWeek?"#FF6B3544":t.border}`,borderRadius:6,padding:bp.isMobile?"10px 10px":"12px 14px"}}>
                    <div style={{fontFamily:"Barlow Condensed",fontSize:bp.isMobile?10:11,fontWeight:700,letterSpacing:"0.1em",color:p.deload?"#4ECDC4":p.raceWeek?"#FF6B35":t.textMuted,marginBottom:bp.isMobile?4:6}}>
                      WK {w} {p.deload?"/ DELOAD":p.raceWeek?"/ RACE":""}
                    </div>
                    <div style={{fontSize:9,color:t.textFaint,lineHeight:1.7}}>
                      <div>Vol ×{Math.round(p.volMultiplier*100)}%</div>
                      <div>Int ×{Math.round(p.intMultiplier*100)}%</div>
                    </div>
                    {po&&(
                      <div style={{marginTop:6,padding:"4px 6px",background:"#C084FC11",borderRadius:3,fontSize:8,color:"#C084FC"}}>
                        F:{po.fatigueOverride} P:{po.performanceOverride}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Mobile: chat toggle button */}
            {bp.isMobile && (
              <button onClick={()=>setShowMobileChat(true)} style={{width:"100%",background:t.bgInput,border:"1px solid #C084FC44",borderRadius:6,color:"#C084FC",cursor:"pointer",padding:"12px",fontSize:11,fontFamily:"Barlow Condensed",fontWeight:700,letterSpacing:"0.12em",marginTop:12,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
                💬 ASK ABOUT PLAN
              </button>
            )}
          </div>
          {bp.isMobile ? (
            showMobileChat && (
              <div className="mobile-chat-overlay">
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",borderBottom:`1px solid ${t.border}`,flexShrink:0}}>
                  <div style={{fontFamily:"Barlow Condensed",fontSize:12,fontWeight:700,letterSpacing:"0.15em",color:"#C084FC"}}>PLAN CHAT</div>
                  <button onClick={()=>setShowMobileChat(false)} style={{background:"none",border:`1px solid ${t.borderFocus}`,borderRadius:4,color:t.textFaint,cursor:"pointer",padding:"4px 10px",fontSize:10,fontFamily:"Barlow Condensed"}}>✕ CLOSE</button>
                </div>
                <div style={{flex:1,overflow:"hidden"}}><ChatPanel mode="plan" /></div>
              </div>
            )
          ) : (
            <div style={{borderLeft:`1px solid ${t.border}`,height:"100%"}}>
              <ChatPanel mode="plan" />
            </div>
          )}
        </div>
      )}

      {/* Settings view */}
      {view==="settings" && !selectedDate && (()=>{
        const endDate = new Date(startDate.getTime() + (programWeeks * 7) * 86400000);
        const fmtDate = (d: Date) => d.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
        const inputDateStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
        const fieldStyle = {width:"100%",background:t.bgInput,border:`1px solid ${t.borderFocus}`,borderRadius:4,color:t.textSecondary,padding:"10px 12px",fontSize:13,fontFamily:"DM Mono",outline:"none" as const};
        const labelStyle = {fontSize:11,letterSpacing:"0.15em",color:t.textFaint,marginBottom:8,fontFamily:"Barlow Condensed" as const,fontWeight:700 as const};
        return (
          <div style={{maxWidth:600,margin:"0 auto",padding:bp.isMobile?"16px 14px":"28px 24px"}}>
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:24}}>
              <button onClick={()=>setView("calendar")} style={{background:"none",border:`1px solid ${t.border}`,borderRadius:4,color:t.textFaint,cursor:"pointer",padding:"6px 14px",fontSize:11,fontFamily:"Barlow Condensed",letterSpacing:"0.1em"}}>← CALENDAR</button>
              <div style={{fontFamily:"Barlow Condensed",fontSize:bp.isMobile?16:20,fontWeight:900,letterSpacing:"0.15em",color:"#60A5FA"}}>SETTINGS</div>
            </div>

            {/* Theme toggle */}
            <div style={{background:t.bgCard,border:`1px solid ${t.border}`,borderRadius:8,padding:bp.isMobile?"16px":"20px 22px",marginBottom:16}}>
              <div style={{fontFamily:"Barlow Condensed",fontSize:14,fontWeight:900,letterSpacing:"0.12em",color:t.text,marginBottom:16}}>APPEARANCE</div>
              <div style={{display:"flex",gap:8}}>
                {(["dark","light"] as const).map(mode=>(
                  <button key={mode} onClick={()=>{setThemeMode(mode);saveSettings(startDate,programWeeks,hrZones,mode);}} style={{
                    flex:1,padding:"12px",borderRadius:6,cursor:"pointer",fontSize:12,fontFamily:"Barlow Condensed",fontWeight:700,letterSpacing:"0.12em",
                    background:themeMode===mode?(mode==="dark"?"#FF6B3522":"#FF6B3522"):t.bgInput,
                    border:`1px solid ${themeMode===mode?"#FF6B35":t.borderFocus}`,
                    color:themeMode===mode?"#FF6B35":t.textFaint,
                  }}>
                    {mode==="dark"?"● DARK MODE":"☀ LIGHT MODE"}
                  </button>
                ))}
              </div>
            </div>

            {/* Program config */}
            <div style={{background:t.bgCard,border:`1px solid ${t.border}`,borderRadius:8,padding:bp.isMobile?"16px":"20px 22px",marginBottom:16}}>
              <div style={{fontFamily:"Barlow Condensed",fontSize:14,fontWeight:900,letterSpacing:"0.12em",color:t.text,marginBottom:16}}>PROGRAM</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>
                <div>
                  <div style={labelStyle}>START DATE</div>
                  <input type="date" value={inputDateStr(startDate)} onChange={e=>{
                    const d = new Date(e.target.value + "T00:00:00");
                    if(!isNaN(d.getTime())){setStartDate(d);saveSettings(d,programWeeks,hrZones,themeMode);setCurrentMonth(d.getMonth());setCurrentYear(d.getFullYear());}
                  }} style={fieldStyle} />
                </div>
                <div>
                  <div style={labelStyle}>PROGRAM WEEKS</div>
                  <select value={programWeeks} onChange={e=>{
                    const w=parseInt(e.target.value);setProgramWeeks(w);saveSettings(startDate,w,hrZones,themeMode);
                  }} style={{...fieldStyle,cursor:"pointer"}}>
                    {[4,5,6,7,8,9,10,11,12].map(w=><option key={w} value={w}>{w} weeks</option>)}
                  </select>
                </div>
              </div>
              <div style={{fontSize:12,color:t.textMuted,lineHeight:1.6}}>
                <span style={{color:t.textFaint}}>Window: </span>{fmtDate(startDate)} – {fmtDate(endDate)}
                <span style={{color:t.textGhost}}> · {programWeeks * 7 + 1} days</span>
              </div>
              <div style={{fontSize:11,color:t.textFaint,marginTop:8,lineHeight:1.5}}>
                Deloads auto-placed at week {Math.ceil(programWeeks/2)} and {programWeeks-1}. Race week: {programWeeks}.
              </div>
            </div>

            {/* HR Zones */}
            <div style={{background:t.bgCard,border:`1px solid ${t.border}`,borderRadius:8,padding:bp.isMobile?"16px":"20px 22px",marginBottom:16}}>
              <div style={{fontFamily:"Barlow Condensed",fontSize:14,fontWeight:900,letterSpacing:"0.12em",color:t.text,marginBottom:16}}>HR ZONES</div>

              {/* Auto-fill section */}
              <div style={{background:t.bgInput,borderRadius:6,padding:"14px 16px",marginBottom:16,border:`1px solid ${t.borderLight}`}}>
                <div style={{fontFamily:"Barlow Condensed",fontSize:11,letterSpacing:"0.12em",color:"#FF6B35",marginBottom:12}}>QUICK SETUP — auto-calculate zones</div>
                <div style={{display:"grid",gridTemplateColumns:bp.isMobile?"1fr":"1fr 1fr 1fr",gap:10,marginBottom:12}}>
                  <div>
                    <div style={{...labelStyle,fontSize:9}}>AGE</div>
                    <input type="number" placeholder="e.g. 30" onChange={e=>{
                      const age=parseInt(e.target.value);
                      if(!isNaN(age)&&age>10&&age<100){
                        const maxHr=220-age;
                        const zones=zonesFromMaxHr(maxHr);
                        setHrZones(zones);saveSettings(startDate,programWeeks,zones,themeMode);
                      }
                    }} style={{...fieldStyle,padding:"8px 10px",fontSize:12}} />
                  </div>
                  <div>
                    <div style={{...labelStyle,fontSize:9,color:"#F87171"}}>MAX HR</div>
                    <input type="number" placeholder={String(hrZones.maxHr)} onChange={e=>{
                      const maxHr=parseInt(e.target.value);
                      if(!isNaN(maxHr)&&maxHr>100&&maxHr<230){
                        const zones=zonesFromMaxHr(maxHr);
                        setHrZones(zones);saveSettings(startDate,programWeeks,zones,themeMode);
                      }
                    }} style={{...fieldStyle,padding:"8px 10px",fontSize:12}} />
                  </div>
                  <div>
                    <div style={{...labelStyle,fontSize:9,color:"#FF6B35"}}>THRESHOLD HR</div>
                    <input type="number" placeholder={String(hrZones.thresholdHr)} onChange={e=>{
                      const thr=parseInt(e.target.value);
                      if(!isNaN(thr)&&thr>100&&thr<230){
                        const zones=zonesFromThreshold(thr,hrZones.maxHr);
                        setHrZones(zones);saveSettings(startDate,programWeeks,zones,themeMode);
                      }
                    }} style={{...fieldStyle,padding:"8px 10px",fontSize:12}} />
                  </div>
                </div>
                <div style={{fontSize:10,color:t.textGhost,lineHeight:1.5}}>
                  Enter any value to auto-fill all zones. Fine-tune individual zones below.
                </div>
              </div>

              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
                {([
                  ["maxHr","MAX HR","#F87171"],
                  ["thresholdHr","THRESHOLD HR","#FF6B35"],
                  ["z5Low","ZONE 5 LOW","#F97316"],
                  ["z5High","ZONE 5 HIGH","#F97316"],
                  ["z3Low","ZONE 3 LOW","#FFE66D"],
                  ["z3High","ZONE 3 HIGH","#FFE66D"],
                  ["z2Max","ZONE 2 CEILING","#60A5FA"],
                ] as [keyof HRZones, string, string][]).map(([key,label,color])=>(
                  <div key={key}>
                    <div style={{...labelStyle,color}}>{label}</div>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <input type="number" value={hrZones[key]} onChange={e=>{
                        const val=parseInt(e.target.value);
                        if(!isNaN(val)&&val>0&&val<250){
                          const updated={...hrZones,[key]:val};
                          setHrZones(updated);
                          saveSettings(startDate,programWeeks,updated,themeMode);
                        }
                      }} style={{...fieldStyle,width:"100%"}} />
                      <span style={{fontSize:11,color:t.textFaint,flexShrink:0}}>bpm</span>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{marginTop:16,padding:"12px 14px",background:t.bgInput,borderRadius:6,fontSize:12,color:t.textMuted,lineHeight:1.7}}>
                <div style={{fontFamily:"Barlow Condensed",fontSize:11,letterSpacing:"0.1em",color:t.textFaint,marginBottom:6}}>ZONE SUMMARY</div>
                <div><span style={{color:"#60A5FA"}}>Z2:</span> &lt;{hrZones.z2Max} bpm ({Math.round(hrZones.z2Max/hrZones.maxHr*100)}% max)</div>
                <div><span style={{color:isDark?"#FFE66D":"#B8860B"}}>Z3:</span> {hrZones.z3Low}–{hrZones.z3High} bpm ({Math.round(hrZones.z3Low/hrZones.maxHr*100)}–{Math.round(hrZones.z3High/hrZones.maxHr*100)}%)</div>
                <div><span style={{color:"#F97316"}}>Z5:</span> {hrZones.z5Low}–{hrZones.z5High} bpm ({Math.round(hrZones.z5Low/hrZones.maxHr*100)}–{Math.round(hrZones.z5High/hrZones.maxHr*100)}%)</div>
                <div><span style={{color:"#FF6B35"}}>Threshold:</span> {hrZones.thresholdHr} bpm ({Math.round(hrZones.thresholdHr/hrZones.maxHr*100)}% max)</div>
                <div><span style={{color:"#F87171"}}>Max:</span> {hrZones.maxHr} bpm</div>
              </div>
            </div>

            {/* Reset */}
            <button onClick={()=>{
              setStartDate(DEFAULT_START_DATE);setProgramWeeks(DEFAULT_PROGRAM_WEEKS);setHrZones(DEFAULT_HR_ZONES);
              saveSettings(DEFAULT_START_DATE,DEFAULT_PROGRAM_WEEKS,DEFAULT_HR_ZONES,themeMode);
              setCurrentMonth(DEFAULT_START_DATE.getMonth());setCurrentYear(DEFAULT_START_DATE.getFullYear());
            }} style={{background:"none",border:`1px solid ${t.borderFocus}`,borderRadius:4,color:t.textFaint,cursor:"pointer",padding:"10px 18px",fontSize:11,fontFamily:"Barlow Condensed",fontWeight:700,letterSpacing:"0.12em",width:"100%"}}>
              RESET TO DEFAULTS
            </button>
          </div>
        );
      })()}

      {/* Calendar view */}
      {view==="calendar" && !selectedDate && (()=>{
        // Navigation helpers
        const navPrev = () => {
          if (calendarMode==="month") { if(currentMonth===0){setCurrentMonth(11);setCurrentYear(y=>y-1);}else setCurrentMonth(m=>m-1); }
          else if (calendarMode==="week") { setFocusDate(d=>new Date(d.getTime()-7*86400000)); }
          else { setFocusDate(d=>new Date(d.getTime()-86400000)); }
        };
        const navNext = () => {
          if (calendarMode==="month") { if(currentMonth===11){setCurrentMonth(0);setCurrentYear(y=>y+1);}else setCurrentMonth(m=>m+1); }
          else if (calendarMode==="week") { setFocusDate(d=>new Date(d.getTime()+7*86400000)); }
          else { setFocusDate(d=>new Date(d.getTime()+86400000)); }
        };
        const navToday = () => { const t=new Date();t.setHours(0,0,0,0);setFocusDate(t);setCurrentMonth(t.getMonth());setCurrentYear(t.getFullYear()); };

        // Week view: get Monday of the focus week
        const getWeekStart = (d: Date) => { const day=(d.getDay()+6)%7; return new Date(d.getTime()-day*86400000); };
        const weekStart = getWeekStart(focusDate);
        const weekDates = Array.from({length:7},(_,i)=>new Date(weekStart.getTime()+i*86400000));

        // Header label
        const headerLabel = calendarMode==="month"
          ? `${MONTHS[currentMonth].toUpperCase()} ${currentYear}`
          : calendarMode==="week"
          ? `${weekDates[0].toLocaleDateString("en-US",{month:"short",day:"numeric"})} – ${weekDates[6].toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}`
          : focusDate.toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"}).toUpperCase();

        const modeBtnStyle = (active: boolean) => ({
          background:active?"#FF6B3522":t.bgInput,border:`1px solid ${active?"#FF6B35":t.borderFocus}`,borderRadius:4,
          color:active?"#FF6B35":t.textFaint,cursor:"pointer" as const,padding:"4px 10px",fontSize:10,
          fontFamily:"Barlow Condensed",fontWeight:700 as const,letterSpacing:"0.12em",
        });

        // Shared day card renderer
        const renderDayCard = (date: Date, expanded: boolean) => {
          const workout=getWorkoutForDate(date);
          const key=dateKey(date);
          const log=workoutLog[key];
          const meta=workout?TYPE_META[workout.type]:null;
          const isTdy=key===dateKey(today);
          const wn=getWeekNumber(date);
          const hasOverride=!!workoutOverrides[key];

          if (expanded) {
            const isDay = calendarMode==="day";
            const isMobWeek = bp.isMobile && calendarMode==="week";

            // Mobile week view: compact horizontal row per day
            if (isMobWeek) {
              return (
                <div key={key} className="cal-day" onClick={()=>{setSelectedDate(date);setChatMode("day");setShowMobileChat(false);}} style={{border:"1px solid",borderColor:isTdy?"#FF6B35":t.border,borderRadius:8,padding:"10px 12px",background:isTdy?t.cardTodayBg:t.bgAlt,cursor:"pointer",display:"flex",gap:12,alignItems:"center"}}>
                  {/* Left: date column */}
                  <div style={{textAlign:"center",minWidth:38,flexShrink:0}}>
                    <div style={{fontFamily:"Barlow Condensed",fontSize:9,color:t.textGhost,letterSpacing:"0.1em",lineHeight:1}}>{DAYS[(date.getDay()+6)%7].toUpperCase()}</div>
                    <div style={{fontFamily:"Barlow Condensed",fontSize:22,fontWeight:900,color:isTdy?"#FF6B35":t.textMuted,lineHeight:1.1}}>{date.getDate()}</div>
                  </div>
                  {/* Color bar */}
                  {workout&&meta&&<div style={{width:3,alignSelf:"stretch",borderRadius:2,background:hasOverride?"#C084FC":meta.color,flexShrink:0}}/>}
                  {/* Right: workout info */}
                  <div style={{flex:1,minWidth:0}}>
                    {workout&&meta?(
                      <>
                        <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>
                          <span style={{fontSize:10,letterSpacing:"0.1em",color:meta.color}}>{meta.icon} {meta.label}</span>
                          {log?.status&&<div style={{marginLeft:"auto",background:statusColor(log.status)+"22",border:`1px solid ${statusColor(log.status)}`,borderRadius:3,padding:"1px 6px",fontSize:8,color:statusColor(log.status)!}}>{log.status==="yes"?"✓":log.status==="partial"?"½":"✗"}</div>}
                        </div>
                        <div style={{fontFamily:"Barlow Condensed",fontSize:15,fontWeight:900,color:t.text,lineHeight:1.1,marginBottom:4,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{workout.title}</div>
                        <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                          {[["SETS",workout.sets],["PACE",workout.pace],["HR",workout.hr]].map(([l,v])=>(
                            <div key={l}>
                              <span style={{fontSize:8,color:t.textFaint,letterSpacing:"0.08em"}}>{l} </span>
                              <span style={{fontSize:11,color:t.textMuted}}>{v}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    ):(
                      <div style={{fontSize:12,color:t.textGhost,fontStyle:"italic"}}>Rest / No workout</div>
                    )}
                  </div>
                  {/* Chevron */}
                  <div style={{color:t.textGhost,fontSize:14,flexShrink:0}}>›</div>
                </div>
              );
            }

            // Desktop week / day view: full expanded card
            return (
              <div key={key} className="cal-day" onClick={()=>{setSelectedDate(date);setChatMode("day");setShowMobileChat(false);}} style={{border:"1px solid",borderColor:isTdy?"#FF6B35":t.border,borderRadius:6,padding:"14px 16px",background:isTdy?t.cardTodayBg:t.bgAlt,position:"relative",cursor:"pointer",flex:1,minHeight:isDay?200:120}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                  <div style={{display:"flex",alignItems:"baseline",gap:8}}>
                    <div style={{fontFamily:"Barlow Condensed",fontSize:20,fontWeight:900,color:isTdy?"#FF6B35":t.textMuted,lineHeight:1}}>{date.getDate()}</div>
                    <div style={{fontFamily:"Barlow Condensed",fontSize:11,color:t.textGhost,letterSpacing:"0.1em"}}>{DAYS[(date.getDay()+6)%7].toUpperCase()}</div>
                    {wn&&<div style={{fontSize:9,color:t.textGhost,letterSpacing:"0.1em"}}>W{wn}</div>}
                  </div>
                  {log?.status&&<div style={{background:statusColor(log.status)+"22",border:`1px solid ${statusColor(log.status)}`,borderRadius:4,padding:"2px 8px",fontSize:9,color:statusColor(log.status)!,letterSpacing:"0.1em"}}>{log.status==="yes"?"✓ DONE":log.status==="partial"?"½ PARTIAL":"✗ MISSED"}</div>}
                </div>
                {workout&&meta&&(
                  <>
                    <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
                      <div style={{width:6,height:6,borderRadius:"50%",background:hasOverride?"#C084FC":meta.color}}/>
                      <span style={{fontSize:10,letterSpacing:"0.15em",color:meta.color}}>{meta.icon} {meta.label}</span>
                    </div>
                    <div style={{fontFamily:"Barlow Condensed",fontSize:isDay?24:18,fontWeight:900,color:t.text,lineHeight:1.1,marginBottom:8}}>{workout.title}</div>
                    <div style={{display:"flex",gap:isDay?16:10,flexWrap:"wrap",marginBottom:8}}>
                      {[["SETS",workout.sets],["PACE",workout.pace],["REST",workout.rest],["HR",workout.hr]].map(([l,v])=>(
                        <div key={l}>
                          <span style={{fontSize:9,color:t.textFaint,letterSpacing:"0.1em"}}>{l} </span>
                          <span style={{fontSize:12,color:t.textMuted}}>{v}</span>
                        </div>
                      ))}
                    </div>
                    <div style={{fontSize:12,color:t.textMuted,lineHeight:1.6}}>{workout.notes}</div>
                  </>
                )}
                {!workout&&<div style={{fontSize:12,color:t.textGhost,fontStyle:"italic"}}>No workout scheduled</div>}
              </div>
            );
          }

          // Compact card for month view
          return (
            <div key={date.toISOString()} className="cal-day" onClick={()=>{setSelectedDate(date);setChatMode("day");setShowMobileChat(false);}} style={{border:"1px solid",borderColor:isTdy?"#FF6B35":t.borderLight,borderRadius:bp.isMobile?3:5,minHeight:bp.isMobile?54:80,padding:bp.isMobile?"4px 4px 3px":"7px 7px 5px",background:isTdy?t.cardTodayBg:t.bgAlt,position:"relative",opacity:!workout&&!isTdy?0.35:1,cursor:"pointer"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:bp.isMobile?2:4}}>
                <div style={{fontFamily:"Barlow Condensed",fontSize:bp.isMobile?11:14,fontWeight:700,color:isTdy?"#FF6B35":t.textFaint,lineHeight:1}}>{date.getDate()}</div>
                {wn&&!bp.isMobile&&<div style={{fontSize:6,color:t.textGhost,letterSpacing:"0.1em"}}>W{wn}</div>}
              </div>
              {workout&&meta&&(
                <>
                  <div style={{display:"flex",alignItems:"center",gap:bp.isMobile?2:4,marginBottom:bp.isMobile?1:3}}>
                    <div style={{width:bp.isMobile?4:5,height:bp.isMobile?4:5,borderRadius:"50%",background:hasOverride?"#C084FC":meta.color,flexShrink:0}}/>
                    {hasOverride&&<div style={{width:bp.isMobile?3:4,height:bp.isMobile?3:4,borderRadius:"50%",background:"#C084FC55"}}/>}
                  </div>
                  {bp.isMobile ? (
                    <div style={{fontFamily:"Barlow Condensed",fontSize:7,fontWeight:700,color:t.textMuted,lineHeight:1.2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{meta.icon} {workout.title.length>10?workout.title.slice(0,9)+"…":workout.title}</div>
                  ) : (
                    <>
                      <div style={{fontFamily:"Barlow Condensed",fontSize:10,fontWeight:700,color:t.textMuted,lineHeight:1.2,marginBottom:3}}>{meta.icon} {workout.title.length>16?workout.title.slice(0,15)+"…":workout.title}</div>
                      <div style={{fontSize:9,color:t.textFaint,lineHeight:1.3}}>{workout.sets.length>13?workout.sets.slice(0,12)+"…":workout.sets}</div>
                    </>
                  )}
                  {log?.status&&<div style={{position:"absolute",top:bp.isMobile?3:5,right:bp.isMobile?3:5,width:bp.isMobile?5:7,height:bp.isMobile?5:7,borderRadius:"50%",background:statusColor(log.status)!}}/>}
                </>
              )}
            </div>
          );
        };

        return (
          <div style={{padding:bp.isMobile?"10px 8px":"18px 20px"}}>
            {/* Calendar header with mode switcher */}
            <div style={{marginBottom:bp.isMobile?10:16}}>
              {bp.isMobile ? (
                /* Mobile: compact 2-row layout */
                <>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                    <div style={{fontFamily:"Barlow Condensed",fontSize:16,fontWeight:900,letterSpacing:"0.1em",color:t.text}}>{headerLabel}</div>
                    <div style={{display:"flex",gap:3}}>
                      {([["day","D"],["week","W"],["month","M"]] as const).map(([mode,label])=>(
                        <button key={mode} onClick={()=>setCalendarMode(mode)} style={modeBtnStyle(calendarMode===mode)} title={`${mode} view (${label})`}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <button onClick={navPrev} style={{background:"none",border:`1px solid ${t.border}`,borderRadius:4,color:t.textFaint,cursor:"pointer",padding:"5px 12px",fontFamily:"Barlow Condensed",fontSize:14}}>‹</button>
                    <button onClick={navNext} style={{background:"none",border:`1px solid ${t.border}`,borderRadius:4,color:t.textFaint,cursor:"pointer",padding:"5px 12px",fontFamily:"Barlow Condensed",fontSize:14}}>›</button>
                    <button onClick={navToday} style={{background:"none",border:`1px solid ${t.border}`,borderRadius:4,color:t.textMuted,cursor:"pointer",padding:"5px 10px",fontFamily:"Barlow Condensed",fontSize:10,letterSpacing:"0.1em"}}>TODAY</button>
                  </div>
                </>
              ) : (
                /* Desktop: single row */
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <button onClick={navPrev} style={{background:"none",border:`1px solid ${t.border}`,borderRadius:4,color:t.textFaint,cursor:"pointer",padding:"5px 14px",fontFamily:"Barlow Condensed",fontSize:14}}>‹</button>
                    <button onClick={navNext} style={{background:"none",border:`1px solid ${t.border}`,borderRadius:4,color:t.textFaint,cursor:"pointer",padding:"5px 14px",fontFamily:"Barlow Condensed",fontSize:14}}>›</button>
                    <button onClick={navToday} style={{background:"none",border:`1px solid ${t.border}`,borderRadius:4,color:t.textMuted,cursor:"pointer",padding:"5px 12px",fontFamily:"Barlow Condensed",fontSize:10,letterSpacing:"0.1em"}}>TODAY</button>
                  </div>
                  <div style={{fontFamily:"Barlow Condensed",fontSize:18,fontWeight:900,letterSpacing:"0.12em",color:t.text}}>{headerLabel}</div>
                  <div style={{display:"flex",gap:3}}>
                    {([["day","D"],["week","W"],["month","M"]] as const).map(([mode,label])=>(
                      <button key={mode} onClick={()=>setCalendarMode(mode)} style={modeBtnStyle(calendarMode===mode)} title={`${mode} view (${label})`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* MONTH VIEW */}
            {calendarMode==="month" && (
              <>
                <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:bp.isMobile?2:3,marginBottom:bp.isMobile?2:3}}>
                  {DAYS.map(d=><div key={d} style={{textAlign:"center",fontSize:bp.isMobile?7:9,letterSpacing:"0.2em",color:t.textGhost,padding:"3px 0"}}>{bp.isMobile?d.charAt(0):d}</div>)}
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:bp.isMobile?2:3}}>
                  {calDays.map((date,i)=>{
                    if(!date)return<div key={i}/>;
                    return renderDayCard(date, false);
                  })}
                </div>
              </>
            )}

            {/* WEEK VIEW */}
            {calendarMode==="week" && (
              bp.isMobile ? (
                /* Mobile: vertical stack */
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {weekDates.map(date=>renderDayCard(date, true))}
                </div>
              ) : (
                /* Desktop/tablet: 7-column grid */
                <>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:6,marginBottom:4}}>
                    {DAYS.map(d=><div key={d} style={{textAlign:"center",fontSize:10,letterSpacing:"0.15em",color:t.textGhost,padding:"4px 0",fontFamily:"Barlow Condensed",fontWeight:700}}>{d}</div>)}
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:6}}>
                    {weekDates.map(date=>renderDayCard(date, true))}
                  </div>
                </>
              )
            )}

            {/* DAY VIEW (calendar day, not workout detail) */}
            {calendarMode==="day" && (
              <div style={{maxWidth:bp.isMobile?undefined:600}}>
                {renderDayCard(focusDate, true)}
              </div>
            )}

            {/* Legend */}
            {!bp.isMobile && (
              <div style={{marginTop:16,display:"flex",flexWrap:"wrap",gap:12,borderTop:`1px solid ${t.borderLight}`,paddingTop:14}}>
                {Object.entries(TYPE_META).map(([k,v])=>(
                  <div key={k} style={{display:"flex",alignItems:"center",gap:4}}>
                    <div style={{width:6,height:6,borderRadius:"50%",background:v.color}}/>
                    <span style={{fontSize:9,color:t.textFaint,letterSpacing:"0.1em"}}>{v.icon} {v.label}</span>
                  </div>
                ))}
                <div style={{display:"flex",gap:10,marginLeft:"auto"}}>
                  {([["#34D399","DONE"],["#FFE66D","PARTIAL"],["#F87171","MISSED"],["#C084FC","AI MODIFIED"]] as const).map(([c,l])=>(
                    <div key={l} style={{display:"flex",alignItems:"center",gap:4}}>
                      <div style={{width:6,height:6,borderRadius:"50%",background:c}}/>
                      <span style={{fontSize:9,color:t.textFaint,letterSpacing:"0.1em"}}>{l}</span>
                    </div>
                  ))}
                </div>
                <div style={{fontSize:9,color:t.textGhost,letterSpacing:"0.1em",marginLeft:8}}>D / W / M to switch views</div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Day view */}
      {selectedDate && <DayView date={selectedDate} />}

      {/* Feedback Modal */}
      {feedbackModal&&(()=>{
        const workout=getWorkoutForDate(keyToDate(feedbackModal));
        return(
          <div style={{position:"fixed",inset:0,background:t.overlayBg,display:"flex",alignItems:"center",justifyContent:"center",zIndex:100,padding:20}}>
            <div style={{background:t.modalBg,border:`1px solid ${t.borderFocus}`,borderRadius:10,width:"100%",maxWidth:440,overflow:"hidden"}}>
              <div style={{height:3,background:"#FF6B35"}}/>
              <div style={{padding:"18px 22px"}}>
                <div style={{fontFamily:"Barlow Condensed",fontSize:18,fontWeight:900,letterSpacing:"0.1em",color:t.text,marginBottom:3}}>LOG WORKOUT</div>
                <div style={{fontSize:10,color:t.textFaint,marginBottom:18}}>{workout?.title}</div>
                <div style={{marginBottom:14}}>
                  <div style={{fontSize:8,letterSpacing:"0.2em",color:t.textFaint,marginBottom:7}}>STATUS</div>
                  <div style={{display:"flex",gap:7}}>
                    {([["yes","✓ Completed","#34D399"],["partial","½ Partial","#FFE66D"],["no","✗ Missed","#F87171"]] as const).map(([val,lbl,c])=>(
                      <button key={val} onClick={()=>setFeedbackForm(f=>({...f,completed:val}))} style={{flex:1,background:feedbackForm.completed===val?c+"22":"none",border:`1px solid ${feedbackForm.completed===val?c:t.borderFocus}`,borderRadius:4,color:feedbackForm.completed===val?c:t.textFaint,cursor:"pointer",padding:"7px 4px",fontSize:9,fontFamily:"DM Mono"}}>{lbl}</button>
                    ))}
                  </div>
                </div>
                <div style={{marginBottom:14}}>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:8,letterSpacing:"0.2em",color:t.textFaint,marginBottom:7}}>
                    <span>EFFORT (RPE)</span>
                    <span style={{color:feedbackForm.rpe>=8?"#F87171":feedbackForm.rpe>=6?"#FFE66D":"#34D399"}}>{feedbackForm.rpe}/10</span>
                  </div>
                  <input type="range" min={1} max={10} value={feedbackForm.rpe} onChange={e=>setFeedbackForm(f=>({...f,rpe:parseInt(e.target.value)}))} style={{width:"100%",accentColor:"#FF6B35"}}/>
                </div>
                <div style={{display:"grid",gridTemplateColumns:bp.isMobile?"1fr":"1fr 1fr 1fr",gap:10,marginBottom:14}}>
                  <div>
                    <div style={{fontSize:8,letterSpacing:"0.2em",color:t.textFaint,marginBottom:7}}>AVG HR (bpm)</div>
                    <input type="number" placeholder={workout?.hr||"—"} value={feedbackForm.hrAvg} onChange={e=>setFeedbackForm(f=>({...f,hrAvg:e.target.value}))} style={{width:"100%",background:t.bgInput,border:`1px solid ${t.borderFocus}`,borderRadius:4,color:t.textSecondary,padding:"7px 10px",fontSize:10,fontFamily:"DM Mono",outline:"none"}}/>
                  </div>
                  <div>
                    <div style={{fontSize:8,letterSpacing:"0.2em",color:t.textFaint,marginBottom:7}}>MAX HR (bpm)</div>
                    <input type="number" placeholder="—" value={feedbackForm.hrMax} onChange={e=>setFeedbackForm(f=>({...f,hrMax:e.target.value}))} style={{width:"100%",background:t.bgInput,border:`1px solid ${t.borderFocus}`,borderRadius:4,color:t.textSecondary,padding:"7px 10px",fontSize:10,fontFamily:"DM Mono",outline:"none"}}/>
                  </div>
                  <div>
                    <div style={{fontSize:8,letterSpacing:"0.2em",color:t.textFaint,marginBottom:7}}>AVG PACE (min/mi)</div>
                    <input type="text" placeholder={workout?.pace||"—"} value={feedbackForm.paceAvg} onChange={e=>setFeedbackForm(f=>({...f,paceAvg:e.target.value}))} style={{width:"100%",background:t.bgInput,border:`1px solid ${t.borderFocus}`,borderRadius:4,color:t.textSecondary,padding:"7px 10px",fontSize:10,fontFamily:"DM Mono",outline:"none"}}/>
                  </div>
                </div>
                <div style={{marginBottom:18}}>
                  <div style={{fontSize:8,letterSpacing:"0.2em",color:t.textFaint,marginBottom:7}}>NOTES</div>
                  <textarea value={feedbackForm.notes} onChange={e=>setFeedbackForm(f=>({...f,notes:e.target.value}))} placeholder="legs heavy, strong on reps 4–5, struggled with carries…" rows={2} style={{width:"100%",background:t.bgInput,border:`1px solid ${t.borderFocus}`,borderRadius:4,color:t.textSecondary,padding:"7px 10px",fontSize:10,fontFamily:"DM Mono",outline:"none",resize:"none"}}/>
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={()=>setFeedbackModal(null)} style={{flex:1,background:"none",border:`1px solid ${t.borderFocus}`,borderRadius:4,color:t.textFaint,cursor:"pointer",padding:"9px",fontSize:10,fontFamily:"Barlow Condensed",letterSpacing:"0.1em"}}>CANCEL</button>
                  <button onClick={()=>submitFeedback(feedbackModal)} style={{flex:2,background:"#FF6B35",border:"none",borderRadius:4,color:isDark?"#0A0A0A":"#FFF",cursor:"pointer",padding:"9px",fontSize:12,fontFamily:"Barlow Condensed",fontWeight:900,letterSpacing:"0.1em"}}>SAVE + ADJUST</button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
