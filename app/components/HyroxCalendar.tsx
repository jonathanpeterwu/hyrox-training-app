"use client";

import { useState, useEffect, useRef } from "react";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────
const START_DATE = new Date(2026, 2, 9);
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
function weekProfile(w: number) {
  const deload = w === 4 || w === 7;
  const raceWeek = w === 8;
  const volMultiplier = deload ? 0.65 : raceWeek ? 0.4 : [1,1.1,1.2,0.65,1.3,1.4,0.65,0.4][w-1];
  const intMultiplier = deload ? 0.8 : raceWeek ? 0.9 : [1,1.05,1.1,0.8,1.15,1.2,0.9,0.9][w-1];
  return { deload, raceWeek, volMultiplier, intMultiplier };
}

function generateWorkout(dayOfWeek: number, weekNum: number, adjustments: Adjustments = {}): Workout {
  const { fatigue=5, performance=5, compliance=1.0 } = adjustments;
  const { volMultiplier:vm, intMultiplier:im, deload, raceWeek } = weekProfile(weekNum);
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
- Training program: 8 weeks, Mar 9–May 3 2026. Weeks 4 and 7 are deloads. Week 8 is race week.
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

// ─── MAIN APP ────────────────────────────────────────────────────────────────
export default function HyroxCalendar() {
  const [view, setView] = useState("calendar");
  const [currentMonth, setCurrentMonth] = useState(2);
  const [currentYear, setCurrentYear] = useState(2026);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [workoutLog, setWorkoutLog] = useState<Record<string, LogEntry>>({});
  const [workoutOverrides, setWorkoutOverrides] = useState<Record<string, Workout>>({});
  const [progressionOverrides, setProgressionOverrides] = useState<Record<number, { fatigueOverride?: number; performanceOverride?: number }>>({});
  const [feedbackModal, setFeedbackModal] = useState<string | null>(null);
  const [feedbackForm, setFeedbackForm] = useState({rpe:5,completed:"yes",notes:"",hrAvg:""});
  // Chat state
  const [chatMode, setChatMode] = useState("day"); // "day" | "plan"
  const [dayMessages, setDayMessages] = useState<Record<string, ChatMessage[]>>({});
  const [planMessages, setPlanMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { chatEndRef.current?.scrollIntoView({behavior:"smooth"}); });

  const dateKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  const keyToDate = (k: string) => { const [y,m,d]=k.split("-").map(Number); return new Date(y,m-1,d); };

  function getWorkoutForDate(date: Date, ignoreOverride=false): (Workout & { weekNum: number; dayIndex: number; key: string; isOverridden?: boolean }) | null {
    const dayIndex = (date.getDay()+6)%7;
    const diff = Math.floor((date.getTime()-START_DATE.getTime())/86400000);
    if (diff<0||diff>=56) return null;
    const weekNum = Math.floor(diff/7)+1;
    const key = dateKey(date);
    // Check for full workout override first
    if (!ignoreOverride && workoutOverrides[key]) {
      return { ...workoutOverrides[key], weekNum, dayIndex, key, isOverridden: true };
    }
    const log = workoutLog[key];
    const adj = log?.adjustments || {};
    // Apply progression overrides
    const progAdj = progressionOverrides[weekNum] || {};
    const mergedAdj: Adjustments = {
      ...adj,
      ...(progAdj.fatigueOverride !== undefined ? {fatigue: progAdj.fatigueOverride} : {}),
      ...(progAdj.performanceOverride !== undefined ? {performance: progAdj.performanceOverride} : {}),
    };
    return { ...generateWorkout(dayIndex, weekNum, mergedAdj), weekNum, dayIndex, key };
  }

  function getWeekNumber(date: Date): number | null {
    const diff = Math.floor((date.getTime()-START_DATE.getTime())/86400000);
    if (diff<0||diff>=56) return null;
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
    const fb = {...feedbackForm, hrAvg: feedbackForm.hrAvg?parseInt(feedbackForm.hrAvg):null};
    const workout = getWorkoutForDate(keyToDate(dateStr));
    const hrTarget = workout?.hr ? parseInt(workout.hr.split("–")[1])-5 : null;
    const adj = processFeedback({...fb, hrTarget, rpe: fb.rpe, completed: fb.completed, notes: fb.notes});
    setWorkoutLog(prev=>({...prev,[dateStr]:{...prev[dateStr],status:fb.completed,feedback:fb,adjustments:adj}}));
    setFeedbackModal(null);
    setFeedbackForm({rpe:5,completed:"yes",notes:"",hrAvg:""});
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
      <div style={{display:"flex",flexDirection:"column",height:"100%",background:"#090909"}}>
        {/* Mode toggle (only in day view) */}
        {dateStr && (
          <div style={{display:"flex",borderBottom:"1px solid #161616",flexShrink:0}}>
            {([["day","📅 This Workout"],["plan","📋 Full Plan"]] as const).map(([m,l])=>(
              <button key={m} onClick={()=>setChatMode(m)} style={{flex:1,padding:"10px 0",background:chatMode===m?"#111":"transparent",border:"none",borderBottom:chatMode===m?"2px solid #FF6B35":"2px solid transparent",color:chatMode===m?"#E8E8E0":"#444",cursor:"pointer",fontSize:10,fontFamily:"Barlow Condensed",fontWeight:700,letterSpacing:"0.15em"}}>
                {l}
              </button>
            ))}
          </div>
        )}

        {/* Override badge */}
        {chatMode==="day" && hasOverride && (
          <div style={{padding:"6px 14px",background:"#FF6B3511",borderBottom:"1px solid #FF6B3533",fontSize:9,color:"#FF6B35",letterSpacing:"0.12em",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
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
              <div style={{fontFamily:"Barlow Condensed",fontSize:14,letterSpacing:"0.1em",color:"#444",marginBottom:14}}>
                {chatMode==="day"?"ASK ABOUT THIS WORKOUT":"ASK ABOUT YOUR PLAN"}
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {quickPrompts.map((p,i)=>(
                  <button key={i} onClick={()=>sendMessage(chatMode,p,chatMode==="day"?dateStr??null:null)} style={{background:"#111",border:"1px solid #1a1a1a",borderRadius:4,color:"#666",cursor:"pointer",padding:"7px 10px",fontSize:10,fontFamily:"DM Mono",textAlign:"left",lineHeight:1.4}}>
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
                <div style={{maxWidth:"88%",background:isUser?"#FF6B3522":"#111",border:`1px solid ${isUser?"#FF6B3544":"#1a1a1a"}`,borderRadius:isUser?"8px 8px 2px 8px":"8px 8px 8px 2px",padding:"10px 13px"}}>
                  {!isUser && parsed && (
                    <>
                      <div style={{fontSize:11,color:"#CCC",lineHeight:1.75,whiteSpace:"pre-wrap"}}>{parsed.cleanText}</div>
                      {parsed.workoutUpdate && (
                        <div style={{marginTop:10,padding:"10px 12px",background:"#FF6B3511",border:"1px solid #FF6B3533",borderRadius:4}}>
                          <div style={{fontSize:9,color:"#FF6B35",letterSpacing:"0.15em",marginBottom:6}}>⚡ WORKOUT UPDATED</div>
                          <div style={{fontSize:10,color:"#AAA",lineHeight:1.7}}>
                            <div><span style={{color:"#555"}}>Title: </span>{parsed.workoutUpdate.title}</div>
                            <div><span style={{color:"#555"}}>Sets: </span>{parsed.workoutUpdate.sets}</div>
                            <div><span style={{color:"#555"}}>Pace: </span>{parsed.workoutUpdate.pace}</div>
                            <div><span style={{color:"#555"}}>HR: </span>{parsed.workoutUpdate.hr} bpm</div>
                          </div>
                        </div>
                      )}
                      {parsed.progressionUpdate && (
                        <div style={{marginTop:10,padding:"10px 12px",background:"#C084FC11",border:"1px solid #C084FC33",borderRadius:4}}>
                          <div style={{fontSize:9,color:"#C084FC",letterSpacing:"0.15em",marginBottom:6}}>🔺 PROGRESSION UPDATED</div>
                          <div style={{fontSize:10,color:"#AAA",lineHeight:1.7}}>
                            Weeks adjusted: {Object.keys(parsed.progressionUpdate.weeklyAdjustments||{}).join(", ")}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                  {isUser && <div style={{fontSize:11,color:"#FFB899",lineHeight:1.6}}>{msg.content}</div>}
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
        <div style={{borderTop:"1px solid #161616",padding:"12px 14px",flexShrink:0}}>
          <div style={{display:"flex",gap:8,alignItems:"flex-end"}}>
            <textarea
              value={chatInput}
              onChange={e=>setChatInput(e.target.value)}
              onKeyDown={e=>{ if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMessage(chatMode,chatInput,chatMode==="day"?dateStr??null:null);}}}
              placeholder={chatMode==="day"?"Ask about this workout or request changes…":"Ask about your overall plan…"}
              rows={2}
              style={{flex:1,background:"#111",border:"1px solid #222",borderRadius:6,color:"#CCC",padding:"8px 12px",fontSize:11,fontFamily:"DM Mono",outline:"none",resize:"none",lineHeight:1.5}}
            />
            <button
              onClick={()=>sendMessage(chatMode,chatInput,chatMode==="day"?dateStr??null:null)}
              disabled={chatLoading||!chatInput.trim()}
              style={{background:chatInput.trim()?"#FF6B35":"#1a1a1a",border:"none",borderRadius:6,color:chatInput.trim()?"#0A0A0A":"#333",cursor:chatInput.trim()?"pointer":"default",padding:"10px 14px",fontFamily:"Barlow Condensed",fontWeight:900,fontSize:14,letterSpacing:"0.1em",minWidth:48,flexShrink:0}}
            >
              ↑
            </button>
          </div>
          <div style={{fontSize:8,color:"#333",marginTop:5,letterSpacing:"0.1em"}}>ENTER TO SEND · SHIFT+ENTER FOR NEWLINE · {chatMode==="day"?"CHANGES APPLY TO THIS WORKOUT ONLY":"CHANGES AFFECT WHOLE PLAN"}</div>
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
      <div style={{padding:60,textAlign:"center",color:"#444"}}>
        <div style={{fontSize:40,marginBottom:12}}>📅</div>
        <div style={{fontFamily:"Barlow Condensed",fontSize:18,letterSpacing:"0.1em"}}>Outside training window</div>
        <div style={{fontSize:11,marginTop:6,color:"#333"}}>Program: Mar 9 – May 3, 2026</div>
        <button onClick={()=>setSelectedDate(null)} style={{marginTop:20,background:"none",border:"1px solid #222",borderRadius:4,color:"#555",cursor:"pointer",padding:"8px 18px",fontSize:11,fontFamily:"Barlow Condensed",letterSpacing:"0.1em"}}>← BACK TO CALENDAR</button>
      </div>
    );

    return (
      <div style={{display:"grid",gridTemplateColumns:"1fr 380px",height:"calc(100vh - 56px)"}}>
        {/* Left: workout detail */}
        <div style={{overflowY:"auto",padding:"20px 24px"}}>
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
            <button onClick={()=>setSelectedDate(null)} style={{background:"none",border:"1px solid #1a1a1a",borderRadius:4,color:"#555",cursor:"pointer",padding:"5px 12px",fontSize:10,fontFamily:"Barlow Condensed",letterSpacing:"0.1em"}}>← BACK</button>
            <div style={{fontFamily:"Barlow Condensed",fontSize:12,letterSpacing:"0.18em",color:"#444"}}>
              WEEK {wn} // {date.toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"}).toUpperCase()}
              {isToday&&<span style={{marginLeft:8,color:"#FF6B35",fontSize:9}}>● TODAY</span>}
              {workout.isOverridden&&<span style={{marginLeft:8,color:"#C084FC",fontSize:9}}>⚡ AI MODIFIED</span>}
            </div>
          </div>

          {/* Main workout card */}
          <div style={{background:"#0D0D0D",border:`1px solid ${meta.color}44`,borderRadius:8,overflow:"hidden",marginBottom:14}}>
            <div style={{height:4,background:meta.color}} />
            <div style={{padding:"18px 22px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
                <div>
                  <div style={{fontSize:9,letterSpacing:"0.2em",color:"#444",marginBottom:3}}>{meta.icon} {meta.label}</div>
                  <div style={{fontFamily:"Barlow Condensed",fontSize:28,fontWeight:900,color:"#E8E8E0",lineHeight:1}}>{workout.title}</div>
                </div>
                {log?.status&&<div style={{background:statusColor(log.status)+"22",border:`1px solid ${statusColor(log.status)}`,borderRadius:4,padding:"3px 9px",fontSize:9,color:statusColor(log.status)!,letterSpacing:"0.1em"}}>{log.status==="yes"?"✓ DONE":log.status==="partial"?"½ PARTIAL":"✗ MISSED"}</div>}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:8,marginBottom:14}}>
                {([["SETS",workout.sets],["PACE",workout.pace],["REST",workout.rest],["HR (bpm)",workout.hr]] as const).map(([l,v])=>(
                  <div key={l} style={{background:"#111",borderRadius:4,padding:"9px 12px"}}>
                    <div style={{fontSize:8,letterSpacing:"0.2em",color:"#444",marginBottom:3}}>{l}</div>
                    <div style={{fontSize:11,color:"#CCC"}}>{v}</div>
                  </div>
                ))}
              </div>
              <div style={{fontSize:11,color:"#777",lineHeight:1.8,borderTop:"1px solid #161616",paddingTop:12}}>{workout.notes}</div>
            </div>
          </div>

          {/* Feedback */}
          {(isPast||isToday)&&(
            <div style={{background:"#0D0D0D",border:"1px solid #1a1a1a",borderRadius:8,padding:"16px 18px",marginBottom:14}}>
              <div style={{fontFamily:"Barlow Condensed",fontSize:11,fontWeight:700,letterSpacing:"0.2em",color:"#444",marginBottom:12}}>LOG WORKOUT</div>
              {log?.feedback?(
                <div>
                  <div style={{fontSize:10,color:"#666",lineHeight:1.9}}>
                    <div><span style={{color:"#444"}}>RPE: </span>{log.feedback.rpe}/10</div>
                    <div><span style={{color:"#444"}}>Status: </span>{log.feedback.completed}</div>
                    {log.feedback.notes&&<div><span style={{color:"#444"}}>Notes: </span>{log.feedback.notes}</div>}
                    <div style={{marginTop:8,padding:"7px 10px",background:"#111",borderRadius:4,fontSize:9,display:"flex",gap:16}}>
                      <span style={{color:"#FF6B35"}}>Fatigue {log.adjustments?.fatigue}/10</span>
                      <span style={{color:"#4ECDC4"}}>Perf {log.adjustments?.performance}/10</span>
                    </div>
                  </div>
                  <button onClick={()=>setFeedbackModal(key)} style={{marginTop:10,background:"none",border:"1px solid #222",borderRadius:4,color:"#555",cursor:"pointer",padding:"5px 10px",fontSize:9,fontFamily:"DM Mono",letterSpacing:"0.1em",width:"100%"}}>UPDATE</button>
                </div>
              ):(
                <button onClick={()=>setFeedbackModal(key)} style={{background:"#FF6B3522",border:"1px solid #FF6B35",borderRadius:4,color:"#FF6B35",cursor:"pointer",padding:"9px",fontSize:11,fontFamily:"Barlow Condensed",fontWeight:700,letterSpacing:"0.12em",width:"100%"}}>+ LOG THIS WORKOUT</button>
              )}
            </div>
          )}
        </div>

        {/* Right: chat */}
        <div style={{borderLeft:"1px solid #161616",display:"flex",flexDirection:"column",height:"100%"}}>
          <ChatPanel mode={chatMode} dateStr={key} />
        </div>
      </div>
    );
  }

  // ── RENDER ────────────────────────────────────────────────────────────────
  return (
    <div style={{fontFamily:"'DM Mono','Courier New',monospace",background:"#080808",minHeight:"100vh",color:"#E8E8E0"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Barlow+Condensed:wght@700;900&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:3px;height:3px;}
        ::-webkit-scrollbar-thumb{background:#FF6B35;border-radius:2px;}
        .cal-day:hover{border-color:#FF6B35!important;cursor:pointer;}
        .cal-day{transition:all 0.15s ease;}
        @keyframes bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
      `}</style>

      {/* Top bar */}
      <div style={{borderBottom:"1px solid #161616",padding:"10px 22px",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8,height:56,flexShrink:0}}>
        <div style={{display:"flex",alignItems:"baseline",gap:12}}>
          <div style={{fontFamily:"Barlow Condensed",fontSize:26,fontWeight:900,color:"#FF6B35",letterSpacing:"0.08em"}}>HYROX</div>
          <div style={{fontFamily:"Barlow Condensed",fontSize:10,letterSpacing:"0.2em",color:"#282828"}}>ADAPTIVE TRAINING CALENDAR</div>
        </div>
        <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
          {/* Plan chat button */}
          <button
            onClick={()=>{setSelectedDate(null);setChatMode("plan");setView("planchat");}}
            style={{background:view==="planchat"?"#C084FC22":"#111",border:`1px solid ${view==="planchat"?"#C084FC":"#222"}`,borderRadius:4,color:view==="planchat"?"#C084FC":"#555",cursor:"pointer",padding:"5px 12px",fontSize:9,fontFamily:"Barlow Condensed",fontWeight:700,letterSpacing:"0.15em"}}
          >
            📋 ADJUST FULL PLAN
          </button>
          <div style={{fontSize:9,color:"#333",letterSpacing:"0.1em"}}>
            {Object.values(workoutLog).filter(l=>l.status==="yes").length} DONE ·&nbsp;
            {Object.keys(progressionOverrides).length} WK OVERRIDES ·&nbsp;
            {Object.keys(workoutOverrides).length} DAY OVERRIDES
          </div>
        </div>
      </div>

      {/* Plan-level chat view */}
      {view==="planchat" && !selectedDate && (
        <div style={{display:"grid",gridTemplateColumns:"1fr 420px",height:"calc(100vh - 56px)"}}>
          <div style={{overflowY:"auto",padding:"20px 24px"}}>
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:18}}>
              <button onClick={()=>setView("calendar")} style={{background:"none",border:"1px solid #1a1a1a",borderRadius:4,color:"#555",cursor:"pointer",padding:"5px 12px",fontSize:10,fontFamily:"Barlow Condensed",letterSpacing:"0.1em"}}>← CALENDAR</button>
              <div style={{fontFamily:"Barlow Condensed",fontSize:16,fontWeight:900,letterSpacing:"0.15em",color:"#C084FC"}}>FULL PLAN ADJUSTMENTS</div>
            </div>
            {/* Week overview */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
              {Array.from({length:8},(_,i)=>i+1).map(w=>{
                const p=weekProfile(w);
                const po=progressionOverrides[w];
                return(
                  <div key={w} style={{background:"#0D0D0D",border:`1px solid ${po?"#C084FC33":p.deload?"#4ECDC433":p.raceWeek?"#FF6B3544":"#161616"}`,borderRadius:6,padding:"12px 14px"}}>
                    <div style={{fontFamily:"Barlow Condensed",fontSize:11,fontWeight:700,letterSpacing:"0.1em",color:p.deload?"#4ECDC4":p.raceWeek?"#FF6B35":"#666",marginBottom:6}}>
                      WK {w} {p.deload?"/ DELOAD":p.raceWeek?"/ RACE":""}
                    </div>
                    <div style={{fontSize:9,color:"#444",lineHeight:1.7}}>
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
          </div>
          <div style={{borderLeft:"1px solid #161616",height:"100%"}}>
            <ChatPanel mode="plan" />
          </div>
        </div>
      )}

      {/* Calendar view */}
      {view==="calendar" && !selectedDate && (
        <div style={{padding:"18px 20px"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
            <button onClick={()=>{if(currentMonth===0){setCurrentMonth(11);setCurrentYear(y=>y-1);}else setCurrentMonth(m=>m-1);}} style={{background:"none",border:"1px solid #1a1a1a",borderRadius:4,color:"#555",cursor:"pointer",padding:"5px 14px",fontFamily:"Barlow Condensed",fontSize:14}}>‹</button>
            <div style={{fontFamily:"Barlow Condensed",fontSize:20,fontWeight:900,letterSpacing:"0.15em"}}>{MONTHS[currentMonth].toUpperCase()} {currentYear}</div>
            <button onClick={()=>{if(currentMonth===11){setCurrentMonth(0);setCurrentYear(y=>y+1);}else setCurrentMonth(m=>m+1);}} style={{background:"none",border:"1px solid #1a1a1a",borderRadius:4,color:"#555",cursor:"pointer",padding:"5px 14px",fontFamily:"Barlow Condensed",fontSize:14}}>›</button>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:3,marginBottom:3}}>
            {DAYS.map(d=><div key={d} style={{textAlign:"center",fontSize:8,letterSpacing:"0.2em",color:"#2a2a2a",padding:"3px 0"}}>{d}</div>)}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:3}}>
            {calDays.map((date,i)=>{
              if(!date)return<div key={i}/>;
              const workout=getWorkoutForDate(date);
              const key=dateKey(date);
              const log=workoutLog[key];
              const meta=workout?TYPE_META[workout.type]:null;
              const isToday=key===dateKey(today);
              const wn=getWeekNumber(date);
              const hasOverride=!!workoutOverrides[key];
              return(
                <div key={i} className="cal-day" onClick={()=>{setSelectedDate(date);setChatMode("day");setView("calendar");}} style={{border:"1px solid",borderColor:isToday?"#FF6B35":"#141414",borderRadius:5,minHeight:80,padding:"7px 7px 5px",background:isToday?"#0F0A07":"#0B0B0B",position:"relative",opacity:!workout&&!isToday?0.35:1}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:4}}>
                    <div style={{fontFamily:"Barlow Condensed",fontSize:14,fontWeight:700,color:isToday?"#FF6B35":"#444",lineHeight:1}}>{date.getDate()}</div>
                    {wn&&<div style={{fontSize:6,color:"#1e1e1e",letterSpacing:"0.1em"}}>W{wn}</div>}
                  </div>
                  {workout&&meta&&(
                    <>
                      <div style={{display:"flex",alignItems:"center",gap:4,marginBottom:3}}>
                        <div style={{width:5,height:5,borderRadius:"50%",background:hasOverride?"#C084FC":meta.color,flexShrink:0}}/>
                        {hasOverride&&<div style={{width:4,height:4,borderRadius:"50%",background:"#C084FC55"}}/>}
                      </div>
                      <div style={{fontFamily:"Barlow Condensed",fontSize:10,fontWeight:700,color:"#777",lineHeight:1.2,marginBottom:3}}>{meta.icon} {workout.title.length>16?workout.title.slice(0,15)+"…":workout.title}</div>
                      <div style={{fontSize:8,color:"#333",lineHeight:1.3}}>{workout.sets.length>13?workout.sets.slice(0,12)+"…":workout.sets}</div>
                      {log?.status&&<div style={{position:"absolute",top:5,right:5,width:7,height:7,borderRadius:"50%",background:statusColor(log.status)!}}/>}
                    </>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{marginTop:16,display:"flex",flexWrap:"wrap",gap:12,borderTop:"1px solid #111",paddingTop:14}}>
            {Object.entries(TYPE_META).map(([k,v])=>(
              <div key={k} style={{display:"flex",alignItems:"center",gap:4}}>
                <div style={{width:6,height:6,borderRadius:"50%",background:v.color}}/>
                <span style={{fontSize:8,color:"#383838",letterSpacing:"0.1em"}}>{v.icon} {v.label}</span>
              </div>
            ))}
            <div style={{display:"flex",gap:10,marginLeft:"auto"}}>
              {([["#34D399","DONE"],["#FFE66D","PARTIAL"],["#F87171","MISSED"],["#C084FC","AI MODIFIED"]] as const).map(([c,l])=>(
                <div key={l} style={{display:"flex",alignItems:"center",gap:4}}>
                  <div style={{width:6,height:6,borderRadius:"50%",background:c}}/>
                  <span style={{fontSize:8,color:"#383838",letterSpacing:"0.1em"}}>{l}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Day view */}
      {selectedDate && <DayView date={selectedDate} />}

      {/* Feedback Modal */}
      {feedbackModal&&(()=>{
        const workout=getWorkoutForDate(keyToDate(feedbackModal));
        return(
          <div style={{position:"fixed",inset:0,background:"#000000CC",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100,padding:20}}>
            <div style={{background:"#0D0D0D",border:"1px solid #222",borderRadius:10,width:"100%",maxWidth:440,overflow:"hidden"}}>
              <div style={{height:3,background:"#FF6B35"}}/>
              <div style={{padding:"18px 22px"}}>
                <div style={{fontFamily:"Barlow Condensed",fontSize:18,fontWeight:900,letterSpacing:"0.1em",marginBottom:3}}>LOG WORKOUT</div>
                <div style={{fontSize:10,color:"#555",marginBottom:18}}>{workout?.title}</div>
                <div style={{marginBottom:14}}>
                  <div style={{fontSize:8,letterSpacing:"0.2em",color:"#444",marginBottom:7}}>STATUS</div>
                  <div style={{display:"flex",gap:7}}>
                    {([["yes","✓ Completed","#34D399"],["partial","½ Partial","#FFE66D"],["no","✗ Missed","#F87171"]] as const).map(([val,lbl,c])=>(
                      <button key={val} onClick={()=>setFeedbackForm(f=>({...f,completed:val}))} style={{flex:1,background:feedbackForm.completed===val?c+"22":"none",border:`1px solid ${feedbackForm.completed===val?c:"#222"}`,borderRadius:4,color:feedbackForm.completed===val?c:"#444",cursor:"pointer",padding:"7px 4px",fontSize:9,fontFamily:"DM Mono"}}>{lbl}</button>
                    ))}
                  </div>
                </div>
                <div style={{marginBottom:14}}>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:8,letterSpacing:"0.2em",color:"#444",marginBottom:7}}>
                    <span>EFFORT (RPE)</span>
                    <span style={{color:feedbackForm.rpe>=8?"#F87171":feedbackForm.rpe>=6?"#FFE66D":"#34D399"}}>{feedbackForm.rpe}/10</span>
                  </div>
                  <input type="range" min={1} max={10} value={feedbackForm.rpe} onChange={e=>setFeedbackForm(f=>({...f,rpe:parseInt(e.target.value)}))} style={{width:"100%",accentColor:"#FF6B35"}}/>
                </div>
                <div style={{marginBottom:14}}>
                  <div style={{fontSize:8,letterSpacing:"0.2em",color:"#444",marginBottom:7}}>AVG HR (optional)</div>
                  <input type="number" placeholder={`Target: ${workout?.hr||"—"} bpm`} value={feedbackForm.hrAvg} onChange={e=>setFeedbackForm(f=>({...f,hrAvg:e.target.value}))} style={{width:"100%",background:"#111",border:"1px solid #222",borderRadius:4,color:"#CCC",padding:"7px 10px",fontSize:10,fontFamily:"DM Mono",outline:"none"}}/>
                </div>
                <div style={{marginBottom:18}}>
                  <div style={{fontSize:8,letterSpacing:"0.2em",color:"#444",marginBottom:7}}>NOTES</div>
                  <textarea value={feedbackForm.notes} onChange={e=>setFeedbackForm(f=>({...f,notes:e.target.value}))} placeholder="legs heavy, strong on reps 4–5, struggled with carries…" rows={2} style={{width:"100%",background:"#111",border:"1px solid #222",borderRadius:4,color:"#CCC",padding:"7px 10px",fontSize:10,fontFamily:"DM Mono",outline:"none",resize:"none"}}/>
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={()=>setFeedbackModal(null)} style={{flex:1,background:"none",border:"1px solid #222",borderRadius:4,color:"#555",cursor:"pointer",padding:"9px",fontSize:10,fontFamily:"Barlow Condensed",letterSpacing:"0.1em"}}>CANCEL</button>
                  <button onClick={()=>submitFeedback(feedbackModal)} style={{flex:2,background:"#FF6B35",border:"none",borderRadius:4,color:"#0A0A0A",cursor:"pointer",padding:"9px",fontSize:12,fontFamily:"Barlow Condensed",fontWeight:900,letterSpacing:"0.1em"}}>SAVE + ADJUST</button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
