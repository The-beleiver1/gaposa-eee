// UI SHIM v10
function acceptScan(){var btn=document.getElementById('btn-accept');if(btn)btn.disabled=true;if(typeof confirmAttendance==='function')confirmAttendance();}
function rejectScan(){var btn=document.getElementById('btn-reject');if(btn)btn.disabled=true;if(typeof rejectAttendance==='function')rejectAttendance();hideScanApproval();}
function showScanApproval(name,meta,pct,initials){var el=document.getElementById('scan-approval');if(el)el.style.display='block';var n=document.getElementById('approval-name');if(n)n.textContent=name||'--';var m2=document.getElementById('approval-meta');if(m2)m2.textContent=meta||'--';var t=document.getElementById('approval-thumb');if(t)t.textContent=initials||'?';var fill=document.getElementById('cfill');if(fill)fill.style.width=pct+'%';var pctEl=document.getElementById('cpct');if(pctEl)pctEl.textContent=pct+'%';}
function hideScanApproval(){var el=document.getElementById('scan-approval');if(el)el.style.display='none';}
function showMismatchBanner(name,matric,distance){var el=document.getElementById('mismatch-banner');if(!el)return;el.style.display='block';var d=document.getElementById('mismatch-detail');if(d)d.textContent=(name||'Unknown')+' - '+(matric||'--')+' - Distance: '+(distance||'--');setTimeout(function(){el.style.display='none';},6000);}


// ═══════════════════════════════════════════════════════════════════
// GAPOSA EEE Attendance System v9
// HARDCODED Firebase — no setup screen for regular users
// Auto-week, session/semester, correct courses, matric parsing
// ═══════════════════════════════════════════════════════════════════

// ── FIREBASE CONFIG (hardcoded — lecturers never see this) ────────
const FB_CFG = {
  apiKey: "AIzaSyBCgInw0dtuDvX51yTxQXBEjAibHys4FHc",
  authDomain: "gaposa-eee-faceidattendance.firebaseapp.com",
  projectId: "gaposa-eee-faceidattendance",
  storageBucket: "gaposa-eee-faceidattendance.firebasestorage.app",
  messagingSenderId: "129512702964",
  appId: "1:129512702964:web:3dff518d75e94fb67cefa1"
};

const MDL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model';
let MAX_WEEKS = 15; // HOD-configurable — loaded from Firestore settings
const SAMPLES_NEEDED = 4;
const ATT_THRESHOLD = 75;

// ── ACADEMIC SESSION & SEMESTER ────────────────────────────────────
// Auto-calculated based on current date — overridden by Firestore values below
// Academic year: Aug–Jul (e.g. Aug 2025 – Jul 2026 = 2025/2026)
// Semester 1: Aug – Jan | Semester 2: Feb – Jul

// ── AUTO WEEK CALCULATION ──────────────────────────────────────────
// Week is auto-calculated from the semester start date
// Semester 1 starts: 1st Monday of October each year
// Semester 2 starts: 1st Monday of March each year
// Lecturer can manually adjust with +/- buttons
let manualWeekOffset = parseInt(lsGet('weekOffset')||'0');

function getSemesterStartDate() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  let targetMonth, targetYear;
  if (month >= 8) {
    // Semester 1 — start October of this year
    targetMonth = 10; targetYear = year;
  } else if (month <= 1) {
    // Semester 1 — start October of last year
    targetMonth = 10; targetYear = year - 1;
  } else {
    // Semester 2 — start March of this year
    targetMonth = 3; targetYear = year;
  }
  // Find first Monday of that month
  const d = new Date(targetYear, targetMonth - 1, 1);
  while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
  return d;
}

function calcAutoWeek() {
  const start = getSemesterStartDate();
  const now = new Date();
  const diffMs = now - start;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const autoWeek = Math.max(1, Math.min(MAX_WEEKS, Math.floor(diffDays / 7) + 1));
  return autoWeek + manualWeekOffset;
}

let currentWeek = 1;

function updateWeekDisplay() {
  currentWeek = Math.max(1, Math.min(MAX_WEEKS, calcAutoWeek()));
  document.getElementById('wk-num').textContent = currentWeek;
  document.getElementById('wk-detail').textContent = `Week ${currentWeek} of ${MAX_WEEKS} · ${getAcademicSession()} · ${getSemester()}`;
}

async function changeWeek(d) {
  const prevWeek = currentWeek;
  const proposed = Math.max(1, Math.min(MAX_WEEKS, calcAutoWeek() + manualWeekOffset + d));

  // Block jumping more than 1 week at a time for lecturers
  if (currentUserRole !== 'admin' && Math.abs(proposed - prevWeek) > 1) {
    alert('Lecturers can only adjust the week by 1 at a time. Ask the HOD for larger adjustments.');
    return;
  }
  // Warn if jumping forward more than 2 weeks (even HOD)
  if (proposed > prevWeek + 2) {
    if (!confirm('Warning: You are jumping forward ' + (proposed - prevWeek) + ' weeks to Week ' + proposed + '.\n\nThis will allow marking attendance for future weeks. Are you sure?')) return;
  }

  manualWeekOffset += d;
  lsSet('weekOffset', manualWeekOffset);
  currentWeek = Math.max(1, Math.min(MAX_WEEKS, calcAutoWeek()));
  document.getElementById('wk-num').textContent = currentWeek;
  document.getElementById('wk-detail').textContent = `Week ${currentWeek} of ${MAX_WEEKS} · (manually adjusted)`;
  addLog('warn', 'Week changed: ' + prevWeek + ' → ' + currentWeek + ' by ' + (currentUserName || 'unknown'));

  // Persist week change audit to Firestore
  try {
    await dbFB.collection('audit_log').add({
      type: 'week_change',
      from: prevWeek, to: currentWeek,
      changedBy: currentUserName || 'unknown',
      role: currentUserRole || 'unknown',
      session: getAcademicSession(),
      semester: getSemester(),
      timestamp: new Date().toISOString()
    });
  } catch(e) { addLog('warn', 'Audit log write failed: ' + e.message); }
}

// ── CLOCK & SESSION BAR ────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  const timeStr = now.toTimeString().slice(0, 5);
  const dateStr = now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  document.getElementById('sb-time').textContent = timeStr;
  document.getElementById('sb-date').textContent = dateStr;
  document.getElementById('sb-session').textContent = getAcademicSession();
  document.getElementById('sb-sem').textContent = getSemester();
  // Also update week strip
  document.getElementById('ws-date-val').textContent = dateStr;
  document.getElementById('ws-time-val').textContent = timeStr;
}
setInterval(updateClock, 1000);
setInterval(updateWeekDisplay, 60000); // update week every minute
setInterval(async()=>{
  // Live sync: reload session settings every 60s so lecturer sees HOD changes instantly
  if(dbFB&&activeSession){
    const prev=activeSession+'||'+activeSemester;
    await loadActiveSessionFromDB();
    const curr=activeSession+'||'+activeSemester;
    if(prev!==curr){updateClock();updateWeekDisplay();addLog('info','Session updated by HOD: '+activeSession+' '+activeSemester);}
  }
},60000);

// ── FULL EEE COURSE LIST (from official document) ─────────────────
const COURSES = [
  // ND 1 Semester 1
  {code:'COM 111',title:'Introduction to Computer',units:2,level:'ND 1',sem:1,option:null},
  {code:'EEC 111',title:'Electrical Graphics',units:2,level:'ND 1',sem:1,option:null},
  {code:'EEC 112',title:'Introduction to Computer Software',units:2,level:'ND 1',sem:1,option:null},
  {code:'EEC 114',title:'Report Writing',units:2,level:'ND 1',sem:1,option:null},
  {code:'EEC 115',title:'Electrical Engineering Science I',units:2,level:'ND 1',sem:1,option:null},
  {code:'EEC 116',title:'Electrical Workshop Practice I',units:2,level:'ND 1',sem:1,option:null},
  {code:'EEC 117',title:'Computer Hardware I',units:2,level:'ND 1',sem:1,option:null},
  {code:'GNS 111',title:'Citizenship Education I',units:2,level:'ND 1',sem:1,option:null},
  {code:'GNS 112',title:'Use of English',units:2,level:'ND 1',sem:1,option:null},
  {code:'GNS 118',title:'Use of Library',units:1,level:'ND 1',sem:1,option:null},
  {code:'GNS 119',title:'General Agriculture',units:2,level:'ND 1',sem:1,option:null},
  {code:'ICT 115',title:'Network Fundamental',units:2,level:'ND 1',sem:1,option:null},
  {code:'MEC 112',title:'Technical Drawing',units:1,level:'ND 1',sem:1,option:null},
  {code:'MEC 113',title:'Basic Workshop Technology and Practice',units:2,level:'ND 1',sem:1,option:null},
  {code:'MTH 112',title:'Algebra and Elementary Trigonometry',units:2,level:'ND 1',sem:1,option:null},
  // ND 1 Semester 2
  {code:'EEC 121',title:'Digital Electronics',units:2,level:'ND 1',sem:2,option:null},
  {code:'EEC 122',title:'Electrical Power I',units:2,level:'ND 1',sem:2,option:null},
  {code:'EEC 123',title:'Electrical Machine I',units:2,level:'ND 1',sem:2,option:null},
  {code:'EEC 124',title:'Electronics I',units:2,level:'ND 1',sem:2,option:null},
  {code:'EEC 125',title:'Electrical Engineering Science II',units:1,level:'ND 1',sem:2,option:null},
  {code:'EEC 126',title:'Electrical and Electronic Instrument I',units:2,level:'ND 1',sem:2,option:null},
  {code:'EEC 127',title:'Electrical Workshop Practice II',units:1,level:'ND 1',sem:2,option:null},
  {code:'EEC 128',title:'Telecommunications I',units:2,level:'ND 1',sem:2,option:null},
  {code:'EEC 129',title:'Electrical Installation of Building',units:2,level:'ND 1',sem:2,option:null},
  {code:'GNS 122',title:'Communication Skills',units:2,level:'ND 1',sem:2,option:null},
  {code:'ICT 121',title:'Information Technology Essentials I',units:2,level:'ND 1',sem:2,option:null},
  {code:'ICT 125',title:'Routing Protocol',units:2,level:'ND 1',sem:2,option:null},
  {code:'MEC 124',title:'Machine Tools Technology and Practice',units:2,level:'ND 1',sem:2,option:null},
  {code:'MTH 121',title:'Calculus',units:2,level:'ND 1',sem:2,option:null},
  {code:'ENT 126',title:'Introduction to Entrepreneurship I',units:2,level:'ND 1',sem:2,option:null},
  // ND 2 Semester 1
  {code:'EEC 210',title:'Electrical Circuit Theory I',units:2,level:'ND 2',sem:1,option:null},
  {code:'EEC 211',title:'Seminar',units:2,level:'ND 2',sem:1,option:null},
  {code:'EEC 212',title:'Electrical Power II',units:2,level:'ND 2',sem:1,option:null},
  {code:'EEC 213',title:'Electrical Machine II',units:2,level:'ND 2',sem:1,option:null},
  {code:'EEC 214',title:'Electronics II',units:2,level:'ND 2',sem:1,option:null},
  {code:'EEC 216',title:'Electrical and Electronic Instrument II',units:2,level:'ND 2',sem:1,option:null},
  {code:'EEC 217',title:'Electrical/Electronic Maintenance and Repair',units:2,level:'ND 2',sem:1,option:null},
  {code:'EEC 218',title:'Telecommunications II',units:2,level:'ND 2',sem:1,option:null},
  {code:'ICT 211',title:'Information Technology Essentials II',units:2,level:'ND 2',sem:1,option:null},
  {code:'ICT 215',title:'Switching and Wireless',units:2,level:'ND 2',sem:1,option:null},
  {code:'MTH 212',title:'Logic and Linear Algebra',units:1,level:'ND 2',sem:1,option:null},
  {code:'SWE 211',title:'Students Industrial Work Experience Scheme',units:2,level:'ND 2',sem:1,option:null},
  {code:'ENT 216',title:'Introduction to Entrepreneurship II',units:1,level:'ND 2',sem:1,option:null},
  // ND 2 Semester 2
  {code:'EEC 220',title:'Electrical Circuit Theory II',units:2,level:'ND 2',sem:2,option:null},
  {code:'EEC 222',title:'Electrical Power III',units:2,level:'ND 2',sem:2,option:null},
  {code:'EEC 223',title:'Computer Programming Using C/C++ Language',units:2,level:'ND 2',sem:2,option:null},
  {code:'EEC 225',title:'Electronics III',units:2,level:'ND 2',sem:2,option:null},
  {code:'EEC 227',title:'Computer Hardware II',units:2,level:'ND 2',sem:2,option:null},
  {code:'EEC 229',title:'Project',units:2,level:'ND 2',sem:2,option:null},
  {code:'GNS 221',title:'Communication Skills II',units:1,level:'ND 2',sem:2,option:null},
  {code:'ICT 225',title:'Wide Area Network',units:2,level:'ND 2',sem:2,option:null},
  {code:'MTH 222',title:'Trigonometry and Analytical Geometry',units:1,level:'ND 2',sem:2,option:null},
  // HND 1 Semester 1 (Both options)
  {code:'EEC 311',title:'Electrical Material Science',units:2,level:'HND 1',sem:1,option:null},
  {code:'EEC 313',title:'Electrical Circuit Theory III',units:3,level:'HND 1',sem:1,option:null},
  {code:'EEC 314',title:'Analogue Electronics III',units:3,level:'HND 1',sem:1,option:null},
  {code:'EEC 318',title:'Digital Electronics',units:2,level:'HND 1',sem:1,option:null},
  {code:'EEI 311',title:'Electrical Measurement & Control III',units:3,level:'HND 1',sem:1,option:null},
  {code:'WEC 311',title:'Engineering in Society',units:2,level:'HND 1',sem:1,option:null},
  {code:'GNS 319',title:'Modern Agriculture',units:3,level:'HND 1',sem:1,option:null},
  {code:'ICT 312',title:'Computer Packages I',units:2,level:'HND 1',sem:1,option:null},
  {code:'MTH 311',title:'Advanced Algebra',units:2,level:'HND 1',sem:1,option:null},
  // HND 1 Semester 2 — Power & Machines
  {code:'EEC 323',title:'Electrical Circuit Theory IV',units:2,level:'HND 1',sem:2,option:'Power and Machines'},
  {code:'EEC 329',title:'Testing Methods and Reliability',units:2,level:'HND 1',sem:2,option:'Power and Machines'},
  {code:'EEE 325',title:'Digital Communication I',units:3,level:'HND 1',sem:2,option:'Power and Machines'},
  {code:'EEE 326',title:'Electrical Design and Drawing I',units:3,level:'HND 1',sem:2,option:'Power and Machines'},
  {code:'EEE 327',title:'Electrical Machines III',units:3,level:'HND 1',sem:2,option:'Power and Machines'},
  {code:'EEE 328',title:'Electrical Power System III',units:3,level:'HND 1',sem:2,option:'Power and Machines'},
  {code:'BAM 328',title:'Industrial Management',units:2,level:'HND 1',sem:2,option:'Power and Machines'},
  {code:'ICT 321',title:'Data Communication and Computer Network',units:3,level:'HND 1',sem:2,option:'Power and Machines'},
  {code:'MTH 322',title:'Advanced Calculus',units:2,level:'HND 1',sem:2,option:'Power and Machines'},
  {code:'ENT 326',title:'Practice of Entrepreneurship I',units:2,level:'HND 1',sem:2,option:'Power and Machines'},
  // HND 1 Semester 2 — Electronics & Telecom
  {code:'EEC 323',title:'Electrical Circuit Theory IV',units:2,level:'HND 1',sem:2,option:'Electronics and Telecommunication'},
  {code:'EEC 329',title:'Testing Methods and Reliability',units:2,level:'HND 1',sem:2,option:'Electronics and Telecommunication'},
  {code:'EEE 325',title:'Digital Communication I',units:3,level:'HND 1',sem:2,option:'Electronics and Telecommunication'},
  {code:'EEE 326',title:'Electrical Design and Drawing I',units:3,level:'HND 1',sem:2,option:'Electronics and Telecommunication'},
  {code:'EEE 327',title:'Electrical Machines III',units:3,level:'HND 1',sem:2,option:'Electronics and Telecommunication'},
  {code:'EEE 328',title:'Electrical Power System III',units:3,level:'HND 1',sem:2,option:'Electronics and Telecommunication'},
  {code:'BAM 328',title:'Industrial Management',units:2,level:'HND 1',sem:2,option:'Electronics and Telecommunication'},
  {code:'ICT 321',title:'Data Communication and Computer Network',units:3,level:'HND 1',sem:2,option:'Electronics and Telecommunication'},
  {code:'MTH 322',title:'Advanced Calculus',units:2,level:'HND 1',sem:2,option:'Electronics and Telecommunication'},
  {code:'ENT 326',title:'Practice of Entrepreneurship I',units:2,level:'HND 1',sem:2,option:'Electronics and Telecommunication'},
  // HND 2 Semester 1 — Power & Machines
  {code:'EEC 411',title:'Electromagnetic Field Theory',units:2,level:'HND 2',sem:1,option:'Power and Machines'},
  {code:'EEC 413',title:'Control Engineering System',units:3,level:'HND 2',sem:1,option:'Power and Machines'},
  {code:'EEC 417',title:'Power Electronics',units:2,level:'HND 2',sem:1,option:'Power and Machines'},
  {code:'EEC 419',title:'Project I',units:2,level:'HND 2',sem:1,option:'Power and Machines'},
  {code:'EEI 411',title:'Electronic Measurement and Control IV',units:3,level:'HND 2',sem:1,option:'Power and Machines'},
  {code:'EEP 416',title:'Electrical Power System IV',units:3,level:'HND 2',sem:1,option:'Power and Machines'},
  {code:'EEP 418',title:'Electrical Design and Drafting II',units:3,level:'HND 2',sem:1,option:'Power and Machines'},
  {code:'EEP 419',title:'Electrical Machines IV',units:3,level:'HND 2',sem:1,option:'Power and Machines'},
  {code:'MTH 411',title:'Numerical Methods',units:2,level:'HND 2',sem:1,option:'Power and Machines'},
  {code:'ENT 416',title:'Practice of Entrepreneurship II',units:2,level:'HND 2',sem:1,option:'Power and Machines'},
  // HND 2 Semester 1 — Electronics & Telecom
  {code:'EEC 411',title:'Electromagnetic Field Theory',units:2,level:'HND 2',sem:1,option:'Electronics and Telecommunication'},
  {code:'EEC 413',title:'Control Engineering System',units:3,level:'HND 2',sem:1,option:'Electronics and Telecommunication'},
  {code:'EEC 419',title:'Project I',units:2,level:'HND 2',sem:1,option:'Electronics and Telecommunication'},
  {code:'EEE 414',title:'Analogue Electronics III',units:3,level:'HND 2',sem:1,option:'Electronics and Telecommunication'},
  {code:'EEE 415',title:'Digital Communication II',units:3,level:'HND 2',sem:1,option:'Electronics and Telecommunication'},
  {code:'EEE 417',title:'Electronic Design and Drafting',units:3,level:'HND 2',sem:1,option:'Electronics and Telecommunication'},
  {code:'EEE 418',title:'Microprocessor Applications',units:3,level:'HND 2',sem:1,option:'Electronics and Telecommunication'},
  {code:'EEI 411',title:'Electronic Measurement and Control IV',units:3,level:'HND 2',sem:1,option:'Electronics and Telecommunication'},
  {code:'MTH 411',title:'Numerical Methods',units:2,level:'HND 2',sem:1,option:'Electronics and Telecommunication'},
  {code:'ENT 416',title:'Practice of Entrepreneurship II',units:2,level:'HND 2',sem:1,option:'Electronics and Telecommunication'},
  // HND 2 Semester 2 — Power & Machines
  {code:'EEC 428',title:'Microcontroller Applications',units:2,level:'HND 2',sem:2,option:'Power and Machines'},
  {code:'EEC 429',title:'Project II',units:6,level:'HND 2',sem:2,option:'Power and Machines'},
  {code:'EEP 424',title:'Electrical Maintenance and Repair',units:3,level:'HND 2',sem:2,option:'Power and Machines'},
  {code:'EEP 426',title:'Electrical Power System V',units:3,level:'HND 2',sem:2,option:'Power and Machines'},
  {code:'EEP 427',title:'Electrical Machines V',units:3,level:'HND 2',sem:2,option:'Power and Machines'},
  {code:'ICT 428',title:'Computer Programming Using C++',units:3,level:'HND 2',sem:2,option:'Power and Machines'},
  {code:'MTH 423',title:'Statistical Methods',units:2,level:'HND 2',sem:2,option:'Power and Machines'},
  // HND 2 Semester 2 — Electronics & Telecom
  {code:'EEC 428',title:'Microcontroller Applications',units:2,level:'HND 2',sem:2,option:'Electronics and Telecommunication'},
  {code:'EEC 429',title:'Project II',units:6,level:'HND 2',sem:2,option:'Electronics and Telecommunication'},
  {code:'EEE 425',title:'Digital Communication III',units:3,level:'HND 2',sem:2,option:'Electronics and Telecommunication'},
  {code:'EEE 426',title:'Electrical/Electronic Maintenance and Repair',units:2,level:'HND 2',sem:2,option:'Electronics and Telecommunication'},
  {code:'EEE 427',title:'Computer Hardware Maintenance and Repair',units:3,level:'HND 2',sem:2,option:'Electronics and Telecommunication'},
  {code:'ICT 428',title:'Computer Programming Using C++',units:2,level:'HND 2',sem:2,option:'Electronics and Telecommunication'},
  {code:'MTH 423',title:'Statistical Methods',units:3,level:'HND 2',sem:2,option:'Electronics and Telecommunication'},
];

// ── MATRIC NUMBER PARSER ───────────────────────────────────────────
// Format: YYY + PPPPP + NNN
// YYY: year (e.g. 190=2019, 220=2022)
// PPPPP: 10611=ND EEE, 13731=HND Power, 13631=HND Electronics
// NNN: serial
function parseMatric(val) {
  const el = document.getElementById('matric-parsed');
  const levelEl = document.getElementById('rlevel');
  const optEl = document.getElementById('roption');
  const noteEl = document.getElementById('level-auto-note');
  val = val.trim().replace(/\s/g,'');
  if (val.length < 8) { el.style.display='none'; return; }
  // Extract components
  const yyy = val.substring(0, 3);
  const ppppp = val.substring(3, 8);
  const nnn = val.substring(8, 11);
  // Decode year flexibly: 190→2019, 220→2022, 240→2024, 250→2025 etc.
  const yearBase = parseInt(yyy);
  // If 3-digit: treat as offset from 1900 if >=100, giving 2019 for 190, 2024 for 240 etc.
  const fullYear = 1900 + yearBase;
  // Decode programme
  const programmes = {
    '10611': { level: 'ND', name: 'ND Electrical/Electronics Engineering Technology', option: '' },
    '13731': { level: 'HND', name: 'HND Electrical/Electronics (Power & Machines)', option: 'Power and Machines' },
    '13631': { level: 'HND', name: 'HND Electrical/Electronics (Electronics & Telecom)', option: 'Electronics and Telecommunication' },
  };
  const prog = programmes[ppppp];
  if (!prog) {
    // Unknown programme code — still show what we decoded
    el.innerHTML = `Year: ${fullYear} · Programme code: ${ppppp} · Serial: ${nnn||'---'} (unrecognised code — fill level manually)`;
    el.style.display = 'block';
    return;
  }
  el.innerHTML = `Year: ${fullYear} · ${prog.name} · Serial: ${nnn||'---'}`;
  el.style.display = 'block';
  // Auto-fill level hint (ND 1 or ND 2 depends on year vs current)
  noteEl.textContent = '(auto-detected from matric)';
  // Pre-fill option for HND
  if (prog.option && optEl) {
    optEl.value = prog.option;
    document.getElementById('opt-row').style.display = 'block';
  }
}

// ── STATE ─────────────────────────────────────────────────────────
let loaded=false,stream=null,liveOn=false,liveAF=null,fps=0,fpsi=null;
let samples=[],sessionMarked=new Set(),fails=0,matcher=null;
let activeCourse=null,selCourseTemp=null;
let currentUser=null,currentUserRole=null,currentUserName=null;
let students=[],weeklyData={};
let appFB=null,authFB=null,dbFB=null;
// ── ACTIVE SESSION STATE (loaded from Firestore, set by HOD) ──────
let activeSession='';   // e.g. "2024/2025"
let activeSemester='';  // e.g. "1st Semester"
function getAcademicSession(){ return activeSession||_autoSession(); }
function getSemester(){ return activeSemester||_autoSemester(); }
function _autoSession(){
  const now=new Date(),m=now.getMonth()+1,y=now.getFullYear();
  const s=m>=8?y:y-1; return s+'/'+(s+1);
}
function _autoSemester(){
  const m=new Date().getMonth()+1;
  return (m>=8||m<=1)?'1st Semester':'2nd Semester';
}
async function loadActiveSessionFromDB(){
  try{
    const d=await dbFB.collection('settings').doc('academic').get();
    if(d.exists&&d.data().session){
      activeSession=d.data().session;
      activeSemester=d.data().semester||_autoSemester();
      // FIX 7: Load HOD-configured max weeks if set
      if(d.data().maxWeeks) MAX_WEEKS=parseInt(d.data().maxWeeks)||15;
    }
    else{ activeSession=_autoSession(); activeSemester=_autoSemester(); }
  }catch(e){ activeSession=_autoSession(); activeSemester=_autoSemester(); }
}

// ── INIT FIREBASE ─────────────────────────────────────────────────
function initFirebase(){
  try{
    if(typeof firebase==='undefined') throw new Error('Firebase SDK not loaded');
    if(firebase.apps&&firebase.apps.length>0){
      appFB=firebase.apps[0];
    } else {
      appFB=firebase.initializeApp(FB_CFG);
    }
    authFB=firebase.auth(appFB);
    dbFB=firebase.firestore(appFB);
    return true;
  }catch(e){
    console.error('Firebase init failed:',e);
    return false;
  }
}

// ── BOOT ──────────────────────────────────────────────────────────
async function bootApp(){
  const mk=i=>['ls1','ls2','ls3','ls4'].forEach((id,j)=>document.getElementById(id).className='ld-step'+(j<i?' done':j===i?' active':''));
  const bar=(p,t)=>{document.getElementById('lbar').style.width=p+'%';document.getElementById('lmsg').textContent=t;};

  mk(0);bar(10,'Connecting to Firebase...');
  try{
    await Promise.race([
      dbFB.collection('_ping').doc('t').set({t:Date.now()}),
      new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),5000))
    ]);
    addLog('ok','Firebase connected');
  }catch(e){addLog('warn','Firebase ping skipped: '+e.message);}

  mk(1);bar(35,'Loading face detector...');
  await new Promise(r=>{
    const c=setInterval(()=>{if(typeof faceapi!=='undefined'){clearInterval(c);r();}},150);
    setTimeout(()=>{clearInterval(c);r();},5000);
  });
  if(typeof faceapi!=='undefined'){
    try{await faceapi.nets.tinyFaceDetector.loadFromUri(MDL);}catch(e){addLog('warn','Face detector: '+e.message);}
    mk(2);bar(68,'Loading recognition model...');
    try{await faceapi.nets.faceLandmark68TinyNet.loadFromUri(MDL);}catch(e){addLog('warn','Landmark model: '+e.message);}
    try{await faceapi.nets.faceRecognitionNet.loadFromUri(MDL);}catch(e){addLog('warn','Recognition model: '+e.message);}
  } else {
    addLog('warn','face-api not loaded — face recognition unavailable');
    mk(2);bar(68,'Skipped face models...');
  }

  mk(3);bar(90,'Loading student database...');
  await loadActiveSessionFromDB();
  await Promise.race([loadStudents(), new Promise(r=>setTimeout(r,3000))]);
  await Promise.race([loadMasterList(), new Promise(r=>setTimeout(r,3000))]);
  bar(100,'Ready!');
  loaded=true;
  // FIX 16: Don't buildMatcher here — descriptors load lazily when scan tab opens

  setTimeout(()=>{
    const l=document.getElementById('ld');l.style.opacity='0';
    setTimeout(()=>{l.style.display='none';showLogin();},600);
  },400);
}

// ── LOGIN TABS ────────────────────────────────────────────────────
// ── PASSWORD SHOW/HIDE ────────────────────────────────────────────
function togglePw(inputId, btn) {
  const inp = document.getElementById(inputId);
  if (inp.type === 'password') {
    inp.type = 'text';
    btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
    btn.style.color = '#0057FF';
  } else {
    inp.type = 'password';
    btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-glow"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
    btn.style.color = '#94a3b8';
  }
}

// ── FORGOT PASSWORD ───────────────────────────────────────────────
async function doForgotPassword() {
  const email = document.getElementById('l-email').value.trim();
  if (!email) {
    showLoginErr('Enter your email address first, then tap Forgot Password.');
    return;
  }
  document.getElementById('lerr').style.display = 'none';
  try {
    await authFB.sendPasswordResetEmail(email);
    showLoginErr('Password reset email sent to ' + email + '. Check your inbox (and spam folder).');
    document.getElementById('lerr').style.backgroundColor = 'rgba(0,192,106,.1)';
    document.getElementById('lerr').style.borderColor = '#6EE7B7';
    document.getElementById('lerr').style.color = '#00C06A';
    addLog('info', 'Password reset sent to: ' + email);
  } catch(e) {
    let msg = e.message;
    if (e.code === 'auth/user-not-found') msg = 'No account found with that email address.';
    if (e.code === 'auth/invalid-email') msg = 'Please enter a valid email address.';
    showLoginErr(msg);
  }
}

function setLTab(mode){
  ['lecturer','student','hod'].forEach(m=>{
    const lt = document.getElementById('lt-'+m);
    const lf = document.getElementById('lf-'+m);
    if(lt) lt.classList.toggle('active',m===mode);
    if(lf) lf.classList.toggle('show',m===mode);
  });
  document.getElementById('lerr').style.display='none';
  const notes={
    lecturer:'New? Tap <b>Register</b> to create your account with your HOD\'s secret code.',
    student:'Tap <b>Enroll Face</b> to register or <b>My Attendance</b> to view your records.',
    hod:'HOD / Administrator access only.'
  };
  document.getElementById('lnote').innerHTML=notes[mode]||'';
  const lnote2 = document.getElementById('lnote2');
  if (lnote2) lnote2.style.display = mode === 'lecturer' ? 'block' : 'none';
  if(mode==='lecturer') renderRegCoursePicker();
  if(mode==='student') setStudentMode('enroll');
}

function setLecturerSub(sub){
  const loginSec = document.getElementById('lec-login-section');
  const regSec = document.getElementById('lec-register-section');
  const loginBtn = document.getElementById('lt-sub-login');
  const regBtn = document.getElementById('lt-sub-register');
  if(sub==='login'){
    if(loginSec) loginSec.style.display='block';
    if(regSec) regSec.style.display='none';
    if(loginBtn){loginBtn.style.background='linear-gradient(135deg,#003DCC,#0057FF)';loginBtn.style.color='white';}
    if(regBtn){regBtn.style.background='transparent';regBtn.style.color='rgba(255,255,255,0.5)';}
  } else {
    if(loginSec) loginSec.style.display='none';
    if(regSec) regSec.style.display='block';
    if(regBtn){regBtn.style.background='linear-gradient(135deg,#00C06A,#008F4E)';regBtn.style.color='white';}
    if(loginBtn){loginBtn.style.background='transparent';loginBtn.style.color='rgba(255,255,255,0.5)';}
    renderRegCoursePicker();
  }
}

function setStudentMode(mode) {
  const enrollSection = document.getElementById('st-enroll-section');
  const recordSection = document.getElementById('st-record-section');
  const enrollBtn    = document.getElementById('st-mode-enroll');
  const recordBtn    = document.getElementById('st-mode-record');
  if(!enrollSection || !recordSection) return;

  if(mode === 'enroll'){
    enrollSection.style.display = 'block';
    recordSection.style.display = 'none';
    if(enrollBtn){ enrollBtn.style.background='linear-gradient(135deg,#003DCC,#0057FF)'; enrollBtn.style.color='white'; }
    if(recordBtn){ recordBtn.style.background='transparent'; recordBtn.style.color='rgba(255,255,255,0.5)'; }
  } else {
    enrollSection.style.display = 'none';
    recordSection.style.display = 'block';
    if(recordBtn){ recordBtn.style.background='linear-gradient(135deg,#00C06A,#008F4E)'; recordBtn.style.color='white'; }
    if(enrollBtn){ enrollBtn.style.background='transparent'; enrollBtn.style.color='rgba(255,255,255,0.5)'; }
    // Clear and reset the record lookup
    const matricEl = document.getElementById('mr-matric');
    if(matricEl) matricEl.value='';
    const statusEl = document.getElementById('mr-status');
    if(statusEl) statusEl.style.display='none';
    const resultsEl = document.getElementById('mr-results');
    if(resultsEl) resultsEl.style.display='none';
    const excuseEl = document.getElementById('mr-excuse-section');
    if(excuseEl) excuseEl.style.display='none';
  }
}

function clearAllLoginForms(){
  // Lecturer login
  const le=document.getElementById('l-email');const lp=document.getElementById('l-pass');
  if(le)le.value='';if(lp){lp.value='';lp.type='password';}
  // HOD login
  const ae=document.getElementById('a-email');const ap=document.getElementById('a-pass');
  if(ae)ae.value='';if(ap){ap.value='';ap.type='password';}
  // Register form
  ['r-code','r-name','r-email','r-pass','r-pass2'].forEach(id=>{
    const el=document.getElementById(id);
    if(el){el.value='';if(el.type==='password')el.type='password';}
  });
  // Student form
  const sm=document.getElementById('st-matric');if(sm)sm.value='';
  const ss=document.getElementById('st-matric-status');if(ss)ss.style.display='none';
  const sd=document.getElementById('st-details-block');if(sd)sd.style.display='none';
  // Reset pw-eye buttons
  document.querySelectorAll('.pw-eye').forEach(b=>{b.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-glow"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';b.style.color='rgba(255,255,255,0.5)';});
  // Clear error
  const lerr=document.getElementById('lerr');if(lerr){lerr.style.display='none';lerr.textContent='';}
  // Reset to Lecturer tab with Login sub-tab
  setLTab('lecturer');
  setLecturerSub('login');
}

function showLogin(){
  clearAllLoginForms();
  document.getElementById('login-screen').classList.add('show');
}

function showLoginErr(msg){const el=document.getElementById('lerr');el.textContent=msg;el.style.display='block';}

async function doLogin(){
  const email=document.getElementById('l-email').value.trim();
  const pass=document.getElementById('l-pass').value;
  document.getElementById('lerr').style.display='none';
  if(!email||!pass){showLoginErr('Enter email and password.');return;}
  try{await _signIn(email,pass);}
  catch(e){let m=e.message;if(e.code==='auth/invalid-credential'||e.code==='auth/wrong-password')m='Incorrect email or password.';if(e.code==='auth/too-many-requests')m='Too many attempts. Try later.';showLoginErr(m);}
}

async function doAdminLogin(){
  const email=document.getElementById('a-email').value.trim();
  const pass=document.getElementById('a-pass').value;
  document.getElementById('lerr').style.display='none';
  if(!email||!pass){showLoginErr('Enter admin email and password.');return;}
  try{await _signIn(email,pass,'admin');}
  catch(e){let m=e.message;if(e.code==='auth/invalid-credential'||e.code==='auth/wrong-password')m='Incorrect admin credentials.';showLoginErr(m);}
}

async function doRegister(){
  const code=document.getElementById('r-code').value.trim();
  const name=document.getElementById('r-name').value.trim();
  const email=document.getElementById('r-email').value.trim();
  const pass=document.getElementById('r-pass').value;
  const pass2=document.getElementById('r-pass2').value;
  document.getElementById('lerr').style.display='none';
  if(!code||!name||!email||!pass||!pass2){showLoginErr('Fill in all fields.');return;}
  if(pass!==pass2){showLoginErr('Passwords do not match.');return;}
  if(pass.length<6){showLoginErr('Password must be at least 6 characters.');return;}
  try{
    const sd=await dbFB.collection('settings').doc('auth').get();
    if(!sd.exists){showLoginErr('No secret code set yet. Ask HOD to set it in Admin tab.');return;}
    if(code!==sd.data().secretCode){showLoginErr('Incorrect department code. Contact your HOD.');return;}
    const cred=await authFB.createUserWithEmailAndPassword(email,pass);
    const assignedCourses = [...regSelectedCourses];
    const regData = { email, name, role:'pending', assignedCourses, registeredAt: new Date().toISOString() };
    await dbFB.collection('users').doc(cred.user.uid).set(regData);
    // Also write to pending_registrations (admin-readable without restrictive user rule)
    try{ await dbFB.collection('pending_registrations').doc(cred.user.uid).set(regData); }catch(e){/* non-critical */}
    // Sign out immediately — they need HOD approval before they can log in
    await authFB.signOut();
    document.getElementById('lerr').style.display='none';
    // Show pending message instead of logging them in
    const el = document.getElementById('lform-register');
    if(el) el.innerHTML = `<div style="background:rgba(0,192,106,.1);border:1.5px solid #6EE7B7;border-radius:10px;padding:16px;text-align:center;margin-top:8px;">
      <div style="margin-bottom:6px;"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg></div>
      <div style="font-size:14px;font-weight:800;color:#065f46;margin-bottom:4px">Registration Submitted!</div>
      <div style="font-size:12px;color:#008F4E;line-height:1.6">Your account for <b>${name}</b> is pending HOD approval.<br>You will be notified when access is granted. Return to <b>Login</b> after approval.</div>
    </div>`;
    addLog('ok','New lecturer registered (PENDING approval): '+name+' — '+email);
  }catch(e){let m=e.message;if(e.code==='auth/email-already-in-use')m='Email already registered. Use Login tab.';showLoginErr(m);}
}

async function _signIn(email,pass,expectedRole){
  const cred=await authFB.signInWithEmailAndPassword(email,pass);
  const doc=await dbFB.collection('users').doc(cred.user.uid).get();
  if(!doc.exists){await authFB.signOut();throw new Error('Account not in system. Use Register tab if new.');}
  const ud=doc.data();
  if(ud.role==='pending'){
    await authFB.signOut();
    throw new Error('Your account is pending HOD approval. Please wait for the HOD to activate your account, then try logging in again.');
  }
  if(expectedRole==='admin'&&ud.role!=='admin'){await authFB.signOut();throw new Error('Not an admin account. Use Login tab.');}
  currentUser=cred.user;currentUserRole=ud.role;currentUserName=ud.name||email;
  document.getElementById('login-screen').classList.remove('show');
  showMainApp();
  loadLogoFromCloud();
  // FIX 3: Check if weekly backup is due (HOD only)
  if(ud.role==='admin') checkScheduledBackup();
  addLog('ok','Logged in: '+currentUserName+' ('+currentUserRole+')');
}

async function doLogout(){
  if(!confirm('Logout?'))return;
  clearTimeout(_idleTimer);
  await authFB.signOut().catch(()=>{});
  currentUser=null;currentUserRole=null;currentUserName=null;
  // Stop any active camera streams
  if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}
  if(enrollStream){enrollStream.getTracks().forEach(t=>t.stop());enrollStream=null;}
  if(spStream){spStream.getTracks().forEach(t=>t.stop());spStream=null;}
  // Reset session state
  sessionMarked=new Set();
  activeCourse=null;
  // Hide main app
  document.getElementById('main-hdr').style.display='none';
  document.getElementById('session-bar').style.display='none';
  document.getElementById('main-nav').style.display='none';
  document.getElementById('main-body').style.display='none';
  // Hide student portal if open
  const portal=document.getElementById('student-portal');
  if(portal)portal.style.display='none';
  // Clear all login forms and show login screen
  showLogin();
  addLog('info','Logged out — session cleared');
}

function showMainApp(){
  document.getElementById('main-hdr').style.display='block';
  document.getElementById('session-bar').style.display='flex';
  document.getElementById('main-nav').style.display='flex';
  document.getElementById('main-body').style.display='block';
  const roleLabel=currentUserRole==='admin'?'HOD / Administrator':'Lecturer';
  document.getElementById('hdr-user').textContent=currentUserName+' ('+roleLabel+')';
  document.getElementById('bcam').disabled=false;
  const bflip=document.getElementById('bflip');if(bflip)bflip.disabled=false;
  if(currentUserRole==='admin'){
    document.getElementById('nt-admin').style.display='flex';
    document.getElementById('nt-enroll').style.display='flex';
    // HOD sees enroll cam controls
    const ecc=document.getElementById('enroll-cam-controls');
    if(ecc) ecc.style.display='flex';
  } else {
    // Lecturers: hide enroll tab and admin-only controls
    document.getElementById('nt-enroll').style.display='none';
    const ca=document.getElementById('btn-clearall');
    if(ca)ca.style.display='none';
  }
  updateClock();updateWeekDisplay();
  renderList();refreshAdminDashboard();
  updateOfflineQueueBanner();
  // Load lecturer's assigned courses for filtering
  loadLecturerCourses().then(() => {
    addLog('info', currentUserRole === 'admin' ? 'HOD: full course access' : 'Courses filtered to assigned only');
  });
  // Show welcome overlay
  showWelcome();
}


// ── WELCOME OVERLAY ───────────────────────────────────────────────
function showWelcome(){
  const roleLabel=currentUserRole==='admin'?'HOD / Administrator':'Lecturer';
  document.getElementById('wlc-name').textContent='Welcome, '+currentUserName;
  document.getElementById('wlc-role').textContent=roleLabel+' — EEE Department';
  document.getElementById('wlc-session').textContent=getAcademicSession()+' · '+getSemester()+' · Week '+currentWeek;
  // Show assigned courses for lecturers
  const wlcExtra=document.getElementById('wlc-extra');
  if(wlcExtra){
    if(currentUserRole!=='admin'&&lecturerCourses.length){
      const names=lecturerCourses.slice(0,5).map(k=>{
        const parts=k.split('_');
        return parts[0]+(parts[1]?' '+parts[1]:'');
      });
      wlcExtra.innerHTML='<div style="font-size:11px;color:var(--txt2);background:var(--blue-l);border-radius:8px;padding:8px 12px;margin-bottom:12px;line-height:1.6;border:1px solid var(--blue-b);"><b>Your Courses:</b> '+names.join(', ')+(lecturerCourses.length>5?' + '+(lecturerCourses.length-5)+' more':'')+' </div>';
    } else if(currentUserRole==='admin'){
      wlcExtra.innerHTML='<div style="font-size:11px;color:var(--teal);background:var(--teal-l);border-radius:8px;padding:8px 12px;margin-bottom:12px;line-height:1.6;border:1px solid var(--teal-b);">Full system access — all courses visible</div>';
    } else {wlcExtra.innerHTML='';}
  }
  const wl=document.getElementById('mwelcome');
  wl.classList.add('open');
  setTimeout(()=>{wl.classList.remove('open');},4000);
}

// ── SESSION MANAGEMENT (HOD only) ─────────────────────────────────
function openSessionManager(){
  if(currentUserRole!=='admin'){alert('Only the HOD can change academic session.');return;}
  document.getElementById('sm-session').value=activeSession||_autoSession();
  document.getElementById('sm-sem').value=activeSemester||_autoSemester();
  openM('msession');
}
async function saveSessionSettings(){
  const sess=document.getElementById('sm-session').value.trim();
  const sem=document.getElementById('sm-sem').value;
  if(!sess){alert('Enter a valid session e.g. 2024/2025');return;}
  const semChanged=(sem!==activeSemester)&&activeSemester!=='';
  try{
    await dbFB.collection('settings').doc('academic').set({session:sess,semester:sem,updatedBy:currentUserName,updatedAt:new Date().toISOString()});
    const prevSem=activeSemester;
    activeSession=sess; activeSemester=sem;
    if(semChanged){
      // Reset week counter on semester change
      manualWeekOffset=0;
      lsSet('weekOffset','0');
      addLog('warn','Semester changed from '+prevSem+' to '+sem+' — week reset to 1');
    }
    updateClock();updateWeekDisplay();
    closeM('msession');
    setAdminSt('Session updated to '+sess+' · '+sem+(semChanged?' · Week reset to 1':''),'ok');
    addLog('ok','Session set: '+sess+' '+sem+' by '+currentUserName);
  }catch(e){alert('Save failed: '+e.message);}
}

// ── ARCHIVE / HISTORY VIEWER (HOD only) ───────────────────────────
async function openArchive(){
  if(currentUserRole!=='admin'){alert('Only the HOD can view historical records.');return;}
  // Archive needs ALL historical data — use unfiltered load
  await loadWeeklyDataFull();
  const sessions=new Set();
  Object.values(weeklyData).forEach(d=>Object.keys(d).forEach(k=>{
    const parts=k.split('_');
    if(parts.length>=4){
      // key format: CODE_YEAR1_YEAR2_SEM_SEM_wkN
      // extract session from key: find pattern YYYY_YYYY
      const m=k.match(/(\d{4}_\d{4})/);
      const sm=k.match(/(1st_Semester|2nd_Semester)/);
      if(m&&sm) sessions.add(m[1].replace('_','/')+'||'+sm[1].replace('_',' '));
    }
  }));
  const sel=document.getElementById('arch-session');
  sel.innerHTML='<option value="">— Select Session —</option>';
  [...sessions].sort().reverse().forEach(s=>{
    const [sess,sem]=s.split('||');
    const opt=document.createElement('option');
    opt.value=s; opt.textContent=sess+' · '+sem;
    sel.appendChild(opt);
  });
  // Also add current session
  const cur=activeSession+'||'+activeSemester;
  if(![...sessions].includes(cur)){
    const opt=document.createElement('option');
    opt.value=cur; opt.textContent=activeSession+' · '+activeSemester+' (current)';
    sel.insertBefore(opt,sel.children[1]);
  }
  // Populate course dropdown
  const courseSel = document.getElementById('arch-course');
  courseSel.innerHTML = '<option value="">— All Courses —</option>';
  // Collect unique course codes from COURSES array
  const seenCodes = new Set();
  COURSES.forEach(c => {
    if (!seenCodes.has(c.code)) {
      seenCodes.add(c.code);
      const opt = document.createElement('option');
      opt.value = c.code;
      opt.textContent = c.code + ' — ' + c.title;
      courseSel.appendChild(opt);
    }
  });
  document.getElementById('arch-results').innerHTML='<div style="font-size:12px;color:var(--txt3);text-align:center;padding:20px">Select a session and optionally a course above to view records</div>';
  openM('marchive');
}
async function loadArchiveData(){
  const sessVal=document.getElementById('arch-session').value;
  const courseCode=document.getElementById('arch-course').value.trim();
  if(!sessVal){alert('Select a session.');return;}
  const [sess,sem]=sessVal.split('||');
  await loadWeeklyDataFull(); // needs all historical data
  const sessKey=sess.replace('/','_')+'_'+sem.replace(' ','_');
  const matchStudents=students.filter(u=>{
    if(!weeklyData[u.matric])return false;
    return Object.keys(weeklyData[u.matric]).some(k=>k.includes(sessKey)&&(!courseCode||k.startsWith(courseCode.replace(' ','_'))));
  });
  if(!matchStudents.length){
    document.getElementById('arch-results').innerHTML='<div style="font-size:12px;color:var(--txt3);text-align:center;padding:20px">No records found for this selection</div>';
    return;
  }
  let html='<div style="font-size:11px;font-weight:700;color:var(--navy);margin-bottom:8px">'+sess+' · '+sem+(courseCode?' · '+courseCode:'')+'</div>';
  html+='<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11px">';
  html+='<tr style="background:var(--navy);color:#fff"><th style="padding:6px 8px;text-align:left">Name</th><th style="padding:6px 8px">Matric</th><th style="padding:6px 8px">Level</th><th style="padding:6px 8px">Present</th><th style="padding:6px 8px">%</th></tr>';
  matchStudents.forEach((u,i)=>{
    let present=0,total=0;
    for(let w=1;w<=MAX_WEEKS;w++){
      const allKeys=Object.keys(weeklyData[u.matric]||{}).filter(key=>key.includes(sessKey)&&key.endsWith('_wk'+w)&&(!courseCode||key.startsWith(courseCode.replace(' ','_'))));
      allKeys.forEach(key=>{total++;if(weeklyData[u.matric][key].status==='P')present++;});
    }
    const pct=total>0?Math.round(present/total*100):0;
    const bg=i%2===0?'#f8faff':'#fff';
    const pctCol=pct<75?'var(--red)':pct>=75?'var(--green)':'var(--amber)';
    html+=`<tr style="background:${bg}"><td style="padding:5px 8px;font-weight:600">${esc(u.name)}</td><td style="padding:5px 8px;font-family:monospace">${esc(u.matric)}</td><td style="padding:5px 8px">${esc(u.level)}</td><td style="padding:5px 8px;text-align:center">${present}/${total}</td><td style="padding:5px 8px;text-align:center;font-weight:800;color:${pctCol}">${pct}%</td></tr>`;
  });
  html+='</table></div>';
  document.getElementById('arch-results').innerHTML=html;
}
async function exportArchiveCSV(){
  const sessVal=document.getElementById('arch-session').value;
  if(!sessVal){alert('Select a session first.');return;}
  const [sess,sem]=sessVal.split('||');
  await loadWeeklyDataFull(); // needs all historical data
  const sessKey=sess.replace('/','_')+'_'+sem.replace(' ','_');
  let csv='THE GATEWAY POLYTECHNIC SAAPADE\nDEPARTMENT OF ELECTRICAL & ELECTRONIC ENGINEERING TECHNOLOGY\n';
  csv+=`HISTORICAL ATTENDANCE REPORT\nSession:,${sess}\nSemester:,${sem}\nExported By:,${currentUserName}\n\n`;
  csv+='Matric,Name,Level,Option,Course,Week,Status,Date\n';
  students.forEach(u=>{
    Object.entries(weeklyData[u.matric]||{}).forEach(([k,v])=>{
      if(k.includes(sessKey)) csv+=`"${u.matric}","${u.name}","${u.level}","${u.option||'General'}","${k}","${v.week}","${v.status}","${v.date||''}"\n`;
    });
  });
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));
  a.download=`GAPOSA_EEE_ARCHIVE_${sess.replace('/','_')}_${sem.replace(' ','_')}.csv`;
  a.click();
}
// ── SCHOOL LOGO & REPORT HEADER ───────────────────────────────────
// To use your real school logo: replace SCHOOL_LOGO_URL with a Base64
// data URL (e.g. data:image/png;base64,AAAA...) or upload logo image
// in Settings → School Logo (coming soon). For now uses school initials badge.
const SCHOOL_LOGO_URL = (function(){
  try{ return lsGet('schoolLogoDataUrl') || ''; }catch(e){ return ''; }
})();

function getReportHeader(subtitle) {
  // Always read fresh at print time — not from the startup constant
  const savedLogo = lsGet('schoolLogoDataUrl') || '';
  const logoHtml = savedLogo
    ? `<img src="${savedLogo}" style="width:70px;height:70px;object-fit:contain;display:block;" alt="School Logo">`
    : `<div style="width:70px;height:70px;border:2px solid #000;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:9px;font-weight:900;text-align:center;line-height:1.3;color:#000;font-family:Arial,sans-serif;">GATEWAY<br>POLY<br>GAPOSA</div>`;
  return `
    <div style="display:flex;align-items:center;gap:14px;border-bottom:2px solid #000;padding-bottom:10px;margin-bottom:14px;">
      ${logoHtml}
      <div style="flex:1;">
        <div style="font-size:17px;font-weight:900;color:#000;letter-spacing:.3px;line-height:1.2;">THE GATEWAY POLYTECHNIC, SAAPADE</div>
        <div style="font-size:11px;color:#333;margin-top:3px;">Department of Electrical &amp; Electronic Engineering Technology</div>
        ${subtitle ? `<div style="font-size:12px;font-weight:700;color:#000;margin-top:5px;text-transform:uppercase;letter-spacing:.5px;border-top:1px solid #ccc;padding-top:4px;">${subtitle}</div>` : ''}
      </div>
    </div>`;
}

function getReportStyles() {
  return `<style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 12px; color: #000; background: #fff; padding: 18px 22px; }
    h3 { font-size: 13px; font-weight: bold; margin: 10px 0 4px 0; border-bottom: 1px solid #000; padding-bottom: 3px; }
    .meta { font-size: 11px; color: #333; margin-bottom: 3px; line-height: 1.6; }
    .meta b { color: #000; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 11px; }
    th { background: #f0f0f0; color: #000; border: 1px solid #999; padding: 6px 8px; text-align: left; font-weight: bold; font-size: 11px; }
    td { padding: 5px 8px; border: 1px solid #ccc; vertical-align: middle; }
    tr:nth-child(even) td { background: #fafafa; }
    .ok  { font-weight: bold; }
    .low { font-weight: bold; text-decoration: underline; }
    .badge { display: inline-block; border: 1px solid #999; padding: 1px 6px; font-size: 10px; font-weight: bold; border-radius: 3px; }
    .section-hdr td { background: #e8e8e8 !important; font-weight: bold; border: 1px solid #888; font-size: 11px; }
    .footer { margin-top: 18px; font-size: 10px; color: #555; text-align: center; border-top: 1px solid #bbb; padding-top: 8px; }
    .info-row { display: flex; gap: 20px; flex-wrap: wrap; margin-bottom: 10px; }
    .info-cell { font-size: 11px; }
    .info-cell span { font-weight: bold; }
    @media print {
      body { padding: 8px 12px; }
      @page { margin: 1cm; }
    }
  </style>`;
}

// ── SCHOOL LOGO UPLOAD (Admin Settings) ───────────────────────────
function triggerLogoUpload() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = function() {
    const file = inp.files[0];
    if (!file) return;
    if (file.size > 500*1024) { alert('Logo image must be under 500 KB.'); return; }
    const reader = new FileReader();
    reader.onload = async function(e) {
      const dataUrl = e.target.result;
      try {
        // Save to localStorage for instant access
        lsSet('schoolLogoDataUrl', dataUrl);
        // Also save to Firestore so any device can use it
        await dbFB.collection('settings').doc('logo').set({ dataUrl, uploadedBy: currentUserName, uploadedAt: new Date().toISOString() });
        alert('Logo saved to cloud! It will appear on all printed reports on any device.');
        renderLogoPreview();
      } catch(err) {
        // Firestore failed — still works locally
        lsSet('schoolLogoDataUrl', dataUrl);
        alert('Logo saved locally. Cloud save failed — it will only show on this device. (' + err.message + ')');
        renderLogoPreview();
      }
    };
    reader.readAsDataURL(file);
  };
  inp.click();
}

async function loadLogoFromCloud() {
  // Try loading from Firestore first, fall back to localStorage
  try {
    const doc = await dbFB.collection('settings').doc('logo').get();
    if (doc.exists && doc.data().dataUrl) {
      lsSet('schoolLogoDataUrl', doc.data().dataUrl);
      addLog('info', 'School logo loaded from cloud');
    }
  } catch(e) {
    addLog('info', 'Logo: using local cache (cloud load failed: ' + e.message + ')');
  }
}

async function loadAuditLog() {
  const el = document.getElementById('audit-log-list');
  if (!el) return;
  el.innerHTML = '<div style="font-size:12px;color:var(--txt3);text-align:center;padding:10px;">Loading...</div>';
  try {
    const snap = await dbFB.collection('audit_log').orderBy('timestamp','desc').limit(60).get();
    if (snap.empty) { el.innerHTML = '<div style="font-size:12px;color:var(--txt3);text-align:center;padding:12px;">No audit events recorded yet</div>'; return; }
    const typeLabels = {
      'attendance_correction': { icon:'✎', color:'var(--amber)', bg:'var(--amber-l)' },
      'week_change':           { icon:'◷', color:'var(--blue)',  bg:'var(--blue-l)'  },
      'lecturer_approved':     { icon:'✓', color:'var(--green)', bg:'var(--green-l)' },
      'lecturer_rejected':     { icon:'✕', color:'var(--red)',   bg:'var(--red-l)'   },
    };
    el.innerHTML = snap.docs.map(d => {
      const a = d.data();
      const ts = a.timestamp ? new Date(a.timestamp).toLocaleString('en-GB') : '—';
      const style = typeLabels[a.type] || { icon:'≡', color:'var(--txt2)', bg:'var(--bg)' };
      let detail = '';
      if (a.type === 'attendance_correction')
        detail = `${a.studentName} (${a.matric}) · ${a.course} Wk${a.week} · ${a.oldStatus} → ${a.newStatus} · by ${a.correctedBy}`;
      else if (a.type === 'week_change')
        detail = `Wk${a.from} → Wk${a.to} · ${a.session} ${a.semester} · by ${a.changedBy} (${a.role})`;
      else if (a.type === 'lecturer_approved')
        detail = `${a.name} approved by ${a.approvedBy}`;
      else if (a.type === 'lecturer_rejected')
        detail = `${a.name} rejected by ${a.rejectedBy}`;
      else detail = JSON.stringify(a).slice(0,80);
      return `<div style="display:flex;gap:8px;align-items:flex-start;padding:7px 10px;background:${style.bg};border:1px solid ${style.color}22;border-radius:7px;margin-bottom:5px;">
        <div style="font-size:14px;flex-shrink:0;margin-top:1px;">${style.icon}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:11px;font-weight:700;color:${style.color};">${a.type.replace(/_/g,' ').toUpperCase()}</div>
          <div style="font-size:11px;color:var(--txt2);line-height:1.5;word-break:break-word;">${detail}</div>
          <div style="font-size:10px;color:var(--txt3);margin-top:2px;">${ts}</div>
        </div>
      </div>`;
    }).join('');
  } catch(e) {
    el.innerHTML = '<div style="font-size:12px;color:var(--red);padding:10px;">Error: ' + e.message + '</div>';
    addLog('err', 'Audit log load failed: ' + e.message);
  }
}

async function exportAuditLogCSV() {
  const el = document.getElementById('audit-log-list');
  if(el) el.innerHTML = '<div style="font-size:12px;color:var(--txt3);text-align:center;padding:10px;">Fetching audit records...</div>';
  try {
    const snap = await dbFB.collection('audit_log').orderBy('timestamp','desc').limit(500).get();
    if(snap.empty){ alert('No audit entries to export yet.'); return; }
    const now = new Date();
    let csv = 'THE GATEWAY POLYTECHNIC SAAPADE\n';
    csv += 'DEPARTMENT OF ELECTRICAL & ELECTRONIC ENGINEERING TECHNOLOGY\n';
    csv += 'SYSTEM AUDIT LOG EXPORT\n';
    csv += `Exported By:,${currentUserName}\nExport Date:,${now.toLocaleDateString('en-GB')} ${now.toTimeString().slice(0,5)}\nTotal Entries:,${snap.size}\n\n`;
    csv += 'Timestamp,Event Type,Details,Performed By\n';
    snap.docs.forEach(d => {
      const a = d.data();
      const ts = a.timestamp ? new Date(a.timestamp).toLocaleString('en-GB') : '—';
      let details = '';
      if(a.type==='attendance_correction')
        details = `${a.studentName} (${a.matric}) | ${a.course} Week ${a.week} | ${a.oldStatus} → ${a.newStatus}`;
      else if(a.type==='week_change')
        details = `Week ${a.from} → Week ${a.to} | ${a.session} ${a.semester} | Role: ${a.role}`;
      else if(a.type==='lecturer_approved')
        details = `Approved: ${a.name}`;
      else if(a.type==='lecturer_rejected')
        details = `Rejected: ${a.name}`;
      else if(a.type==='master_list_cleared')
        details = `Deleted ${a.count} students from master list`;
      else
        details = JSON.stringify(a).slice(0,100);
      const by = a.correctedBy||a.changedBy||a.approvedBy||a.rejectedBy||a.clearedBy||'—';
      csv += `"${ts}","${a.type}","${details.replace(/"/g,"'")}","${by}"\n`;
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));
    a.download = `GAPOSA_EEE_AuditLog_${now.toLocaleDateString('en-GB').replace(/\//g,'-')}.csv`;
    a.click();
    addLog('info','Audit log exported: '+snap.size+' entries');
    loadAuditLog(); // refresh the display
  } catch(e) {
    alert('Export failed: '+e.message);
    addLog('err','Audit log export failed: '+e.message);
  }
}

function renderLogoPreview() {
  const el = document.getElementById('logo-preview-area');
  if (!el) return;
  const saved = (() => { try{ return lsGet('schoolLogoDataUrl')||''; }catch(e){ return ''; } })();
  if (saved) {
    el.innerHTML = `<div style="display:flex;align-items:center;gap:10px;padding:10px;background:var(--green-l);border:1.5px solid var(--green-b);border-radius:8px;">
      <img src="${saved}" style="width:48px;height:48px;object-fit:contain;border-radius:6px;border:1px solid var(--border)">
      <div style="flex:1;font-size:12px;color:var(--green);font-weight:700;">Logo uploaded — will appear on all printed reports</div>
      <button onclick="clearSchoolLogo()" style="background:var(--red-l);color:var(--red);border:none;border-radius:6px;padding:4px 10px;font-size:11px;font-weight:700;cursor:pointer;">Remove</button>
    </div>`;
  } else {
    el.innerHTML = `<div style="font-size:12px;color:var(--txt3);padding:8px;text-align:center;background:var(--bg);border-radius:8px;border:1.5px dashed var(--border2);">No logo uploaded yet — reports will show text badge</div>`;
  }
}

function copyFirestoreRules() {
  const rules = `rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    match /students/{matric} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && get(/databases/$(db)/documents/users/$(request.auth.uid)).data.role in ['admin','lecturer'];
    }
    match /weekly/{matric} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && get(/databases/$(db)/documents/users/$(request.auth.uid)).data.role in ['admin','lecturer'];
    }
    match /masterlist/{matric} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && get(/databases/$(db)/documents/users/$(request.auth.uid)).data.role == 'admin';
    }
    match /users/{uid} {
      allow read: if request.auth != null && request.auth.uid == uid;
      allow write: if request.auth != null && get(/databases/$(db)/documents/users/$(request.auth.uid)).data.role == 'admin';
      allow create: if request.auth != null;
    }
    match /settings/{doc} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && get(/databases/$(db)/documents/users/$(request.auth.uid)).data.role == 'admin';
    }
    match /audit_log/{entry} {
      allow read: if request.auth != null && get(/databases/$(db)/documents/users/$(request.auth.uid)).data.role == 'admin';
      allow create: if request.auth != null;
      allow update, delete: if false;
    }
  }
}`;
  navigator.clipboard.writeText(rules).then(() => {
    setAdminSt('Firestore rules copied! Go to Firebase Console → Firestore → Rules → paste and publish.', 'ok');
  }).catch(() => {
    const t = document.createElement('textarea');
    t.value = rules; document.body.appendChild(t); t.select(); document.execCommand('copy'); document.body.removeChild(t);
    setAdminSt('Rules copied! Go to Firebase Console → Firestore → Rules → paste and publish.', 'ok');
  });
  addLog('info', 'Firestore security rules copied to clipboard');
}

function clearSchoolLogo() {
  if (!confirm('Remove school logo from reports?')) return;
  try{ lsRemove('schoolLogoDataUrl'); }catch(e){}
  renderLogoPreview();
}


// ── XSS SANITIZER ─────────────────────────────────────────────────
function esc(str){
  if(!str)return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── NAMESPACED localStorage ────────────────────────────────────────
const LS_PREFIX='gaposa_eee_';
function lsGet(k){try{return localStorage.getItem(LS_PREFIX+k);}catch(e){return null;}}
function lsSet(k,v){try{localStorage.setItem(LS_PREFIX+k,v);}catch(e){}}
function lsRemove(k){try{localStorage.removeItem(LS_PREFIX+k);}catch(e){}}

let _descriptorsLoaded = false;

async function loadStudents(){
  // FIX 16: Load basic student info immediately (fast), but skip large descriptor arrays
  // Descriptors are loaded separately when scan tab is first opened
  try{
    const snap=await dbFB.collection('students').get();
    students=snap.docs.map(d=>{
      const data=d.data();
      // Store raw descriptor strings but DON'T parse them yet — saves memory + CPU on login
      return {...data, descriptors:[], _rawDescriptors: data.descriptors||[], photo: data.photo||''};
    });
    addLog('info',students.length+' students loaded (descriptors deferred)');
  }catch(e){addLog('err','Load students: '+e.message);students=[];}
}

async function loadDescriptorsIfNeeded(){
  // Called lazily when scan tab opens — parse descriptors only then
  if(_descriptorsLoaded) return;
  _descriptorsLoaded = true;
  students.forEach(u=>{
    if(u._rawDescriptors && u._rawDescriptors.length && !u.descriptors.length){
      u.descriptors = u._rawDescriptors.map(a=>{
        if(a instanceof Float32Array) return a;
        if(typeof a === 'string') return new Float32Array(a.split(',').map(Number));
        if(Array.isArray(a)) return new Float32Array(a);
        return new Float32Array(Object.values(a));
      });
    }
  });
  buildMatcher();
  addLog('info','Face descriptors parsed for '+students.length+' students');
}
async function loadWeeklyData(){
  try{
    // FIX 2: Only load attendance for CURRENT session — not all historical data
    // Key format includes session e.g. "EEC_111_2024_2025_1st_Semester_wk1"
    const sessKey = activeSession.replace('/','_') + '_' + activeSemester.replace(/\s/g,'_');
    const snap=await dbFB.collection('weekly').get();
    weeklyData={};
    snap.docs.forEach(d=>{
      const allEntries = d.data();
      // Filter to only entries belonging to the current session
      const filtered = {};
      Object.entries(allEntries).forEach(([k,v])=>{
        if(k.includes(sessKey)) filtered[k]=v;
      });
      if(Object.keys(filtered).length>0) weeklyData[d.id]=filtered;
    });
  }catch(e){addLog('err','Load weekly: '+e.message);}
}

async function loadWeeklyDataFull(){
  // Unfiltered version — used only for archive/historical views
  try{
    const snap=await dbFB.collection('weekly').get();
    weeklyData={};
    snap.docs.forEach(d=>{weeklyData[d.id]=d.data();});
  }catch(e){addLog('err','Load weekly (full): '+e.message);}
}
async function saveWeekly(matric,data){
  try{
    await dbFB.collection('weekly').doc(matric).set(data,{merge:true});
  }catch(e){
    if(_offlineQueueEnabled){
      const key=Object.keys(data).pop();
      offlineQueue.push({matric,data,key,ts:Date.now()});
      lsSet('offlineQueue',JSON.stringify(offlineQueue));
      updateOfflineQueueBanner();
      addLog('warn','Offline: scan queued for '+matric+' (will sync when online)');
    }else{
      addLog('err','Save failed (offline queue is Off): '+e.message);
      throw e; // bubble up so caller can show error to user
    }
  }
}

function buildMatcher(){
  // FIX 16: Only build if descriptors have been loaded; skip silently if not yet
  const ready = students.filter(u=>u.descriptors && u.descriptors.length>0);
  if(!ready.length){matcher=null;return;}
  matcher=new faceapi.FaceMatcher(ready.map(u=>new faceapi.LabeledFaceDescriptors(u.matric,u.descriptors)),0.42);
}

// ── DUPLICATE FACE DETECTION ──────────────────────────────────────
// Threshold: 0.45 (stricter than recognition 0.5).
// Fetches LIVE from Firestore so anonymous student portal always
// has the full database to compare against — not just in-memory.
const DUPE_THRESHOLD = 0.45;

async function checkFaceDuplicateLive(newDescriptors, excludeMatric) {
  // ALWAYS fetch fresh from Firestore — never use cached in-memory array.
  // If fetch fails (permission denied etc) we BLOCK enrollment — safe default.
  let allStudents = [];
  let fetchFailed = false;

  try {
    const snap = await dbFB.collection('students').get();
    allStudents = snap.docs.map(d => {
      const data = d.data();
      const descs = (data.descriptors || []).map(a => {
        if (typeof a === 'string') return new Float32Array(a.split(',').map(Number));
        if (Array.isArray(a)) return new Float32Array(a);
        if (a instanceof Float32Array) return a;
        return new Float32Array(Object.values(a));
      }).filter(d => d.length === 128);
      return { matric: data.matric, name: data.name, level: data.level, descriptors: descs };
    });
    addLog('info', 'Dupe check: fetched ' + allStudents.length + ' student(s) from DB');
  } catch(e) {
    fetchFailed = true;
    addLog('warn', 'Dupe check DB fetch failed: ' + e.message);
  }

  // If fetch failed — return sentinel so callers can block enrollment
  if (fetchFailed) return { fetchFailed: true };

  // Empty DB — first ever enrollment, nothing to compare against
  if (!allStudents.length) return null;

  // Filter out the student being re-enrolled (face update case)
  const compareAgainst = allStudents.filter(u =>
    excludeMatric ? u.matric !== excludeMatric : true
  );
  if (!compareAgainst.length) return null;

  let bestMatch = null;
  let bestDistance = 1;

  newDescriptors.forEach(newDesc => {
    compareAgainst.forEach(u => {
      u.descriptors.forEach(existingDesc => {
        try {
          const dist = faceapi.euclideanDistance(newDesc, existingDesc);
          if (dist < bestDistance) { bestDistance = dist; bestMatch = u; }
        } catch(e) {}
      });
    });
  });

  if (bestDistance <= DUPE_THRESHOLD) {
    return { student: bestMatch, distance: bestDistance, confidence: Math.round((1 - bestDistance) * 100) };
  }
  return null;
}

function showDupeModal(dupeResult, blockedMatric) {
  const matchInfo = `Matches: ${dupeResult.student.name} · ${dupeResult.student.matric} · ${dupeResult.student.level} — ${dupeResult.confidence}% similarity`;
  document.getElementById('dupe-match-info').textContent = matchInfo;
  openM('mdupe');
  addLog('warn', 'DUPLICATE FACE BLOCKED: ' + blockedMatric + ' matches ' + dupeResult.student.matric + ' [' + dupeResult.confidence + '%]');
}

function closeDupeModal() {
  closeM('mdupe');
  // If student portal is visible — kick them back to login
  const portal = document.getElementById('student-portal');
  if (portal && portal.style.display !== 'none') {
    spGoBackToLogin();
  }
}


// ── COURSE PICKER ─────────────────────────────────────────────────
let filtCourses=[...COURSES];
function filterCourses(){
  const q=document.getElementById('csearch').value.toLowerCase();
  const base=getFilteredCourses();
  filtCourses=base.filter(c=>c.code.toLowerCase().includes(q)||c.title.toLowerCase().includes(q)||c.level.toLowerCase().includes(q));
  renderCourseList();
}
function renderCourseList(){
  const el=document.getElementById('clist');
  if(!el) return; // modal not in DOM yet
  if(!filtCourses.length){el.innerHTML='<div style="text-align:center;color:var(--txt3);padding:16px;font-size:12px">No courses found</div>';return;}
  const seen=new Set();
  const unique=filtCourses.filter(c=>{const k=c.code+c.level+(c.option||'');if(seen.has(k))return false;seen.add(k);return true;});
  el.innerHTML=unique.map(c=>`
    <div class="ci ${selCourseTemp&&selCourseTemp.code===c.code&&selCourseTemp.level===c.level&&selCourseTemp.option===c.option?'sel':''}" onclick="selCourse('${c.code}','${c.level}','${c.option||''}')">
      <div class="ci-code">${c.code}</div>
      <div class="ci-info">
        <div class="ci-title">${c.title}</div>
        <div class="ci-meta">${c.level} · ${c.option||'General'} · Sem ${c.sem} · ${c.units} unit${c.units>1?'s':''}</div>
      </div>
      ${selCourseTemp&&selCourseTemp.code===c.code&&selCourseTemp.level===c.level?'<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>':''}
    </div>`).join('');
}
function selCourse(code,level,option){
  selCourseTemp=COURSES.find(c=>c.code===code&&c.level===level&&(c.option||'')===(option||''));
  renderCourseList();
}
function confirmCourse(){
  if(!selCourseTemp){alert('Select a course first.');return;}
  const prevCourseKey = activeCourse ? activeCourse.code+'_'+activeCourse.level : null;
  const newCourseKey = selCourseTemp.code+'_'+selCourseTemp.level;
  activeCourse=selCourseTemp;
  const sem=activeCourse.sem===1?'1st Semester':'2nd Semester';
  document.getElementById('cb-course').textContent=activeCourse.code+' — '+activeCourse.title;
  document.getElementById('cb-meta').textContent=activeCourse.level+' · '+(activeCourse.option||'General')+' · '+sem+' · '+activeCourse.units+' unit'+(activeCourse.units>1?'s':'');
  document.getElementById('wk-course-ttl').textContent=activeCourse.code+' — '+activeCourse.title;
  document.getElementById('wk-course-meta').textContent=activeCourse.level+' · '+(activeCourse.option||'General')+' · '+getAcademicSession()+' · '+getSemester();
  document.getElementById('bfin').disabled=false;
  // FIX 3: Always clear sessionMarked when course changes
  if(prevCourseKey !== newCourseKey) {
    sessionMarked.clear();
    addLog('info','Course changed — session marks cleared');
  }
  // FIX 4: Log and warn if lecturer is scanning a course not in their assigned list
  if(currentUserRole !== 'admin' && lecturerCourses.length > 0) {
    const key = activeCourse.code+'_'+activeCourse.level+'_'+(activeCourse.option||'');
    if(!lecturerCourses.includes(key)) {
      addLog('warn','UNASSIGNED COURSE SELECTED: '+currentUserName+' selected '+activeCourse.code+' which is not in their assigned courses');
      // Log to Firestore audit trail
      dbFB.collection('audit_log').add({
        type:'unassigned_course_scan_attempt',
        course: activeCourse.code, courseTitle: activeCourse.title,
        lecturer: currentUserName, lecturerUid: currentUser ? currentUser.uid : '—',
        assignedCourses: lecturerCourses,
        timestamp: new Date().toISOString()
      }).catch(()=>{});
      setS('Warning: '+activeCourse.code+' is not in your assigned courses. This has been logged.','warn');
    }
  }
  closeM('mc');
  addLog('info','Course: '+activeCourse.code+' — '+activeCourse.title);
  renderWeeklyGrid();
}

// ── ADMIN COURSE PICKER (independent of scan tab course) ──────────
let adminActiveCourse = null;
let _adminCourseCallback = null; // 'admin' or 'scan'

function openAdminCourseModal() {
  filtCourses = [...COURSES]; // Admin sees all courses
  document.getElementById('csearch').value = '';
  selCourseTemp = adminActiveCourse;
  _adminCourseCallback = 'admin';
  renderCourseList();
  // Swap confirm button action
  document.getElementById('mc-confirm-btn').onclick = confirmAdminCourse;
  openM('mc');
}

function openCourseModal(){
  // Lecturers only see their assigned courses; admin sees all
  filtCourses=[...getFilteredCourses()];
  document.getElementById('csearch').value='';
  selCourseTemp=activeCourse;
  _adminCourseCallback = 'scan';
  document.getElementById('mc-confirm-btn').onclick = confirmCourse;
  renderCourseList();openM('mc');
}

function confirmAdminCourse() {
  if (!selCourseTemp) { alert('Select a course first.'); return; }
  adminActiveCourse = selCourseTemp;
  const sem = adminActiveCourse.sem === 1 ? '1st Semester' : '2nd Semester';
  document.getElementById('admin-cb-course').textContent = adminActiveCourse.code + ' — ' + adminActiveCourse.title;
  document.getElementById('admin-cb-meta').textContent = adminActiveCourse.level + ' · ' + (adminActiveCourse.option||'General') + ' · ' + sem;
  closeM('mc');
  addLog('info', 'Admin course selected: ' + adminActiveCourse.code);
  renderAtRiskList();
  renderCourseSummary();
  renderAttendanceTrendChart(); // #17 update chart
}


// ── CAMERA ────────────────────────────────────────────────────────
let currentFacingMode = 'user'; // 'user' = front, 'environment' = rear
async function toggleCam(){
  if(stream){stopCam();return;}
  const btn=document.getElementById('bcam');
  btn.textContent='⏳ Starting...';btn.disabled=true;
  try{
    let s=null;
    for(const c of[
      {video:{facingMode:{ideal:'user'},width:{ideal:640},height:{ideal:480}}},
      {video:{facingMode:'environment',width:{ideal:640},height:{ideal:480}}},
      {video:true},{video:{}}
    ]){try{s=await navigator.mediaDevices.getUserMedia(c);break;}catch(e){continue;}}
    if(!s)throw new Error('No camera available');
    stream=s;
    const vid=document.getElementById('vid');vid.srcObject=s;vid.style.display='block';
    await vid.play().catch(()=>{});
    document.getElementById('cph').style.display='none';
    document.getElementById('cbadge').textContent='LIVE';document.getElementById('cbadge').classList.add('live');
    btn.textContent='■ Stop Camera';btn.disabled=false;btn.className='btn bo';
    document.getElementById('bscan').disabled=false;
    document.getElementById('bmulti').disabled=false;
    document.getElementById('blive').disabled=false;
    document.getElementById('bcap').disabled=false;
    setS('Camera active — select a course then scan.','ok');
    addLog('info','Camera: '+s.getVideoTracks()[0].label);
    startFPS();syncEnrollCam();
  }catch(e){
    btn.textContent='▶ Start Camera';btn.disabled=false;
    let m=e.message;
    if(e.name==='NotAllowedError')m='Camera denied. Tap [lock] → Camera → Allow.';
    else if(e.name==='NotFoundError')m='No camera found.';
    else if(e.name==='NotReadableError')m='Camera in use by another app.';
    setS(m,'err');addLog('err',e.name+': '+e.message);
  }
}
function stopCam(){
  if(liveOn)stopLive();
  if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}
  // If enroll stream was sharing the same stream, clear it too
  if(enrollStream){enrollStream.getTracks().forEach(t=>t.stop());enrollStream=null;}
  const vid=document.getElementById('vid'),evid=document.getElementById('evid');
  vid.style.display='none';vid.srcObject=null;evid.style.display='none';evid.srcObject=null;
  document.getElementById('cph').style.display='flex';document.getElementById('eph').style.display='flex';
  document.getElementById('cbadge').textContent='OFF';document.getElementById('cbadge').classList.remove('live');
  document.getElementById('bcam').textContent='▶ Start Camera';document.getElementById('bcam').className='btn bb';
  const benrollCam=document.getElementById('benroll-cam');
  if(benrollCam){benrollCam.textContent='▶ Start Camera';benrollCam.className='btn bb';}
  const benrollFlip=document.getElementById('benroll-flip');
  if(benrollFlip) benrollFlip.disabled=true;
  document.getElementById('bscan').disabled=true;document.getElementById('bmulti').disabled=true;document.getElementById('blive').disabled=true;document.getElementById('bcap').disabled=true;
  document.getElementById('cfaces').textContent='Faces: 0';
  clearOC();setS('Camera stopped.','warn');addLog('warn','Camera stopped');stopFPS();
}
async function flipCam(){
  if(!stream){addLog('warn','Start camera first before flipping.'); return;}
  currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
  const btn = document.getElementById('bflip');
  if(btn){btn.textContent='⏳';btn.disabled=true;}
  stream.getTracks().forEach(t=>t.stop()); stream=null;
  const vid=document.getElementById('vid');
  try{
    let s=null;
    const constraints=[
      {video:{facingMode:{exact:currentFacingMode},width:{ideal:640},height:{ideal:480}}},
      {video:{facingMode:currentFacingMode,width:{ideal:640},height:{ideal:480}}},
      {video:{facingMode:currentFacingMode}},
      {video:true}
    ];
    for(const c of constraints){try{s=await navigator.mediaDevices.getUserMedia(c);break;}catch(e){continue;}}
    if(!s)throw new Error('Camera not available');
    stream=s;
    vid.srcObject=s;vid.style.display='block';
    await vid.play().catch(()=>{});
    syncEnrollCam();
    addLog('info','Camera flipped to: '+(currentFacingMode==='user'?'Front':'Rear'));
    setS('Camera: '+(currentFacingMode==='user'?'Front (selfie)':'Rear')+' — ready to scan.','ok');
  }catch(e){
    currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user'; // revert
    addLog('err','Flip failed: '+e.message);
    setS('Flip failed: this device may only have one camera.','warn');
  }
  if(btn){btn.textContent='↺';btn.disabled=false;}
}

// ── ENROLL TAB CAMERA (HOD only — independent of scan tab) ────────
let enrollStream = null;
let enrollFacingMode = 'environment'; // HOD enroll defaults to rear camera

async function toggleEnrollCam(){
  const btn = document.getElementById('benroll-cam');
  const flipBtn = document.getElementById('benroll-flip');
  if(enrollStream){
    enrollStream.getTracks().forEach(t=>t.stop()); enrollStream=null;
    // Also clear shared stream if it was the same
    if(stream===enrollStream) stream=null;
    const evid=document.getElementById('evid');
    evid.style.display='none'; evid.srcObject=null;
    document.getElementById('eph').style.display='flex';
    if(btn){btn.textContent='▶ Start Camera';btn.className='btn bb';}
    if(flipBtn) flipBtn.disabled=true;
    document.getElementById('bcap').disabled=true;
    setER('Camera stopped.','');
    return;
  }
  if(btn){btn.textContent='⏳ Starting...';btn.disabled=true;}
  try{
    let s=null;
    const constraints=[
      {video:{facingMode:{ideal:enrollFacingMode},width:{ideal:640},height:{ideal:480}}},
      {video:{facingMode:enrollFacingMode}},{video:true},{video:{}}
    ];
    for(const c of constraints){try{s=await navigator.mediaDevices.getUserMedia(c);break;}catch(e){continue;}}
    if(!s) throw new Error('No camera available');
    enrollStream=s;
    // Share stream so scan tab can also use it
    stream=s;
    const evid=document.getElementById('evid');
    evid.srcObject=s; evid.style.display='block';
    await evid.play().catch(()=>{});
    document.getElementById('eph').style.display='none';
    if(btn){btn.textContent='■ Stop Camera';btn.disabled=false;btn.className='btn br';}
    if(flipBtn) flipBtn.disabled=false;
    document.getElementById('bcap').disabled=false;
    setER('Camera ready — capture '+ SAMPLES_NEEDED +' face samples.','ok');
    addLog('info','Enroll camera started ('+(enrollFacingMode==='environment'?'Rear':'Front')+')');
  }catch(e){
    if(btn){btn.textContent='▶ Start Camera';btn.disabled=false;}
    setER('Camera error: '+(e.name==='NotAllowedError'?'Permission denied — tap [lock] → Camera → Allow':e.message),'err');
    addLog('err','Enroll cam: '+e.message);
  }
}

async function flipEnrollCam(){
  if(!enrollStream){ return; }
  enrollFacingMode = enrollFacingMode === 'environment' ? 'user' : 'environment';
  const flipBtn = document.getElementById('benroll-flip');
  if(flipBtn){flipBtn.textContent='⏳';flipBtn.disabled=true;}
  enrollStream.getTracks().forEach(t=>t.stop()); enrollStream=null;
  const evid = document.getElementById('evid');
  try{
    let s=null;
    const constraints=[
      {video:{facingMode:{exact:enrollFacingMode},width:{ideal:640},height:{ideal:480}}},
      {video:{facingMode:enrollFacingMode}},{video:true}
    ];
    for(const c of constraints){try{s=await navigator.mediaDevices.getUserMedia(c);break;}catch(e){continue;}}
    if(!s) throw new Error('No camera available');
    enrollStream=s; stream=s;
    evid.srcObject=s; evid.style.display='block';
    await evid.play().catch(()=>{});
    addLog('info','Enroll camera flipped to: '+(enrollFacingMode==='environment'?'Rear':'Front'));
    setER('Camera: '+(enrollFacingMode==='environment'?'Rear':'Front (selfie)')+' active.','ok');
  }catch(e){
    enrollFacingMode = enrollFacingMode === 'environment' ? 'user' : 'environment'; // revert
    addLog('err','Enroll flip: '+e.message);
    setER('Flip failed — device may only have one camera.','warn');
  }
  if(flipBtn){flipBtn.textContent='↺';flipBtn.disabled=false;}
}
function syncEnrollCam(){
  const evid=document.getElementById('evid'),eph=document.getElementById('eph');
  const src=enrollStream||stream;
  if(src){evid.srcObject=src;evid.style.display='block';eph.style.display='none';evid.play().catch(()=>{});}
  else{evid.style.display='none';eph.style.display='flex';}
}
function startFPS(){fpsi=setInterval(()=>{document.getElementById('cfps').textContent=fps+'fps';fps=0;},1000);}
function stopFPS(){clearInterval(fpsi);document.getElementById('cfps').textContent='--';}
function sizeOC(){const w=document.querySelector('.cam-box');const c=document.getElementById('oc');c.width=w.clientWidth;c.height=w.clientHeight;}
function clearOC(){const c=document.getElementById('oc');c.getContext('2d').clearRect(0,0,c.width,c.height);}
function drawB(ctx,b,lbl,col){
  ctx.strokeStyle=col;ctx.lineWidth=2.5;ctx.strokeRect(b.x,b.y,b.width,b.height);
  ctx.fillStyle=col;const tw=ctx.measureText(lbl).width;
  ctx.fillRect(b.x,b.y-22,tw+14,20);
  ctx.fillStyle='#fff';ctx.font='bold 11px sans-serif';ctx.fillText(lbl,b.x+7,b.y-7);
}
function toggleLive(){if(liveOn)stopLive();else startLive();}
function startLive(){liveOn=true;document.getElementById('blive').textContent='◉ Stop';document.getElementById('blive').className='btn br';liveLoop();}
function stopLive(){liveOn=false;if(liveAF)cancelAnimationFrame(liveAF);document.getElementById('blive').textContent='◉ Live';document.getElementById('blive').className='btn bo';clearOC();}
async function liveLoop(){
  if(!liveOn||!stream)return;
  const vid=document.getElementById('vid');sizeOC();
  const dets=await faceapi.detectAllFaces(vid,new faceapi.TinyFaceDetectorOptions({inputSize:224,scoreThreshold:.5})).withFaceLandmarks(true);
  fps++;document.getElementById('cfaces').textContent='Faces: '+dets.length;
  const c=document.getElementById('oc'),ctx=c.getContext('2d');ctx.clearRect(0,0,c.width,c.height);
  const dims=faceapi.matchDimensions(c,{width:c.width,height:c.height},true);
  faceapi.resizeResults(dets,dims).forEach(d=>drawB(ctx,d.detection.box,'Face','rgba(0,87,255,.85)'));
  if(liveOn)liveAF=requestAnimationFrame(liveLoop);
}

// ── SHARED SCAN HELPERS ───────────────────────────────────────────
// State toggle: only ONE scan mode active at a time
let _scanMode = null; // null | 'single' | 'multi'
function getScanKey(){
  return activeCourse.code.replace(/\s/g,'_')+'_'+getAcademicSession().replace('/','_')+'_'+getSemester().replace(/\s/g,'_')+'_wk'+currentWeek;
}
// FIX 2: Validate matched student belongs to the active course level
function isStudentForActiveCourse(u){
  if(!activeCourse) return false;
  if(u.level !== activeCourse.level) return false;
  if(activeCourse.option && u.option && u.option !== activeCourse.option) return false;
  return true;
}
async function markStudentPresent(u, key){
  if(sessionMarked.has(u.matric)) return false;
  // FIX 9: Use device time for display but add serverTimestamp for authoritative record
  const now=new Date();
  sessionMarked.add(u.matric);
  if(!weeklyData[u.matric])weeklyData[u.matric]={};
  weeklyData[u.matric][key]={
    status:'P',
    time:now.toTimeString().slice(0,8),
    date:now.toLocaleDateString('en-GB'),
    week:currentWeek,
    session:getAcademicSession(),
    semester:getSemester(),
    markedAt: firebase.firestore.FieldValue.serverTimestamp() // authoritative server time
  };
  await saveWeekly(u.matric,weeklyData[u.matric]);
  addLog('ok','PRESENT '+u.name+' | '+u.matric+' | '+activeCourse.code+' Wk'+currentWeek);
  return true;
}

// ── SINGLE FACE SCAN ─────────────────────────────────────────────
async function doScan(){
  if(!stream){setS('Start camera first.','err');return;}
  if(!loaded){setS('Models loading...','warn');return;}
  if(!activeCourse){setS('Select a course first — tap the course banner.','warn');openCourseModal();return;}
  // ── STATE TOGGLE: block if multi-scan is active ──────────────────
  if(_scanMode==='multi'){setS('Multi-scan is active. Stop it before single scan.','warn');return;}
  _scanMode='single';
  // Hide mismatch banner from previous scan
  const mb=document.getElementById('mismatch-banner');if(mb)mb.style.display='none';
  const btn=document.getElementById('bscan');
  const mbtn=document.getElementById('bmulti');
  btn.disabled=true;
  btn.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Scanning...';
  if(mbtn) mbtn.disabled=true;
  setS('Scanning...','info');
  document.getElementById('confwrap').classList.remove('show');
  document.getElementById('multi-results').style.display='none';
  // Use rAF for high-speed responsiveness
  await new Promise(r=>requestAnimationFrame(r));
  const vid=document.getElementById('vid');sizeOC();
  const c=document.getElementById('oc'),ctx=c.getContext('2d');ctx.clearRect(0,0,c.width,c.height);
  try{
    const det=await faceapi.detectSingleFace(vid,new faceapi.TinyFaceDetectorOptions({inputSize:320,scoreThreshold:.5})).withFaceLandmarks(true).withFaceDescriptor();
    if(!det){setS('No face detected. Position face clearly in frame.','warn');addLog('warn','No face');_scanMode=null;resetScanBtn();return;}
    const dims=faceapi.matchDimensions(c,{width:c.width,height:c.height},true);
    const res=faceapi.resizeResults(det,dims);
    if(!matcher||!students.length){setS('No students enrolled. Go to Enroll tab.','err');drawB(ctx,res.detection.box,'No DB','#FF3B5C');_scanMode=null;resetScanBtn();return;}
    const m=matcher.findBestMatch(det.descriptor);
    const conf=Math.round((1-m.distance)*100);
    document.getElementById('confwrap').classList.add('show');
    document.getElementById('cpct').textContent=conf+'%';
    document.getElementById('cfill').style.width=conf+'%';
    if(m.label==='unknown'){
      fails++;drawB(ctx,res.detection.box,'Unknown '+conf+'%','#FF3B5C');
      setS('Face not recognised. Enrol this student first.','err');
      addLog('err','No match — conf:'+conf+'%');openM('me');
    }else{
      const u=students.find(x=>x.matric===m.label);
      if(!u){setS('DB error','err');_scanMode=null;resetScanBtn();return;}
      // Strict mismatch flag if distance too high
      if(m.distance>FLAG_THRESHOLD){
        fails++;
        _triggerMismatchAlert(u,m.distance);
        drawB(ctx,res.detection.box,'Uncertain','#FF9500');
        _scanMode=null;resetScanBtn();return;
      }
      if(!isStudentForActiveCourse(u)){
        fails++;
        drawB(ctx,res.detection.box,esc(u.name.split(' ')[0])+' Wrong Level','#FF9500');
        setS('Warning: '+esc(u.name)+' is '+u.level+' — not enrolled in this '+activeCourse.level+' course.','warn');
        addLog('warn','Level mismatch: '+u.name+' ('+u.level+') scanned for '+activeCourse.level+' course');
        _scanMode=null;resetScanBtn();return;
      }
      if(sessionMarked.has(u.matric)){
        setS(esc(u.name.split(' ')[0])+' already marked for Week '+currentWeek+'.','warn');
        drawB(ctx,res.detection.box,esc(u.name.split(' ')[0])+' \u2713 done','#FF9500');
        addLog('warn','Duplicate: '+u.name);_scanMode=null;resetScanBtn();return;
      }
      // Show ACCEPT / REJECT approval UI (consistent with multi-scan path)
      drawB(ctx,res.detection.box,esc(u.name.split(' ')[0]),'#1366F5');
      _pendingScan = { u, key: getScanKey(), conf, dist: m.distance };
      document.getElementById('approval-name').textContent = u.name;
      document.getElementById('approval-meta').textContent = u.matric + ' · ' + u.level + (u.option?' · '+u.option:'') + ' · ' + conf + '% match';
      document.getElementById('scan-approval').style.display = 'block';
      setS('Verify identity below — ACCEPT or REJECT.','info');
      _scanMode=null;
      btn.disabled=false;
      btn.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> Scan 1 Face';
      if(mbtn) mbtn.disabled=false;
      return;
    }
  }catch(e){setS('Error: '+e.message,'err');addLog('err',e.message);}
  _scanMode=null;
  resetScanBtn();
}

// ── MULTI-FACE ROW SCAN ──────────────────────────────────────────
let multiScanActive=false;

async function doMultiScan(){
  if(!stream){setS('Start camera first.','err');return;}
  if(!loaded){setS('Models loading...','warn');return;}
  if(!activeCourse){setS('Select a course first.','warn');openCourseModal();return;}
  if(!matcher||!students.length){setS('No students enrolled. Go to Enroll tab.','err');return;}
  // ── STATE TOGGLE: block if single-scan is active ─────────────────
  if(_scanMode==='single'){setS('Single scan is active. Wait for it to finish.','warn');return;}
  if(multiScanActive)return;
  _scanMode='multi';

  const btn=document.getElementById('bmulti');
  const sBtn=document.getElementById('bscan');
  btn.disabled=true;
  btn.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Detecting faces...';
  sBtn.disabled=true;
  document.getElementById('confwrap').classList.remove('show');
  setS('Multi-scan: detecting all faces in frame...','info');

  // Use rAF for high-speed responsiveness
  await new Promise(r=>requestAnimationFrame(r));
  const vid=document.getElementById('vid');sizeOC();
  const c=document.getElementById('oc'),ctx=c.getContext('2d');ctx.clearRect(0,0,c.width,c.height);
  const resultsBox=document.getElementById('multi-results');
  const resultsList=document.getElementById('multi-results-list');
  resultsBox.style.display='block';
  resultsList.innerHTML='<div style="color:rgba(255,255,255,.5);font-size:11px;text-align:center;padding:8px">Detecting faces...</div>';

  multiScanActive=true;
  try{
    const dets=await faceapi
      .detectAllFaces(vid,new faceapi.TinyFaceDetectorOptions({inputSize:416,scoreThreshold:.5}))
      .withFaceLandmarks(true)
      .withFaceDescriptors();

    if(!dets||!dets.length){
      setS('No faces detected. Make sure students face the camera clearly.','warn');
      resultsList.innerHTML='<div style="color:#fbbf24;font-size:11px;text-align:center;padding:8px">No faces detected in frame</div>';
      multiScanActive=false;_scanMode=null;resetMultiBtn();return;
    }

    const dims=faceapi.matchDimensions(c,{width:c.width,height:c.height},true);
    const resized=faceapi.resizeResults(dets,dims);
    const key=getScanKey();
    let presentCount=0,unknownCount=0,alreadyCount=0;
    const resultItems=[];

    for(let i=0;i<resized.length;i++){
      const box=resized[i].detection.box;
      const descriptor=dets[i].descriptor;
      const match=matcher.findBestMatch(descriptor);
      const conf=Math.round((1-match.distance)*100);

      if(match.label==='unknown'){
        unknownCount++;
        drawB(ctx,box,'Unknown '+conf+'%','#FF3B5C');
        resultItems.push({status:'unknown',label:'Unknown face',conf,col:'#FF8FA3',bg:'rgba(255,59,92,.18)'});
      } else {
        const u=students.find(x=>x.matric===match.label);
        if(!u) continue;
        // FIX 2: Skip students not belonging to this course level
        if(!isStudentForActiveCourse(u)){
          drawB(ctx,box,esc(u.name.split(' ')[0])+' Wrong Lvl','#FF9500');
          resultItems.push({status:'wrong',label:esc(u.name)+' — wrong level ('+u.level+')',conf,col:'#fcd34d',bg:'rgba(217,119,6,.18)'});
          continue;
        }
        if(sessionMarked.has(u.matric)){
          alreadyCount++;
          drawB(ctx,box,esc(u.name.split(' ')[0])+' \u2713done','#FF9500');
          resultItems.push({status:'already',label:esc(u.name),sub:'Already marked this week',conf,col:'#fcd34d',bg:'rgba(217,119,6,.18)'});
        } else {
          await markStudentPresent(u,key);
          presentCount++;
          drawB(ctx,box,esc(u.name.split(' ')[0])+' \u2713','#00C06A');
          resultItems.push({status:'present',label:esc(u.name),sub:esc(u.matric)+' \u00b7 '+esc(u.level),conf,col:'#6EE7B7',bg:'rgba(0,192,106,.18)'});
        }
      }
    }

    // Render results ticker
    resultsList.innerHTML=resultItems.map(r=>`
      <div style="display:flex;align-items:center;gap:8px;padding:5px 8px;background:${r.bg};border-radius:6px;margin-bottom:4px;">
        <div style="font-size:13px;">${r.status==='present'?'&#10003;':r.status==='already'?'&#8617;':'?'}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:12px;font-weight:700;color:${r.col};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${r.label}</div>
          ${r.sub?`<div style="font-size:10px;color:rgba(255,255,255,.4);">${r.sub}</div>`:''}
        </div>
        <div style="font-size:10px;font-weight:800;color:${r.col};flex-shrink:0;">${r.conf}%</div>
      </div>`).join('');

    const total=dets.length;
    const parts=[];
    if(presentCount) parts.push(`${presentCount} marked present`);
    if(alreadyCount) parts.push(`${alreadyCount} already done`);
    if(unknownCount) parts.push(`${unknownCount} unknown`);
    setS(`Multi-scan: ${total} face${total!==1?'s':''} detected. ${parts.join(' · ')}`,presentCount>0?'ok':'warn');
    addLog('ok',`Multi-scan: ${total} detected, ${presentCount} marked, ${alreadyCount} already, ${unknownCount} unknown — ${activeCourse.code} Wk${currentWeek}`);
    if(presentCount>0) renderWeeklyGrid();

  }catch(e){
    setS('Multi-scan error: '+e.message,'err');
    addLog('err','Multi-scan: '+e.message);
    resultsList.innerHTML='<div style="color:#FF8FA3;font-size:11px;padding:8px">Error: '+e.message+'</div>';
  }
  multiScanActive=false;
  _scanMode=null;
  resetMultiBtn();
}

function resetMultiBtn(){
  const b=document.getElementById('bmulti');if(b){b.disabled=false;b.textContent='Scan Row (Multi)';}
  const s=document.getElementById('bscan');if(s)s.disabled=false;
}
function resetScanBtn(){
  const b=document.getElementById('bscan');b.disabled=false;b.textContent='Scan 1 Face';
  const mb=document.getElementById('bmulti');if(mb)mb.disabled=false;
}

// ── FINALISE SESSION (Auto-Absent) ────────────────────────────────
async function finaliseSession(){
  if(!activeCourse){setS('Select a course first.','warn');return;}
  const courseStudents=getStudentsForCourse(activeCourse);
  if(!courseStudents.length){setS('No students for this level.','warn');return;}

  // FIX 7: Always reload fresh attendance data before counting who is absent
  setS('Loading latest attendance data...','info');
  await loadWeeklyData();

  const key=activeCourse.code.replace(/\s/g,'_')+'_'+getAcademicSession().replace('/','_')+'_'+getSemester().replace(/\s/g,'_')+'_wk'+currentWeek;
  const alreadyPresent=courseStudents.filter(u=>weeklyData[u.matric]&&weeklyData[u.matric][key]&&weeklyData[u.matric][key].status==='P').length;
  const willBeAbsent=courseStudents.length-alreadyPresent;

  // FIX 8: Show confirmation modal with exact counts before proceeding
  const confirmed=confirm(
    'FINALISE ATTENDANCE — Week '+currentWeek+'\n'+
    'Course: '+activeCourse.code+' — '+activeCourse.title+'\n\n'+
    'Already marked present: '+alreadyPresent+' students\n'+
    'Will be marked ABSENT: '+willBeAbsent+' students\n\n'+
    'This will mark '+willBeAbsent+' student(s) as absent. Continue?'
  );
  if(!confirmed){setS('Finalise cancelled.','warn');return;}

  const now=new Date();
  const ts=now.toTimeString().slice(0,8);
  const dateStr=now.toLocaleDateString('en-GB');
  let absentCount=0;
  for(const u of courseStudents){
    if(!weeklyData[u.matric])weeklyData[u.matric]={};
    if(!weeklyData[u.matric][key]){
      weeklyData[u.matric][key]={status:'A',time:ts,date:dateStr,week:currentWeek,session:getAcademicSession(),semester:getSemester()};
      await saveWeekly(u.matric,weeklyData[u.matric]);
      absentCount++;
    }
  }
  const presentCount=courseStudents.filter(u=>weeklyData[u.matric]&&weeklyData[u.matric][key]&&weeklyData[u.matric][key].status==='P').length;
  renderWeeklyGrid();
  document.getElementById('mfin-body').innerHTML=
    `<b>${esc(activeCourse.code)}</b><br>${esc(getAcademicSession())} · ${esc(getSemester())} · Week ${currentWeek}<br><br>`+
    `<b style="color:var(--green)">${presentCount} Present</b><br>`+
    `<b style="color:var(--red)">${absentCount} Absent</b><br>`+
    `Total: ${courseStudents.length} students`;
  openM('mfin');
  addLog('ok',`Finalised: ${presentCount}P ${absentCount}A — ${activeCourse.code} Wk${currentWeek}`);
}

function getStudentsForCourse(course){
  return students.filter(u=>{
    if(u.level!==course.level)return false;
    if(course.option&&u.option&&u.option!==course.option)return false;
    return true;
  });
}

// ── ENROLL ────────────────────────────────────────────────────────
// ── 4-CHALLENGE ENROLLMENT LIVENESS ────────────────────────────
// Challenge 0: Neutral Sample 1
// Challenge 1: Neutral Sample 2
// Challenge 2: Eye Blink (EAR landmarks 36-41, 42-47)
// Challenge 3: Head Turn Left→Right

let enrollChallenge = 0; // current challenge index
let enrollLivenessActive = false;
let enrollLivenessInterval = null;
let bestNeutralCanvas = null; // clearest neutral face for thumbnail

const ENROLL_CHALLENGES = [
  { label: 'Look straight at camera — Neutral Face 1', icon: 'neutral', phase: 'neutral' },
  { label: 'Hold still — Neutral Face 2', icon: 'neutral', phase: 'neutral' },
  { label: 'BLINK once slowly', icon: 'blink', phase: 'blink' },
  { label: 'Turn head LEFT then RIGHT', icon: '↔', phase: 'headturn' },
];

function speak(text) {
  try {
    if(!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.0; u.pitch = 1; u.volume = 0.9;
    window.speechSynthesis.speak(u);
  } catch(e){}
}

function updateEnrollLivenessBanner(challengeIdx) {
  const banner = document.getElementById('enroll-liveness-banner');
  const icon = document.getElementById('enroll-liveness-icon');
  const msg = document.getElementById('enroll-liveness-msg');
  const circ = document.getElementById('enroll-circ-prog');
  const lbl = document.getElementById('enroll-circ-lbl');
  if (!banner) return;
  const total = 4;
  const done = challengeIdx;
  const pct = done / total;
  const circumference = 213.6;
  if (circ) circ.style.strokeDashoffset = circumference * (1 - pct);
  if (circ) circ.style.stroke = done >= total ? '#00C06A' : '#7B61FF';
  if (lbl) lbl.textContent = done + '/' + total;
  if (challengeIdx >= total) {
    banner.style.background = 'rgba(0,192,106,.18)';
    banner.style.border = '1.5px solid rgba(110,231,183,.4)';
    if (icon) icon.textContent = '✓';
    if (msg) { msg.style.color = '#6EE7B7'; msg.textContent = 'All challenges passed! Fill details and tap Enroll.'; }
    return;
  }
  const ch = ENROLL_CHALLENGES[challengeIdx];
  banner.style.background = 'rgba(123,97,255,.18)';
  banner.style.border = '1.5px solid rgba(180,168,255,.35)';
  if (icon) icon.textContent = ch.icon;
  if (msg) { msg.style.color = '#C4B5FD'; msg.textContent = 'Challenge ' + (challengeIdx+1) + '/4: ' + ch.label; }
  speak(ch.label);
}

async function capSample() {
  if (!enrollStream) { setER('Start camera first.', 'err'); return; }
  if (!loaded) { setER('Models still loading...', 'warn'); return; }
  const btn = document.getElementById('bcap');
  // Show banner on first tap
  const banner = document.getElementById('enroll-liveness-banner');
  if (banner) banner.style.display = 'block';
  
  if (enrollChallenge >= SAMPLES_NEEDED) { setER('All challenges done. Fill details and tap Enroll.', 'ok'); return; }
  
  const ch = ENROLL_CHALLENGES[enrollChallenge];
  updateEnrollLivenessBanner(enrollChallenge);
  
  if (ch.phase === 'neutral') {
    await _captureNeutralSample();
  } else if (ch.phase === 'blink') {
    await _runBlinkChallenge();
  } else if (ch.phase === 'headturn') {
    await _runHeadTurnChallenge();
  }
}

async function _captureNeutralSample() {
  if (enrollLivenessActive) return;
  enrollLivenessActive = true;
  const btn = document.getElementById('bcap');
  if (btn) { btn.disabled = true; btn.textContent = 'Detecting face...'; }
  const vid = document.getElementById('evid');
  try {
    const det = await faceapi.detectSingleFace(vid, new faceapi.TinyFaceDetectorOptions({inputSize:320,scoreThreshold:.55}))
      .withFaceLandmarks(true).withFaceDescriptor();
    if (!det) {
      setER('No face detected. Centre your face and tap again.', 'warn');
      speak('No face detected. Please centre your face.');
      enrollLivenessActive = false;
      if (btn) { btn.disabled = false; btn.textContent = 'Begin Enrollment Challenge'; }
      return;
    }
    samples.push(det.descriptor);
    // Save clearest neutral thumb
    if (!bestNeutralCanvas || det.detection.score > 0.9) {
      const tc = document.createElement('canvas'); tc.width = 80; tc.height = 80;
      const b = det.detection.box;
      tc.getContext('2d').drawImage(vid, Math.max(0,b.x), Math.max(0,b.y), b.width, b.height, 0, 0, 80, 80);
      bestNeutralCanvas = tc.toDataURL('image/jpeg', 0.5); // COMPRESSED
    }
    _markSampleDone(enrollChallenge, vid, det);
    enrollChallenge++;
    updateEnrollLivenessBanner(enrollChallenge);
    _updateEnrollProgress();
    if (enrollChallenge < SAMPLES_NEEDED) speak('Good. Next: ' + ENROLL_CHALLENGES[enrollChallenge].label);
  } catch(e) { setER('Error: ' + e.message, 'err'); }
  enrollLivenessActive = false;
  if (btn) { btn.disabled = enrollChallenge >= SAMPLES_NEEDED; btn.textContent = enrollChallenge < SAMPLES_NEEDED ? 'Next Challenge →' : 'All Done'; }
}

function _runBlinkChallenge() {
  return new Promise(resolve => {
    if (enrollLivenessActive) { resolve(); return; }
    enrollLivenessActive = true;
    const btn = document.getElementById('bcap');
    if (btn) { btn.disabled = true; btn.style.opacity = '.5'; btn.textContent = 'Waiting for blink...'; }
    const vid = document.getElementById('evid');
    // Higher sensitivity: EAR threshold raised, trigger on 2 consecutive closed frames
    const EAR_T = 0.24; // raised from 0.20 for sharper detection
    let closedFrames = 0;
    const CLOSED_FRAMES_NEEDED = 2; // 2 consecutive closed frames = confirmed blink
    let blinkDetected = false;
    let timeout = setTimeout(() => {
      clearInterval(enrollLivenessInterval);
      enrollLivenessActive = false;
      const msg = document.getElementById('enroll-liveness-msg');
      if (msg) msg.textContent = 'Timeout — tap again to retry blink.';
      if (btn) { btn.disabled = false; btn.style.opacity = '1'; btn.textContent = 'Retry Blink'; }
      resolve();
    }, 8000);
    enrollLivenessInterval = setInterval(async () => {
      try {
        const det = await faceapi.detectSingleFace(vid, new faceapi.TinyFaceDetectorOptions({inputSize:160,scoreThreshold:.45})).withFaceLandmarks(true);
        if (!det) return;
        const lm = det.landmarks.positions;
        const ear = (calcEAR(lm.slice(36,42)) + calcEAR(lm.slice(42,48))) / 2;
        if (ear < EAR_T) {
          closedFrames++;
        } else {
          if (closedFrames >= CLOSED_FRAMES_NEEDED && !blinkDetected) {
            // Eyes closed for 2+ frames then reopened = confirmed blink
            blinkDetected = true;
            clearTimeout(timeout);
            clearInterval(enrollLivenessInterval);
            enrollLivenessActive = false;
            speak('Blink confirmed!');
            setTimeout(async () => {
              const det2 = await faceapi.detectSingleFace(vid, new faceapi.TinyFaceDetectorOptions({inputSize:320,scoreThreshold:.55})).withFaceLandmarks(true).withFaceDescriptor();
              if (det2) { samples.push(det2.descriptor); }
              _markSampleDone(enrollChallenge, vid, det2||det);
              enrollChallenge++;
              updateEnrollLivenessBanner(enrollChallenge);
              _updateEnrollProgress();
              if (btn) { btn.disabled = false; btn.style.opacity = '1'; btn.textContent = 'Next Challenge \u2192'; }
              if (enrollChallenge < SAMPLES_NEEDED) speak('Next: ' + ENROLL_CHALLENGES[enrollChallenge].label);
              resolve();
            }, 300);
          }
          closedFrames = 0;
        }
      } catch(e) {}
    }, 80);
  });
}

function _runHeadTurnChallenge() {
  return new Promise(resolve => {
    if (enrollLivenessActive) { resolve(); return; }
    enrollLivenessActive = true;
    const btn = document.getElementById('bcap');
    const msg = document.getElementById('enroll-liveness-msg');
    if (btn) { btn.disabled = true; btn.style.opacity = '.5'; btn.textContent = 'Turn head LEFT...'; }
    if (msg) msg.textContent = 'Turn head LEFT, then RIGHT';
    speak('Turn your head to the left.');
    const vid = document.getElementById('evid');
    let phase = 'left'; // 'left' → 'right' → 'done'
    let leftDetected = false;
    const NOSE_X_THRESHOLD = 14; // px shift for left/right
    let baseline = null;
    let timeout = setTimeout(() => {
      clearInterval(enrollLivenessInterval);
      enrollLivenessActive = false;
      if (msg) msg.textContent = '⏱ Timeout — tap to retry head turn.';
      if (btn) { btn.disabled = false; btn.style.opacity = '1'; btn.textContent = 'Retry Head Turn'; }
      resolve();
    }, 16000);
    enrollLivenessInterval = setInterval(async () => {
      try {
        const det = await faceapi.detectSingleFace(vid, new faceapi.TinyFaceDetectorOptions({inputSize:160,scoreThreshold:.40})).withFaceLandmarks(true);
        if (!det) return;
        const lm = det.landmarks.positions;
        const noseX = lm[33] ? lm[33].x : null;
        if (noseX === null) return;
        if (baseline === null) { baseline = noseX; return; }
        const delta = noseX - baseline;
        if (phase === 'left' && delta < -NOSE_X_THRESHOLD) {
          phase = 'right';
          leftDetected = true;
          if (msg) msg.textContent = 'Good! Now turn RIGHT →';
          speak('Good. Now turn to the right.');
          if (btn) btn.textContent = 'Turn head RIGHT...';
        } else if (phase === 'right' && leftDetected && delta > NOSE_X_THRESHOLD) {
          clearTimeout(timeout);
          clearInterval(enrollLivenessInterval);
          enrollLivenessActive = false;
          speak('Head turn complete!');
          setTimeout(async () => {
            const det2 = await faceapi.detectSingleFace(vid, new faceapi.TinyFaceDetectorOptions({inputSize:320,scoreThreshold:.55})).withFaceLandmarks(true).withFaceDescriptor();
            if (det2) { samples.push(det2.descriptor); }
            _markSampleDone(enrollChallenge, vid, det2||det);
            enrollChallenge++;
            updateEnrollLivenessBanner(enrollChallenge);
            _updateEnrollProgress(); // _updateEnrollProgress gates the Submit button
            if (btn) { btn.disabled = enrollChallenge >= SAMPLES_NEEDED; btn.style.opacity = '1'; btn.textContent = enrollChallenge >= SAMPLES_NEEDED ? 'All Done' : 'Next Challenge \u2192'; }
            if (enrollChallenge >= SAMPLES_NEEDED) {
              speak('Enrollment complete! Please fill in your details and tap Enroll.');
            }
            resolve();
          }, 300);
        }
      } catch(e) {}
    }, 80);
  });
}

function _markSampleDone(idx, vid, det) {
  const dot = document.getElementById('sd' + idx);
  if (!dot) return;
  // Draw thumbnail
  const tmp = document.createElement('canvas'); tmp.width = 72; tmp.height = 72;
  if (det && det.detection) {
    const b = det.detection.box;
    tmp.getContext('2d').drawImage(vid, Math.max(0,b.x), Math.max(0,b.y), b.width, b.height, 0, 0, 72, 72);
  } else {
    tmp.getContext('2d').drawImage(vid, 0, 0, 72, 72);
  }
  dot.innerHTML = ''; dot.appendChild(tmp);
  const tk = document.createElement('div');
  tk.style.cssText = 'position:absolute;bottom:2px;right:3px;font-size:9px;color:#00D68F;font-weight:900;background:rgba(255,255,255,.9);border-radius:3px;padding:0 3px;';
  tk.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>'; dot.appendChild(tk);
  dot.style.border = '2px solid #00D68F';
  dot.style.boxShadow = '0 0 0 3px rgba(0,192,106,.2)';
}

function _updateEnrollProgress() {
  const done = samples.length;
  document.getElementById('slbl').textContent = done + ' / ' + SAMPLES_NEEDED;
  document.getElementById('sprog').style.width = (done / SAMPLES_NEEDED * 100) + '%';
  // Show retake button after first sample
  const bretake = document.getElementById('bretake');
  if (bretake) bretake.style.display = done > 0 ? 'block' : 'none';
  // STRICT GATE: Submit only active when ALL 4 liveness checks pass
  const breg = document.getElementById('breg');
  if (done >= SAMPLES_NEEDED && enrollChallenge >= SAMPLES_NEEDED) {
    if(breg){ breg.disabled = false; breg.style.opacity='1'; }
    setER('All 4 challenges passed! Fill details and tap Enroll.', 'ok');
    const bcap=document.getElementById('bcap');
    if(bcap){bcap.disabled=true;bcap.style.opacity='.4';}
  } else {
    if(breg){ breg.disabled = true; breg.style.opacity='.35'; }
  }
}


async function doEnroll(){
  const matric=document.getElementById('rmatric').value.trim();
  const name=document.getElementById('rname').value.trim();
  const level=document.getElementById('rlevel').value;
  const isHND=level==='HND 1'||level==='HND 2';
  const option=isHND?document.getElementById('roption').value:'';
  if(!matric){setER('Enter matric number.','err');return;}
  if(!name){setER('Enter full name.','err');return;}
  if(!level){setER('Select level.','err');return;}
  if(isHND&&!option){setER('HND students must select a specialisation option.','err');return;}
  if(samples.length<SAMPLES_NEEDED){setER('Capture '+SAMPLES_NEEDED+' face samples first.','err');return;}
  if(students.find(u=>u.matric.toLowerCase()===matric.toLowerCase())){setER('"'+matric+'" already enrolled.','err');return;}

  // ── LIVE DUPLICATE FACE CHECK ────────────────────────────────────
  const btn=document.getElementById('breg');
  btn.disabled=true;
  btn.textContent='Checking for duplicate face...';
  setER('Scanning database for duplicate face — please wait...','info');
  const isFaceUpdate = (faceUpdateMatric !== null && faceUpdateMatric === matric);
  const dupeResult = await checkFaceDuplicateLive(samples, isFaceUpdate ? matric : null);
  if(dupeResult && dupeResult.fetchFailed){
    btn.disabled=false;
    btn.textContent='Enroll Student & Save to Cloud';
    setER('⚠ Cannot verify — database unreachable. Check Firestore rules: students collection needs read: if true.','err');
    return;
  }
  if(dupeResult){
    btn.disabled=false;
    btn.textContent='Enroll Student & Save to Cloud';
    setER('⛔ Duplicate face detected — enrollment blocked.','err');
    showDupeModal(dupeResult, matric);
    return;
  }
  // ── END DUPLICATE CHECK ──────────────────────────────────────────

  btn.textContent='Saving to Firebase...';
  try{
    // Use the best neutral face thumbnail captured during liveness challenges
    let photoDataUrl = bestNeutralCanvas || '';
    if(!photoDataUrl){
      try{
        const thumbCanvas=document.createElement('canvas');thumbCanvas.width=80;thumbCanvas.height=80;
        const vid2=document.getElementById('evid');
        if(vid2&&vid2.videoWidth>0){thumbCanvas.getContext('2d').drawImage(vid2,0,0,80,80);photoDataUrl=thumbCanvas.toDataURL('image/jpeg',0.5);}
      }catch(e){}
    }
    const programme=isHND?option+' Option':'Electrical & Electronics Engineering Technology';
    const newStudent={matric,name,level,option:isHND?option:'',programme,descriptors:samples.slice(),_rawDescriptors:[]};
    const cleanDescriptors=newStudent.descriptors.map(d=>Array.from(d).map(v=>Number(v).toFixed(4)).join(','));
    await dbFB.collection('students').doc(matric).set({
      matric,name,level,option:isHND?option:'',programme,
      descriptors:cleanDescriptors,
      photo:photoDataUrl,
      enrolledBy:currentUserName,enrolledAt:new Date().toISOString()
    });
    students.push(newStudent);
    _descriptorsLoaded = true; // FIX 16: ensure matcher is built with real descriptors
    weeklyData[matric]={};
    buildMatcher();renderList();
    renderAdminStudents();
    document.getElementById('ecnt').textContent=students.length;
    addLog('ok','ENROLLED: '+name+' | '+matric+' | '+level+(isHND?' | '+option:''));
    document.getElementById('mregn').textContent=matric+' — '+name;
    speak('Student enrolled successfully: ' + name.split(' ')[0]);openM('men');resetEnrollForm();
  }catch(e){
    setER('Failed: '+e.message,'err');
    btn.disabled=false;
    btn.textContent='Enroll Student & Save to Cloud';
  }
}


function retakeEnrollSamples(){
  samples=[];
  enrollChallenge=0;
  enrollLivenessActive=false;
  clearInterval(enrollLivenessInterval);
  bestNeutralCanvas=null;
  const banner=document.getElementById('enroll-liveness-banner');
  if(banner){banner.style.display='none';}
  const circ=document.getElementById('enroll-circ-prog');
  if(circ){circ.style.strokeDashoffset='213.6';circ.style.stroke='#7B61FF';}
  const lbl=document.getElementById('enroll-circ-lbl');
  if(lbl) lbl.textContent='0/4';
  for(let i=0;i<SAMPLES_NEEDED;i++){
    const s=document.getElementById('sd'+i);
    if(s){s.innerHTML=[1,2,'<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>','&larr;'][i]||String(i+1);s.style.border='';s.style.boxShadow='';s.classList.remove('done');}
  }
  document.getElementById('slbl').textContent='0 / '+SAMPLES_NEEDED;
  document.getElementById('sprog').style.width='0%';
  document.getElementById('breg').disabled=true;
  document.getElementById('bretake').style.display='none';
  const bcap=document.getElementById('bcap');
  if(bcap){bcap.disabled=false;bcap.textContent='Start 4-Step Liveness Challenge';}
  setER('Samples cleared — start camera and tap to begin.','info');
}

function resetEnrollForm(){
  enrollChallenge = 0;
  enrollLivenessActive = false;
  clearInterval(enrollLivenessInterval);
  bestNeutralCanvas = null;
  const banner = document.getElementById('enroll-liveness-banner');
  if (banner) banner.style.display = 'none';

  ['rmatric','rname'].forEach(id=>document.getElementById(id).value='');
  ['rlevel','roption'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('opt-row').style.display='none';
  document.getElementById('nd-note').style.display='none';
  document.getElementById('matric-parsed').style.display='none';
  document.getElementById('level-auto-note').textContent='';
  samples=[];
  document.getElementById('slbl').textContent='0 / '+SAMPLES_NEEDED;
  document.getElementById('sprog').style.width='0%';
  document.getElementById('breg').disabled=true;
  document.getElementById('breg').style.opacity='.35';
  document.getElementById('breg').textContent='Enroll Student & Save to Cloud';
  for(let i=0;i<SAMPLES_NEEDED;i++){const s=document.getElementById('sd'+i);if(s){s.innerHTML=[1,2,'<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>','&larr;'][i]||String(i+1);s.style.border='';s.style.boxShadow='';s.classList.remove('done');}}
  setER('Capture '+SAMPLES_NEEDED+' samples to enroll another student.','');
}

// ── WEEKLY GRID ───────────────────────────────────────────────────
async function renderWeeklyGrid(){
  if(!activeCourse){document.getElementById('weekly-grid-body').innerHTML='<div style="text-align:center;color:var(--txt3);padding:20px;font-size:12px">Select a course first</div>';return;}
  await loadWeeklyData();
  const courseStudents=getStudentsForCourse(activeCourse);
  // Build week header
  let wkHdr='';
  for(let w=1;w<=MAX_WEEKS;w++) wkHdr+=`<div style="font-size:9px;font-weight:800;color:var(--txt3);width:22px;text-align:center;flex-shrink:0;">W${w}</div>`;
  document.getElementById('wk-hdr-weeks').innerHTML=wkHdr;
  if(!courseStudents.length){
    document.getElementById('weekly-grid-body').innerHTML='<div style="text-align:center;color:var(--txt3);padding:20px;font-size:12px">No students enrolled for '+activeCourse.level+'</div>';
    updateWarningBanner([]);return;
  }
  const warnings=[];
  const baseKey=activeCourse.code.replace(/\s/g,'_')+'_'+getAcademicSession().replace('/','_')+'_'+getSemester().replace(/\s/g,'_')+'_wk';
  document.getElementById('weekly-grid-body').innerHTML=courseStudents.map(u=>{
    let cells='';let present=0;
    for(let w=1;w<=MAX_WEEKS;w++){
      const key=baseKey+w;
      const entry=weeklyData[u.matric]&&weeklyData[u.matric][key];
      const val=entry?entry.status:'';
      const isP=val==='P';const isA=val==='A';const isE=val==='E';const future=w>currentWeek&&!val;
      if(isP||isE)present++; // Excused counts as present for attendance %
      const bg=isP?'var(--green)':isE?'var(--purple)':isA?'var(--red-l)':future?'#f8faff':'var(--border)';
      const col=isP?'#fff':isE?'#fff':isA?'var(--red)':future?'var(--border2)':'var(--txt3)';
      const lbl=isP?'P':isE?'E':isA?'A':future?'':'-';
      cells+=`<div style="width:22px;height:22px;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;flex-shrink:0;background:${bg};color:${col};border:1px solid var(--border);" title="${entry&&entry.date?entry.date+' '+entry.time:''}">${lbl}</div>`;
    }
    const pct=currentWeek>0?Math.round(present/currentWeek*100):0;
    const isWarn=pct<ATT_THRESHOLD&&currentWeek>=3;
    if(isWarn)warnings.push({name:u.name,matric:u.matric,pct});
    const pctCol=isWarn?'var(--red)':pct>=75?'var(--green)':'var(--amber)';
    const safeName=u.name.replace(/'/g,"&#39;");
    const nameClick=currentUserRole==='admin'?` onclick="openCorrection('${u.matric}','${safeName}')" style="cursor:pointer"`:'';
    const pencil=currentUserRole==='admin'?'<span style="font-size:8px;color:var(--blue);margin-left:3px;">✏</span>':'';
    const pctCell=currentUserRole==='admin'
      ?`<div style="font-size:10px;font-weight:900;color:${pctCol};width:48px;text-align:center;flex-shrink:0;">${pct}%${isWarn?' ⚠':''}</div>`
      :`<div style="width:48px;flex-shrink:0;"></div>`;
    return `<div style="display:flex;gap:4px;align-items:center;padding:5px 0;border-bottom:1px solid var(--border);">
      <div style="font-size:11px;font-weight:600;width:100px;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"${nameClick}>${u.name}${pencil}</div>
      <div style="font-size:9px;color:var(--txt3);font-family:'JetBrains Mono';width:95px;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;">${u.matric}</div>
      <div style="display:flex;gap:3px;flex:1;">${cells}</div>
      ${pctCell}
    </div>`;
  }).join('');
  updateWarningBanner(warnings);
}



// ── BULK EXPORT — All courses, all students (HOD only) ────────────
async function exportFullSemesterCSV(){ await printFullSemesterReport(); } // legacy alias

async function printFullSemesterReport(){
  if(currentUserRole!=='admin'){alert('Only the HOD can print the full semester report.');return;}
  await loadStudents(); await loadWeeklyData();
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  const levels = ['ND 1','ND 2','HND 1','HND 2'];
  const semNum = getSemester().includes('1st') ? 1 : 2;
  let sectionsHtml = '';

  for(const lvl of levels){
    const lvlStudents = students.filter(u => u.level === lvl);
    if(!lvlStudents.length) continue;
    const lvlCourses = COURSES.filter(c => c.level === lvl && c.sem === semNum);
    if(!lvlCourses.length) continue;

    // Week header cells
    const wkHeaders = Array.from({length:currentWeek},(_,i)=>`<th style="text-align:center;min-width:22px;padding:4px 3px;font-size:9px;">W${i+1}</th>`).join('');
    const courseHeaders = lvlCourses.map(c=>`<th style="text-align:center;padding:4px 3px;font-size:9px;white-space:nowrap;">${esc(c.code)}</th>`).join('');

    let rows = '';
    // Group HND by option
    const groups = lvl.startsWith('HND')
      ? [['Power and Machines', lvlStudents.filter(u=>u.option==='Power and Machines')],
         ['Electronics and Telecommunication', lvlStudents.filter(u=>u.option==='Electronics and Telecommunication')]]
      : [['General', lvlStudents]];

    groups.forEach(([optLabel, grp]) => {
      if(!grp.length) return;
      rows += `<tr class="section-hdr"><td colspan="${4+lvlCourses.length}">${lvl}${lvl.startsWith('HND')?' — '+optLabel:''} &nbsp; (${grp.length} student${grp.length!==1?'s':''})</td></tr>`;
      grp.forEach((u,i) => {
        const pctCols = lvlCourses.map(c => {
          const baseKey = c.code.replace(/\s/g,'_')+'_'+getAcademicSession().replace('/','_')+'_'+getSemester().replace(/\s/g,'_')+'_wk';
          let present=0;
          for(let w=1;w<=currentWeek;w++){const k=baseKey+w;const e=weeklyData[u.matric]&&weeklyData[u.matric][k];if(e&&(e.status==='P'||e.status==='E'))present++;}
          const pct = currentWeek>0 ? Math.round(present/currentWeek*100) : 0;
          const cls = pct < 75 ? 'low' : 'ok';
          return `<td style="text-align:center;font-size:10px;" class="${cls}">${pct}%</td>`;
        }).join('');
        rows += `<tr>
          <td style="text-align:center;font-size:10px;">${i+1}</td>
          <td style="font-size:10px;font-family:monospace;">${esc(u.matric)}</td>
          <td style="font-size:10px;">${esc(u.name)}</td>
          <td style="font-size:10px;">${esc(u.option||'General')}</td>
          ${pctCols}
        </tr>`;
      });
    });

    sectionsHtml += `
      <h3 style="margin-top:18px;">${lvl} — Attendance Summary (Week 1 to ${currentWeek})</h3>
      <table>
        <thead>
          <tr>
            <th style="width:30px;text-align:center;">#</th>
            <th>Matric No.</th>
            <th>Full Name</th>
            <th>Option</th>
            ${courseHeaders}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  const html = `<html><head><title>Full Semester Attendance Report</title>${getReportStyles()}
  <style>
    table { font-size:10px; }
    th,td { padding:4px 6px; }
    .low { color:#000; font-weight:bold; text-decoration:underline; }
    .ok  { color:#000; }
    h3   { font-size:12px; font-weight:bold; margin:14px 0 4px 0; border-bottom:1px solid #000; padding-bottom:3px; page-break-before: auto; }
    @media print { table { page-break-inside: auto; } tr { page-break-inside: avoid; } }
  </style>
  </head><body>
  ${getReportHeader('FULL SEMESTER ATTENDANCE REPORT')}
  <div class="info-row">
    <div class="info-cell">Session: <span>${getAcademicSession()} · ${getSemester()}</span></div>
    <div class="info-cell">Weeks Held: <span>${currentWeek} of ${MAX_WEEKS}</span></div>
    <div class="info-cell">Printed: <span>${dateStr}</span></div>
    <div class="info-cell">Printed By: <span>${esc(currentUserName)}</span></div>
  </div>
  <div style="font-size:10px;border:1px solid #ccc;padding:5px 8px;border-radius:4px;background:#f9f9f9;margin-bottom:8px;">
    <b>Note:</b> Percentages shown are attendance rate per course up to Week ${currentWeek}. 
    Figures <b style="text-decoration:underline;">underlined</b> are below 75% — action required.
  </div>
  ${sectionsHtml}
  <div class="footer">The Gateway Polytechnic, Saapade &nbsp;·&nbsp; EEE Attendance System &nbsp;·&nbsp; Printed: ${now.toLocaleString('en-GB')}</div>
  </body></html>`;

  const w = window.open('','_blank');
  if(w){ w.document.write(html); w.document.close(); setTimeout(()=>w.print(),500); }
  addLog('info','Full semester report printed by '+currentUserName);
}

async function printWeeklyRegister(){
  if(!activeCourse){alert('Select a course first, then print.');return;}
  await loadWeeklyData();
  const courseStudents = getStudentsForCourse(activeCourse);
  if(!courseStudents.length){alert('No students enrolled for this course level.');return;}
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  const baseKey = activeCourse.code.replace(/\s/g,'_')+'_'+getAcademicSession().replace('/','_')+'_'+getSemester().replace(/\s/g,'_')+'_wk';
  const weeks = Array.from({length:currentWeek},(_,i)=>i+1);

  const wkHeaders = weeks.map(w=>`<th style="text-align:center;min-width:24px;padding:5px 3px;">${w}</th>`).join('');

  const rows = courseStudents.map((u,i)=>{
    let present=0;
    const cells = weeks.map(w=>{
      const k = baseKey+w;
      const e = weeklyData[u.matric] && weeklyData[u.matric][k];
      if(!e) return `<td style="text-align:center;color:#aaa;">—</td>`;
      const isP = e.status==='P';
      const isE = e.status==='E';
      present += (isP||isE)?1:0;
      return `<td style="text-align:center;font-weight:bold;">${isP?'P':isE?'E':'A'}</td>`;
    }).join('');
    const pct = currentWeek>0 ? Math.round(present/currentWeek*100) : 0;
    const pctStyle = pct<75 ? 'font-weight:bold;text-decoration:underline;' : 'font-weight:bold;';
    return `<tr>
      <td style="text-align:center;">${i+1}</td>
      <td style="font-family:monospace;font-size:10px;">${esc(u.matric)}</td>
      <td>${esc(u.name)}</td>
      ${cells}
      <td style="text-align:center;${pctStyle}">${pct}%</td>
    </tr>`;
  }).join('');

  const presentTotal = courseStudents.filter(u=>{
    const k = baseKey+currentWeek;
    return weeklyData[u.matric]&&weeklyData[u.matric][k]&&weeklyData[u.matric][k].status==='P';
  }).length;

  const html = `<html><head><title>Attendance Register — ${activeCourse.code}</title>${getReportStyles()}
  <style>
    th,td{padding:5px 6px;font-size:11px;}
    .low{font-weight:bold;text-decoration:underline;}
    @media print{table{page-break-inside:auto;}tr{page-break-inside:avoid;}}
  </style>
  </head><body>
  ${getReportHeader('ATTENDANCE REGISTER')}
  <div class="info-row">
    <div class="info-cell">Course Code: <span>${esc(activeCourse.code)}</span></div>
    <div class="info-cell">Course Title: <span>${esc(activeCourse.title)}</span></div>
    <div class="info-cell">Level: <span>${esc(activeCourse.level)}${activeCourse.option?' · '+esc(activeCourse.option):''}</span></div>
  </div>
  <div class="info-row">
    <div class="info-cell">Session: <span>${esc(getAcademicSession())} · ${esc(getSemester())}</span></div>
    <div class="info-cell">Weeks Held: <span>${currentWeek} of ${MAX_WEEKS}</span></div>
    <div class="info-cell">Total Students: <span>${courseStudents.length}</span></div>
    <div class="info-cell">Printed: <span>${dateStr}</span></div>
  </div>
  <table>
    <thead>
      <tr>
        <th style="width:30px;text-align:center;">#</th>
        <th>Matric No.</th>
        <th>Full Name</th>
        ${wkHeaders}
        <th style="text-align:center;">Att%</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div style="margin-top:10px;font-size:10px;border:1px solid #ccc;padding:5px 8px;background:#f9f9f9;border-radius:4px;">
    <b>P</b> = Present &nbsp;&nbsp; <b>A</b> = Absent &nbsp;&nbsp; <b>—</b> = Not recorded &nbsp;&nbsp;
    <b style="text-decoration:underline;">Underlined %</b> = Below 75% attendance
  </div>
  <div class="footer">The Gateway Polytechnic, Saapade &nbsp;·&nbsp; EEE Attendance System &nbsp;·&nbsp; Printed: ${now.toLocaleString('en-GB')}</div>
  </body></html>`;

  const w = window.open('','_blank');
  if(w){ w.document.write(html); w.document.close(); setTimeout(()=>w.print(),400); }
  addLog('info','Weekly register printed: '+activeCourse.code+' — '+courseStudents.length+' students');
}
// ── ATTENDANCE CORRECTION (Admin/HOD only) ────────────────────────
function openCorrection(matric,name){
  if(currentUserRole!=='admin'){alert('Only the HOD can correct attendance.');return;}
  if(!activeCourse){alert('Select a course first.');return;}
  document.getElementById('corr-name').textContent=name+' ('+matric+')';
  document.getElementById('corr-matric').value=matric;
  document.getElementById('corr-week').value=currentWeek;
  document.getElementById('corr-status').value='P';
  openM('mcorr');
}
async function saveCorrection(){
  const matric=document.getElementById('corr-matric').value;
  const week=parseInt(document.getElementById('corr-week').value);
  const status=document.getElementById('corr-status').value;
  if(!matric||!week||!status){alert('Fill all fields.');return;}

  // Block correcting a week that hasn't happened yet
  if(week > currentWeek){
    alert('⚠ Cannot correct Week '+week+' — current week is only Week '+currentWeek+'. You cannot correct future weeks.');
    return;
  }
  if(week < 1 || week > MAX_WEEKS){
    alert('Week must be between 1 and '+MAX_WEEKS+'.');
    return;
  }

  const key=activeCourse.code.replace(/\s/g,'_')+'_'+getAcademicSession().replace('/','_')+'_'+getSemester().replace(/\s/g,'_')+'_wk'+week;
  const now=new Date();

  // Get the old status before overwriting
  const oldEntry = weeklyData[matric] && weeklyData[matric][key];
  const oldStatus = oldEntry ? oldEntry.status : '—';

  const entry={status,time:now.toTimeString().slice(0,8),date:now.toLocaleDateString('en-GB'),week,session:getAcademicSession(),semester:getSemester(),correctedBy:currentUserName,correctedAt:now.toISOString()};
  if(!weeklyData[matric])weeklyData[matric]={};
  weeklyData[matric][key]=entry;
  try{
    await saveWeekly(matric,weeklyData[matric]);

    // ── PERSISTENT AUDIT TRAIL ───────────────────────────────────────
    const u = students.find(s => s.matric === matric);
    await dbFB.collection('audit_log').add({
      type: 'attendance_correction',
      matric,
      studentName: u ? u.name : matric,
      course: activeCourse.code,
      courseTitle: activeCourse.title,
      week,
      oldStatus,
      newStatus: status,
      correctedBy: currentUserName,
      correctedByUid: currentUser ? currentUser.uid : 'unknown',
      session: getAcademicSession(),
      semester: getSemester(),
      timestamp: now.toISOString()
    });
    // ─────────────────────────────────────────────────────────────────

    addLog('warn','CORRECTION SAVED: '+matric+' ('+( u ? u.name : '?')+') Wk'+week+' '+oldStatus+'→'+status+' by '+currentUserName);
    closeM('mcorr');renderWeeklyGrid();
    setS('Attendance corrected for Week '+week+' — audit record saved','ok');
  }catch(e){alert('Save failed: '+e.message);}
}
function updateWarningBanner(warnings){
  const b=document.getElementById('warn-banner');
  const l=document.getElementById('warn-list');
  // Only HOD sees the warning banner — lecturers are not shown who is at risk
  if(currentUserRole!=='admin'||!warnings.length){b.classList.remove('show');document.getElementById('a-warn').textContent=warnings.length||'0';return;}
  b.classList.add('show');
  l.innerHTML=warnings.map(w=>`<div class="wb-item"><span>${esc(w.name)} — <span class="mono">${esc(w.matric)}</span></span><span class="wb-pct">${w.pct}%</span></div>`).join('');
  document.getElementById('a-warn').textContent=warnings.length;
}

// ── EXPORT CSV ────────────────────────────────────────────────────
async function exportWeeklyCSV(){
  if(!activeCourse){alert('Select a course first.');return;}
  await loadWeeklyData();
  const courseStudents=getStudentsForCourse(activeCourse);
  const baseKey=activeCourse.code.replace(/\s/g,'_')+'_'+getAcademicSession().replace('/','_')+'_'+getSemester().replace(/\s/g,'_')+'_wk';
  const now=new Date();
  let csv='THE GATEWAY POLYTECHNIC SAAPADE\n';
  csv+='DEPARTMENT OF ELECTRICAL & ELECTRONIC ENGINEERING TECHNOLOGY\n';
  csv+='ATTENDANCE REGISTER\n\n';
  csv+=`Course Code:,${activeCourse.code}\n`;
  csv+=`Course Title:,${activeCourse.title}\n`;
  csv+=`Credit Units:,${activeCourse.units}\n`;
  csv+=`Level:,${activeCourse.level}${activeCourse.option?' - '+activeCourse.option+' Option':' - General'}\n`;
  csv+=`Academic Session:,${getAcademicSession()}\n`;
  csv+=`Semester:,${getSemester()}\n`;
  csv+=`Total Weeks Held:,${currentWeek}\n`;
  csv+=`Lecturer:,${currentUserName}\n`;
  csv+=`Export Date:,${now.toLocaleDateString('en-GB')} ${now.toTimeString().slice(0,5)}\n\n`;
  // Column headers
  let hdr='S/N,Matric Number,Student Name,Level,Specialisation';
  for(let w=1;w<=MAX_WEEKS;w++) hdr+=',Week '+w;
  hdr+=',Total Present,Total Absent,Attendance %,Status\n';
  csv+=hdr;
  // Rows
  csv+=courseStudents.map((u,i)=>{
    let row=`${i+1},"${u.matric}","${u.name}","${u.level}","${u.option||'General'}"`;
    let present=0,absent=0;
    for(let w=1;w<=MAX_WEEKS;w++){
      const key=baseKey+w;
      const entry=weeklyData[u.matric]&&weeklyData[u.matric][key];
      const val=entry?entry.status:'';
      if(val==='P'){row+=',P';present++;}
      else if(val==='A'){row+=',A';absent++;}
      else row+=',-';
    }
    const pct=currentWeek>0?Math.round(present/currentWeek*100):0;
    const status=pct<ATT_THRESHOLD?'BELOW 75% — ACTION REQUIRED':'OK';
    row+=`,${present},${absent},${pct}%,"${status}"`;
    return row;
  }).join('\n');
  // Summary
  csv+=`\n\nSUMMARY\nTotal Students:,${courseStudents.length}`;
  csv+=`\nStudents Below 75%:,${courseStudents.filter(u=>{
    let p=0;for(let w=1;w<=currentWeek;w++){const k=baseKey+w;const e=weeklyData[u.matric]&&weeklyData[u.matric][k];if(e&&e.status==='P')p++;}
    return currentWeek>0&&Math.round(p/currentWeek*100)<ATT_THRESHOLD;
  }).length}`;
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));
  a.download=`GAPOSA_EEE_${activeCourse.code.replace(/\s/g,'_')}_${getAcademicSession().replace('/','_')}_${getSemester().replace(/\s/g,'_')}.csv`;
  a.click();addLog('info','CSV exported: '+activeCourse.code);
}

// ── ADMIN TABS ────────────────────────────────────────────────────
function setAdminTab(tab) {
  ['dash','students','master','lecturers','settings'].forEach(t => {
    document.getElementById('atab-'+t).classList.toggle('active', t===tab);
    document.getElementById('apane-'+t).classList.toggle('active', t===tab);
  });
  if(tab==='students') renderAdminStudents();
  if(tab==='lecturers') { renderLecturerList(); renderPendingLecturers(); }
  if(tab==='master') renderMasterList();
  if(tab==='settings') { initSecuritySettings(); renderLogoPreview(); }
}

function scrollToAtRisk() {
  // Navigate to admin tab, stay on dashboard, scroll to at-risk list
  goTab('admin');
  setTimeout(() => {
    setAdminTab('dash');
    const el = document.getElementById('atrisk-list');
    if (el) el.scrollIntoView({behavior:'smooth', block:'center'});
  }, 100);
}

// ── ADMIN DASHBOARD ───────────────────────────────────────────────
async function refreshAdminDashboard(){
  if(currentUserRole!=='admin')return;
  document.getElementById('a-total').textContent=students.length;
  document.getElementById('admin-sess-display').textContent=getAcademicSession();
  document.getElementById('admin-sem-display').textContent=getSemester();
  document.getElementById('a-wknum').textContent=currentWeek;
  await loadWeeklyData();
  // Count courses and sessions
  const codes=new Set();let sessions=0;
  Object.values(weeklyData).forEach(d=>Object.keys(d).forEach(k=>{const p=k.split('_wk');if(p.length===2){codes.add(p[0]);sessions++;}}));
  document.getElementById('a-courses').textContent=codes.size;
  document.getElementById('a-sessions').textContent=sessions;
  // Level breakdown
  const levels=['ND 1','ND 2','HND 1','HND 2'];
  const colors=[`var(--blue)`,`var(--green)`,`var(--purple)`,`var(--amber)`];
  const bgs=[`var(--blue-l)`,`var(--green-l)`,`var(--purple-l)`,`var(--amber-l)`];
  const borders=[`var(--blue-b)`,`var(--green-b)`,`var(--purple-b)`,`var(--amber-b)`];
  const lb=document.getElementById('level-breakdown');
  lb.innerHTML=levels.map((lvl,i)=>{
    const cnt=students.filter(u=>u.level===lvl).length;
    return `<div onclick="showLevelStudents('${lvl}')" style="background:${bgs[i]};border:1.5px solid ${borders[i]};border-radius:var(--rs);padding:10px 12px;text-align:center;cursor:pointer;transition:transform .15s,box-shadow .15s;" onmouseover="this.style.transform='scale(1.03)';this.style.boxShadow='0 4px 18px rgba(0,0,0,.13)'" onmouseout="this.style.transform='';this.style.boxShadow=''">
      <div style="font-size:22px;font-weight:900;color:${colors[i]}">${cnt}</div>
      <div style="font-size:10px;font-weight:800;color:${colors[i]};text-transform:uppercase;letter-spacing:.8px">${lvl}</div>
      <div style="font-size:9px;color:${colors[i]};opacity:.7;margin-top:2px">Tap to view</div>
    </div>`;
  }).join('');
  // At-risk list — across all courses current week
  renderAtRiskList();
  renderCourseSummary();
  renderAttendanceTrendChart(); // #17
  loadPendingExcuses();         // #6
  loadSecretCode();
}

function showLevelStudents(lvl) {
  const lvlStudents = students.filter(u => u.level === lvl);
  const colors = {'ND 1':'var(--blue)','ND 2':'var(--green)','HND 1':'var(--purple)','HND 2':'var(--amber)'};
  const bgs    = {'ND 1':'var(--blue-l)','ND 2':'var(--green-l)','HND 1':'var(--purple-l)','HND 2':'var(--amber-l)'};
  const borders= {'ND 1':'var(--blue-b)','ND 2':'var(--green-b)','HND 1':'var(--purple-b)','HND 2':'var(--amber-b)'};
  const col = colors[lvl]||'var(--navy)';
  const bg  = bgs[lvl]||'var(--blue-l)';
  const brd = borders[lvl]||'var(--blue-b)';
  const el = document.getElementById('mlvl-modal-body');
  document.getElementById('mlvl-title').textContent = lvl + ' Students (' + lvlStudents.length + ')';
  document.getElementById('mlvl-title').style.color = col;
  if (!lvlStudents.length) {
    el.innerHTML = '<div style="font-size:13px;color:var(--txt3);text-align:center;padding:24px">No students enrolled under ' + lvl + ' yet</div>';
  } else {
    // Group HND by option
    let html = '';
    if (lvl.startsWith('HND')) {
      const opts = ['Electronics and Telecommunication','Power and Machines',''];
      opts.forEach(opt => {
        const grp = lvlStudents.filter(u => (u.option||'') === opt);
        if (!grp.length) return;
        const optLabel = opt || 'General / Unspecified';
        html += `<div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.8px;color:${col};background:${bg};border:1px solid ${brd};border-radius:6px;padding:5px 10px;margin-bottom:6px;">${optLabel} — ${grp.length}</div>`;
        html += grp.map((u,i) => `
          <div style="display:flex;align-items:center;gap:10px;padding:9px 12px;background:white;border:1.5px solid var(--border);border-radius:var(--rs);margin-bottom:5px;">
            <div style="width:32px;height:32px;border-radius:8px;background:${bg};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:${col};flex-shrink:0;">${i+1}</div>
            <div style="flex:1;min-width:0;">
              <div style="font-size:12px;font-weight:700;color:var(--txt)">${u.name}</div>
              <div style="font-size:10px;color:var(--txt3);font-family:'JetBrains Mono';">${u.matric}</div>
            </div>
            <button onclick="viewStudentReport('${u.matric}')" style="background:${bg};color:${col};border:1px solid ${brd};border-radius:6px;padding:4px 9px;font-size:11px;cursor:pointer;font-weight:700;">Report</button>
          </div>`).join('');
      });
    } else {
      html = lvlStudents.map((u,i) => `
        <div style="display:flex;align-items:center;gap:10px;padding:9px 12px;background:white;border:1.5px solid var(--border);border-radius:var(--rs);margin-bottom:5px;">
          <div style="width:32px;height:32px;border-radius:8px;background:${bg};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:${col};flex-shrink:0;">${i+1}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:12px;font-weight:700;color:var(--txt)">${u.name}</div>
            <div style="font-size:10px;color:var(--txt3);font-family:'JetBrains Mono';">${u.matric}</div>
          </div>
          <button onclick="viewStudentReport('${u.matric}')" style="background:${bg};color:${col};border:1px solid ${brd};border-radius:6px;padding:4px 9px;font-size:11px;cursor:pointer;font-weight:700;">Report</button>
        </div>`).join('');
    }
    el.innerHTML = html;
  }
  openM('mlvl');
}

function renderAtRiskList(){
  const el=document.getElementById('atrisk-list');
  const course = adminActiveCourse || activeCourse;
  if(!course){
    el.innerHTML='<div style="font-size:12px;color:var(--txt3);text-align:center;padding:12px;">Tap the course banner above to select a course</div>';
    document.getElementById('atrisk-badge').textContent='0';return;
  }
  const courseStudents=getStudentsForCourse(course);
  const baseKey=course.code.replace(/\s/g,'_')+'_'+getAcademicSession().replace('/','_')+'_'+getSemester().replace(/\s/g,'_')+'_wk';
  const atRisk=[];
  courseStudents.forEach(u=>{
    let present=0;
    for(let w=1;w<=currentWeek;w++){const k=baseKey+w;const e=weeklyData[u.matric]&&weeklyData[u.matric][k];if(e&&(e.status==='P'||e.status==='E'))present++;}
    const pct=currentWeek>0?Math.round(present/currentWeek*100):0;
    if(pct<ATT_THRESHOLD) atRisk.push({...u,pct,present});
  });
  atRisk.sort((a,b)=>a.pct-b.pct);
  document.getElementById('atrisk-badge').textContent=atRisk.length;
  if(!atRisk.length){el.innerHTML='<div style="font-size:12px;color:var(--green);text-align:center;padding:12px;font-weight:700;">All students above 75% for '+course.code+'</div>';return;}
  el.innerHTML=atRisk.map(u=>`
    <div class="risk-row">
      <div class="risk-pct">${u.pct}%</div>
      <div class="risk-info">
        <div class="risk-name">${esc(u.name)}</div>
        <div class="risk-sub">${esc(u.matric)} · ${u.present}/${currentWeek} classes · ${esc(u.level)}</div>
      </div>
    </div>`).join('');
}

function exportAtRiskCSV(){
  const course = adminActiveCourse || activeCourse;
  if(!course){alert('Select a course using the course banner in the Admin Dashboard.');return;}
  const courseStudents=getStudentsForCourse(course);
  const baseKey=course.code.replace(/\s/g,'_')+'_'+getAcademicSession().replace('/','_')+'_'+getSemester().replace(/\s/g,'_')+'_wk';
  let csv='GAPOSA EEE — Students At Risk Report\n';
  csv+=`Course:,${course.code} — ${course.title}\nSession:,${getAcademicSession()} · ${getSemester()}\nWeek:,${currentWeek}\nExported:,${new Date().toLocaleDateString('en-GB')}\n\n`;
  csv+='Matric,Name,Level,Option,Present,Total,Attendance%\n';
  courseStudents.forEach(u=>{
    let present=0;
    for(let w=1;w<=currentWeek;w++){const k=baseKey+w;const e=weeklyData[u.matric]&&weeklyData[u.matric][k];if(e&&(e.status==='P'||e.status==='E'))present++;}
    const pct=currentWeek>0?Math.round(present/currentWeek*100):0;
    if(pct<ATT_THRESHOLD) csv+=`"${u.matric}","${u.name}","${u.level}","${u.option||'General'}",${present},${currentWeek},${pct}%\n`;
  });
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  a.download=`AtRisk_${course.code.replace(/\s/g,'_')}_Wk${currentWeek}.csv`;
  a.click();addLog('info','At-risk CSV exported');
}

function renderCourseSummary(){
  const el=document.getElementById('course-summary-list');
  const course = adminActiveCourse || activeCourse;
  if(!course){el.innerHTML='<div style="font-size:12px;color:var(--txt3);text-align:center;padding:12px;">Tap the course banner above to select a course</div>';return;}
  const courseStudents=getStudentsForCourse(course);
  if(!courseStudents.length){el.innerHTML='<div style="font-size:12px;color:var(--txt3);text-align:center;padding:12px;">No students enrolled for this course level</div>';return;}
  const baseKey=course.code.replace(/\s/g,'_')+'_'+getAcademicSession().replace('/','_')+'_'+getSemester().replace(/\s/g,'_')+'_wk';
  let totalPct=0;
  const rows=courseStudents.map(u=>{
    let present=0;
    for(let w=1;w<=currentWeek;w++){const k=baseKey+w;const e=weeklyData[u.matric]&&weeklyData[u.matric][k];if(e&&(e.status==='P'||e.status==='E'))present++;}
    const pct=currentWeek>0?Math.round(present/currentWeek*100):0;
    totalPct+=pct;
    const col=pct<75?'var(--red)':pct>=90?'var(--green)':'var(--amber)';
    return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;">
      <div style="font-size:11px;font-weight:600;color:var(--txt);flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${u.name.split(' ')[0]}</div>
      <div style="width:90px;height:7px;background:var(--border);border-radius:4px;overflow:hidden;flex-shrink:0;">
        <div style="height:100%;width:${pct}%;background:${col};border-radius:4px;"></div>
      </div>
      <div style="font-size:11px;font-weight:800;color:${col};width:32px;text-align:right;flex-shrink:0;">${pct}%</div>
    </div>`;
  }).join('');
  const avg=courseStudents.length?Math.round(totalPct/courseStudents.length):0;
  el.innerHTML=`<div style="font-size:11px;font-weight:800;color:var(--navy);margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid var(--border);">
    ${course.code} — ${course.title} &nbsp;|&nbsp; Class avg: <span style="color:${avg<75?'var(--red)':'var(--green)'}">${avg}%</span>
  </div>${rows}`;
  const warn=courseStudents.filter(u=>{
    let p=0;for(let w=1;w<=currentWeek;w++){const k=baseKey+w;const e=weeklyData[u.matric]&&weeklyData[u.matric][k];if(e&&e.status==='P')p++;}
    return currentWeek>0&&Math.round(p/currentWeek*100)<ATT_THRESHOLD;
  }).length;
  document.getElementById('a-warn').textContent=warn;
}

// ── ADMIN STUDENTS TAB ────────────────────────────────────────────
let adminLevelTab='all';
function setAdminLevelTab(lvl){
  adminLevelTab=lvl;
  ['all','nd1','nd2','hnd1','hnd2'].forEach(k=>{
    const btn=document.getElementById('alvl-'+k);
    if(!btn)return;
    const match=(k==='all'?lvl==='all':lvl===k.replace('nd1','ND 1').replace('nd2','ND 2').replace('hnd1','HND 1').replace('hnd2','HND 2'));
    btn.classList.toggle('active',match);
  });
  renderAdminStudents();
}

function renderAdminStudents(){
  const el=document.getElementById('admin-student-list');
  const q=(document.getElementById('admin-student-search')?document.getElementById('admin-student-search').value:'').toLowerCase();
  const filtered=students.filter(u=>{
    const lm=adminLevelTab==='all'||u.level===adminLevelTab;
    const sm=!q||u.name.toLowerCase().includes(q)||u.matric.toLowerCase().includes(q);
    return lm&&sm;
  });
  if(!filtered.length){el.innerHTML='<div style="font-size:12px;color:var(--txt3);text-align:center;padding:20px;">No students found</div>';return;}
  const levels=['ND 1','ND 2','HND 1','HND 2'];
  let html='';
  if(adminLevelTab==='all'){
    levels.forEach(lvl=>{
      const grp=filtered.filter(u=>u.level===lvl);
      if(!grp.length)return;
      html+=`<div class="lvl-grp-hdr"><span>${lvl}</span><span>${grp.length} student${grp.length!==1?'s':''}</span></div>`;
      html+=grp.map((u,i)=>buildStudentCard(u,i)).join('');
    });
  } else {
    html=filtered.map((u,i)=>buildStudentCard(u,i)).join('');
  }
  el.innerHTML=html;
}

function buildStudentCard(u,i){
  const initial=u.name?u.name.charAt(0).toUpperCase():'?';
  const thumb=u.photo?`<img src="${u.photo}" style="width:46px;height:46px;border-radius:10px;object-fit:cover;">`
    :`<div class="stu-thumb">${initial}</div>`;
  // Get attendance % for active course if available
  let pctBadge='';
  if(activeCourse){
    const baseKey=activeCourse.code.replace(/\s/g,'_')+'_'+getAcademicSession().replace('/','_')+'_'+getSemester().replace(/\s/g,'_')+'_wk';
    let present=0;
    for(let w=1;w<=currentWeek;w++){const k=baseKey+w;const e=weeklyData[u.matric]&&weeklyData[u.matric][k];if(e&&(e.status==='P'||e.status==='E'))present++;}
    const pct=currentWeek>0?Math.round(present/currentWeek*100):null;
    if(pct!==null){
      const col=pct<75?'var(--red)':pct>=90?'var(--green)':'var(--amber)';
      const bg=pct<75?'var(--red-l)':pct>=90?'var(--green-l)':'var(--amber-l)';
      const brd=pct<75?'var(--red-b)':pct>=90?'var(--green-b)':'var(--amber-b)';
      pctBadge=`<span class="stu-badge" style="color:${col};background:${bg};border:1px solid ${brd}">${pct}% — ${activeCourse.code}</span>`;
    }
  }
  return `<div class="stu-card">
    ${thumb}
    <div class="stu-info">
      <div class="stu-name">${u.name}</div>
      <div class="stu-meta">${u.matric} · ${u.level}${u.option?' · '+u.option:''}</div>
      ${pctBadge}
    </div>
    <div class="stu-actions">
      <button class="stu-btn" style="background:var(--blue-l);color:var(--blue);" onclick="viewStudentReport('${u.matric}')" title="View report">Chart</button>
      <button class="stu-btn" style="background:var(--teal-l);color:var(--teal);" onclick="viewStudentHistory('${u.matric}')" title="Full history all sessions">History</button>
      <button class="stu-btn" style="background:var(--amber-l);color:var(--amber);" onclick="updateStudentFace('${u.matric}')" title="Update face"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></button>
      <button class="stu-btn" style="background:var(--purple-l);color:var(--purple);" onclick="removeBiometricData('${u.matric}')" title="Remove face data only"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg></button>
      <button class="stu-btn" style="background:var(--blue-l);color:var(--blue);" onclick="editStudent('${u.matric}')" title="Edit"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
      <button class="stu-btn" style="background:var(--red-l);color:var(--red);" onclick="deleteStudent('${u.matric}')" title="Delete student entirely">✕</button>
    </div>
  </div>`;
}

function printAdminStudents(){
  const q=(document.getElementById('admin-student-search')?document.getElementById('admin-student-search').value:'').toLowerCase();
  const filtered=students.filter(u=>{
    const lm=adminLevelTab==='all'||u.level===adminLevelTab;
    const sm=!q||u.name.toLowerCase().includes(q)||u.matric.toLowerCase().includes(q);
    return lm&&sm;
  });
  if(!filtered.length){alert('No students to print.');return;}
  const lvlLabel=adminLevelTab==='all'?'All Levels':adminLevelTab;
  const now=new Date();
  const dateStr=now.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  const levels=['ND 1','ND 2','HND 1','HND 2'];
  let bodyHtml='';
  if(adminLevelTab==='all'){
    levels.forEach(lvl=>{
      const grp=filtered.filter(u=>u.level===lvl);
      if(!grp.length)return;
      bodyHtml+=`<tr><td colspan="5" style="background:#003DCC;color:white;font-weight:800;padding:8px 10px;font-size:12px">${lvl} — ${grp.length} student(s)</td></tr>`;
      grp.forEach((u,i)=>{bodyHtml+=`<tr><td>${i+1}</td><td style="font-family:monospace">${u.matric}</td><td>${u.name}</td><td>${u.level}</td><td>${u.option||'General'}</td></tr>`;});
    });
  } else {
    filtered.forEach((u,i)=>{bodyHtml+=`<tr><td>${i+1}</td><td style="font-family:monospace">${u.matric}</td><td>${u.name}</td><td>${u.level}</td><td>${u.option||'General'}</td></tr>`;});
  }
  const html=`<html><head><title>GAPOSA EEE Enrolled Students</title>${getReportStyles()}</head><body>
  ${getReportHeader('Enrolled Students — ' + lvlLabel)}
  <p class="meta"><b>Printed:</b> ${dateStr} &nbsp;|&nbsp; <b>Total:</b> ${filtered.length} students</p>
  <table><thead><tr><th>#</th><th>Matric No.</th><th>Name</th><th>Level</th><th>Option</th></tr></thead>
  <tbody>${bodyHtml}</tbody></table>
  <div class="footer">GAPOSA EEE Face-ID Attendance System — Confidential</div></body></html>`;
  const w=window.open('','_blank');w.document.write(html);w.document.close();w.print();
  addLog('info','Admin student list printed: '+filtered.length);
}

// ── INDIVIDUAL STUDENT REPORT ─────────────────────────────────────
async function viewStudentReport(matric){
  const u=students.find(s=>s.matric===matric);
  if(!u){alert('Student not found.');return;}
  // Fetch fresh attendance data directly from Firestore
  let freshData = {};
  try {
    const doc = await dbFB.collection('weekly').doc(matric).get();
    if (doc.exists) freshData = doc.data();
  } catch(e) {
    freshData = weeklyData[matric] || {};
    addLog('warn','Report used cached data: '+e.message);
  }
  const now=new Date();
  const dateStr=now.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  // Group all attendance records by course code
  const courses={};
  Object.entries(freshData).forEach(([k,v])=>{
    const parts=k.match(/^(.+?)_(\d{4}_\d{4})_(.+?)_wk(\d+)$/);
    if(!parts)return;
    const code=parts[1].replace(/_/g,' ');
    const wkNum=parseInt(parts[4]);
    if(!courses[code])courses[code]={present:0,absent:0,weeks:{},title:''};
    courses[code].weeks[wkNum]={status:v.status,date:v.date||'--',time:v.time||'--'};
    if(v.status==='P'||v.status==='E')courses[code].present++;
    else courses[code].absent++;
    // Try to find course title from COURSES array
    const found=COURSES.find(c=>c.code===code);
    if(found)courses[code].title=found.title;
  });
  // Build week columns (1-15)
  const allWeeks=Array.from({length:MAX_WEEKS},(_,i)=>i+1);
  let courseRows='';
  if(Object.keys(courses).length===0){
    courseRows='<tr><td colspan="20" style="text-align:center;color:#94a3b8;padding:16px">No attendance records yet for this student</td></tr>';
  } else {
    Object.entries(courses).sort().forEach(([code,d])=>{
      const total=d.present+d.absent;
      const pct=total>0?Math.round(d.present/total*100):0;
      const col=pct<75?'#FF3B5C':pct>=90?'#00C06A':'#FF9500';
      let weekCells='';
      allWeeks.forEach(w=>{
        const entry=d.weeks[w];
        if(!entry){weekCells+=`<td style="text-align:center;color:#cbd5e1;font-size:10px">—</td>`;return;}
        const bg=entry.status==='P'?'rgba(0,192,106,.1)':entry.status==='E'?'#ede9fe':'#fee2e2';
        const tc=entry.status==='P'?'#065f46':entry.status==='E'?'#5A40E0':'#CC1E3A';
        weekCells+=`<td style="text-align:center;background:${bg};color:${tc};font-size:10px;font-weight:800">${entry.status}</td>`;
      });
      courseRows+=`<tr>
        <td style="font-weight:700;font-size:12px;white-space:nowrap;">${code}</td>
        <td style="font-size:11px;color:#64748b;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${d.title||'—'}</td>
        <td style="text-align:center;font-weight:800;color:#00C06A">${d.present}</td>
        <td style="text-align:center;font-weight:800;color:#FF3B5C">${d.absent}</td>
        <td style="text-align:center;font-weight:900;color:${col}">${pct}%</td>
        <td style="font-size:10px;color:${col};white-space:nowrap">${pct<75?'Below 75%':'OK'}</td>
        ${weekCells}
      </tr>`;
    });
  }
  const wkHeaders=allWeeks.map(w=>`<th style="text-align:center;min-width:24px;padding:6px 3px">W${w}</th>`).join('');
  const html=`<html><head><title>Student Report — ${u.name}</title>
  <style>
    *{box-sizing:border-box;}
    body{font-family:Arial,sans-serif;padding:20px;font-size:13px;color:#0f172a;}
    .meta{color:#475569;font-size:12px;margin-bottom:3px;line-height:1.5;}
    .badge{display:inline-block;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:800;}
    .ok{background:rgba(0,192,106,.1);color:#065f46;} .warn{background:rgba(255,59,92,.1);color:#CC1E3A;}
    table{width:100%;border-collapse:collapse;margin-top:14px;font-size:11px;}
    th{background:#003DCC;color:white;padding:7px 6px;text-align:left;white-space:nowrap;}
    td{padding:6px;border-bottom:1px solid #e2e8f0;vertical-align:middle;}
    tr:nth-child(even) td{background:#f8faff;}
    .footer{margin-top:20px;font-size:10px;color:#94a3b8;text-align:center;border-top:1px solid #e2e8f0;padding-top:10px;}
    @media print{body{padding:10px;}}
  
/* ── ADAPTIVE 2-COLUMN LAYOUT (≥768px) ── */
@media(min-width:768px){
  .cam-scan-grid{
    display:grid;
    grid-template-columns:3fr 2fr;
    gap:16px;
    align-items:start;
  }
  .hdr-name{font-size:15px !important;}
  header{padding:18px 20px !important;padding-top:calc(18px + env(safe-area-inset-top,0px)) !important;}
  .nav-item{font-size:10px;padding:10px 2px;}
  .nav-item svg{width:20px;height:20px;}
  .pane{padding:16px;}
}
@media(min-width:1024px){
  .hdr-name{font-size:17px !important;}
  .pane{padding:20px;}
  .card{margin-bottom:16px;}
}

</style></head><body>
  ${getReportHeader('Individual Student Attendance Report')}
  <p class="meta"><b>Name:</b> ${u.name} &nbsp;|&nbsp; <b>Matric:</b> ${u.matric} &nbsp;|&nbsp; <b>Level:</b> ${u.level}${u.option?' · '+u.option:''}</p>
  <p class="meta"><b>Programme:</b> ${u.programme||'Electrical & Electronics Engineering Technology'}</p>
  <p class="meta"><b>Session:</b> ${getAcademicSession()} · ${getSemester()} &nbsp;|&nbsp; <b>Current Week:</b> ${currentWeek} of ${MAX_WEEKS}</p>
  <p class="meta"><b>Report Generated:</b> ${dateStr}</p>
  <p class="meta" style="margin-top:6px;"><b>Courses with records: ${Object.keys(courses).length}</b> &nbsp;|&nbsp;
    ${Object.entries(courses).map(([code,d])=>{
      const total=d.present+d.absent;
      const pct=total>0?Math.round(d.present/total*100):0;
      return `<span class="badge ${pct<75?'warn':'ok'}">${code}: ${pct}%</span>`;
    }).join(' &nbsp;')}
  </p>
  <div style="overflow-x:auto;margin-top:8px;">
  <table>
    <thead>
      <tr>
        <th>Course</th><th>Title</th><th style="text-align:center">✓ Present</th>
        <th style="text-align:center">✗ Absent</th><th style="text-align:center">Att%</th>
        <th>Status</th>${wkHeaders}
      </tr>
    </thead>
    <tbody>${courseRows}</tbody>
  </table>
  </div>
  <div class="footer">GAPOSA EEE Face-ID Attendance System — Individual Student Full Report (All Courses)</div>
  </body></html>`;
  const w=window.open('','_blank');
  if(w){w.document.write(html);w.document.close();setTimeout(()=>w.print(),500);}
  addLog('info','Full student report printed: '+u.name+' | '+Object.keys(courses).length+' course(s)');
}

// ── STUDENT FACE UPDATE (HOD only) ────────────────────────────────
let faceUpdateMatric=null;
function updateStudentFace(matric){
  if(currentUserRole!=='admin'){alert('Only the HOD can update face data.');return;}
  const u=students.find(s=>s.matric===matric);
  if(!u){alert('Student not found.');return;}
  if(!confirm('Update face data for '+u.name+'?\n\nThis will replace their current face samples. Make sure the student is present.')){return;}
  faceUpdateMatric=matric;
  // Reuse enroll tab camera — switch to enroll tab
  document.getElementById('rmatric').value=u.matric;
  document.getElementById('rname').value=u.name;
  document.getElementById('rlevel').value=u.level;
  updateOptionRow();
  if(u.option)document.getElementById('roption').value=u.option;
  // Clear existing samples
  samples=[];
  for(let i=0;i<SAMPLES_NEEDED;i++){const s=document.getElementById('sd'+i);if(s){s.innerHTML=[1,2,'<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>','&larr;'][i]||String(i+1);s.style.border='';s.style.boxShadow='';s.classList.remove('done');}}
  document.getElementById('slbl').textContent='0 / '+SAMPLES_NEEDED;
  document.getElementById('sprog').style.width='0%';
  document.getElementById('breg').disabled=true;
  document.getElementById('breg').textContent='Update Face Data';
  setER('Capture '+SAMPLES_NEEDED+' new face samples for '+u.name,'info');
  // Navigate to enroll tab
  goTab('enroll');
  addLog('info','Face update initiated for: '+u.name);
}

// ── FULL DB EXPORT ────────────────────────────────────────────────
async function exportFullDB(){
  if(currentUserRole!=='admin'){alert('HOD only.');return;}
  await loadWeeklyDataFull(); // use full data for backup
  let csv='GAPOSA EEE — Full Database Backup\n';
  csv+=`Session:,${getAcademicSession()}\nSemester:,${getSemester()}\nExported:,${new Date().toLocaleDateString('en-GB')} ${new Date().toTimeString().slice(0,5)}\nTotal Students:,${students.length}\n\n`;
  csv+='=== ENROLLED STUDENTS ===\n';
  csv+='Matric,Name,Level,Option,Programme,EnrolledBy,EnrolledAt\n';
  students.forEach(u=>{csv+=`"${u.matric}","${u.name}","${u.level}","${u.option||''}","${u.programme||''}","${u.enrolledBy||''}","${u.enrolledAt||''}"\n`;});
  csv+='\n=== ATTENDANCE RECORDS ===\n';
  csv+='Matric,Name,Level,CourseKey,Week,Status,Time,Date\n';
  students.forEach(u=>{
    const d=weeklyData[u.matric]||{};
    Object.entries(d).forEach(([k,v])=>{
      csv+=`"${u.matric}","${u.name}","${u.level}","${k}","${v.week||''}","${v.status||''}","${v.time||''}","${v.date||''}"\n`;
    });
  });
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));
  a.download=`GAPOSA_EEE_FullBackup_${getAcademicSession().replace('/','_')}_${new Date().toLocaleDateString('en-GB').replace(/\//g,'-')}.csv`;
  a.click();
  // FIX 3: Record backup date for the weekly reminder
  lsSet('lastBackupDate', new Date().toISOString());
  addLog('ok','Full DB backup exported: '+students.length+' students');
}

// ── AUTO-LOGOUT (15 min inactivity) ──────────────────────────────
// ── AUTO-LOGOUT (configurable) ────────────────────────────────────
let _idleTimer=null;
let _autoLogoutMinutes=parseInt(lsGet('autoLogoutMinutes')||'15');
let _offlineQueueEnabled=(lsGet('offlineQueueEnabled')||'1')==='1';

function setAutoLogoutDuration(val){
  _autoLogoutMinutes=parseInt(val);
  lsSet('autoLogoutMinutes',val);
  resetIdleTimer();
  const label=val==='0'?'Off':val+' min';
  addLog('info','Auto-logout set to: '+label);
}

function setOfflineQueueEnabled(val){
  _offlineQueueEnabled=val==='1';
  lsSet('offlineQueueEnabled',val);
  addLog('info','Offline scan queue: '+(_offlineQueueEnabled?'On':'Off'));
}

async function saveMaxWeeks(val){
  const weeks = parseInt(val);
  if(!weeks||weeks<1||weeks>30){return;}
  try{
    await dbFB.collection('settings').doc('academic').set({maxWeeks:weeks},{merge:true});
    MAX_WEEKS = weeks;
    updateWeekDisplay();
    setAdminSt('Semester length set to '+weeks+' weeks. Takes effect immediately.','ok');
    addLog('ok','MAX_WEEKS changed to '+weeks+' by '+currentUserName);
  }catch(e){setAdminSt('Save failed: '+e.message,'err');}
}

function initSecuritySettings(){
  const als=document.getElementById('auto-logout-select');
  if(als){als.value=String(_autoLogoutMinutes);if(!als.value)als.value='15';}
  const oqs=document.getElementById('offline-queue-select');
  if(oqs)oqs.value=_offlineQueueEnabled?'1':'0';
  // FIX 7: Sync max-weeks dropdown to current value
  const mws=document.getElementById('max-weeks-select');
  if(mws){mws.value=String(MAX_WEEKS);if(!mws.value)mws.value='15';}
  renderLogoPreview();
}

function resetIdleTimer(){
  clearTimeout(_idleTimer);
  if(!_autoLogoutMinutes||_autoLogoutMinutes===0)return; // Off
  _idleTimer=setTimeout(()=>{
    if(currentUser){
      const label=_autoLogoutMinutes>=60?'1 hour':_autoLogoutMinutes+' minutes';
      addLog('warn','Auto-logout: '+label+' inactivity');
      alert('You have been automatically logged out after '+label+' of inactivity.');
      doLogout();
    }
  },_autoLogoutMinutes*60*1000);
}
['click','keydown','touchstart','mousemove'].forEach(evt=>document.addEventListener(evt,resetIdleTimer,true));

// ── OFFLINE SCAN QUEUE ────────────────────────────────────────────
let offlineQueue=JSON.parse(lsGet('offlineQueue')||'[]');
function updateOfflineQueueBanner() {
  const queue = JSON.parse(lsGet('offlineQueue') || '[]');
  const banner = document.getElementById('offline-queue-banner');
  const msg = document.getElementById('offline-queue-msg');
  if (!banner) return;
  if (queue.length > 0) {
    banner.style.display = 'flex';
    msg.textContent = queue.length + ' offline scan' + (queue.length !== 1 ? 's' : '') + ' pending cloud sync — go online to sync';
  } else {
    banner.style.display = 'none';
  }
}

async function flushOfflineQueue(){
  if(!offlineQueue.length){ updateOfflineQueueBanner(); return; }
  addLog('info','Flushing '+offlineQueue.length+' offline scan(s)...');
  const failed=[];
  for(const item of offlineQueue){
    try{
      await dbFB.collection('weekly').doc(item.matric).set(item.data,{merge:true});
      addLog('ok','Offline scan synced: '+item.matric+' '+item.key);
    }catch(e){failed.push(item);}
  }
  offlineQueue=failed;
  lsSet('offlineQueue',JSON.stringify(offlineQueue));
  updateOfflineQueueBanner();
  if(!failed.length) addLog('ok','All offline scans synced successfully');
  else addLog('warn', failed.length + ' scan(s) still pending — still offline?');
}
window.addEventListener('online',flushOfflineQueue);

// FIX 10: Warn before leaving if offline queue has unsynced scans
window.addEventListener('beforeunload', (e) => {
  const queue = JSON.parse(lsGet('offlineQueue') || '[]');
  if (queue.length > 0) {
    const msg = queue.length + ' offline scan(s) are not yet synced to the cloud. Closing now may lose them. Stay on the page until you are online and they sync.';
    e.preventDefault();
    e.returnValue = msg;
    return msg;
  }
});

// ══════════════════════════════════════════════════════════════════
// #5: STUDENT ATTENDANCE SELF-VIEW
// ══════════════════════════════════════════════════════════════════
let _mrLookupDebounce = null;
let _mrLookupCount = 0, _mrLookupWindowStart = Date.now();

function loadMyRecord(val) {
  clearTimeout(_mrLookupDebounce);
  _mrLookupDebounce = setTimeout(() => _doLoadMyRecord(val.trim()), 700);
}

async function _doLoadMyRecord(matric) {
  const statusEl = document.getElementById('mr-status');
  const resultsEl = document.getElementById('mr-results');
  const excuseEl = document.getElementById('mr-excuse-section');
  if (!matric || matric.length < 6) {
    statusEl.style.display='none'; resultsEl.style.display='none'; excuseEl.style.display='none'; return;
  }
  // Rate limit: 5 per minute
  const now = Date.now();
  if(now - _mrLookupWindowStart > 60000){ _mrLookupCount=0; _mrLookupWindowStart=now; }
  _mrLookupCount++;
  if(_mrLookupCount > 5){
    statusEl.textContent='Too many attempts. Please wait.';
    statusEl.style.cssText='font-size:11px;margin-top:5px;display:block;padding:7px 10px;border-radius:7px;font-weight:600;background:rgba(255,59,92,.1);color:#FF3B5C;border:1px solid #FF8FA3;';
    return;
  }
  statusEl.textContent='Searching...';
  statusEl.style.cssText='font-size:11px;margin-top:5px;display:block;padding:7px 10px;border-radius:7px;font-weight:600;background:#e8f0fe;color:#0057FF;border:1px solid #bfdbfe;';
  resultsEl.style.display='none'; excuseEl.style.display='none';

  try {
    if(!authFB.currentUser) await authFB.signInAnonymously();
    // Verify matric exists in master list
    const masterDoc = await dbFB.collection('masterlist').doc(matric).get();
    if(!masterDoc.exists){
      statusEl.textContent='❌ Matric not found. Check your matric number.';
      statusEl.style.cssText='font-size:11px;margin-top:5px;display:block;padding:7px 10px;border-radius:7px;font-weight:600;background:rgba(255,59,92,.1);color:#FF3B5C;border:1px solid #FF8FA3;';
      return;
    }
    const studentInfo = masterDoc.data();
    // Check enrollment
    const enrolledDoc = await dbFB.collection('students').doc(matric).get();
    const isEnrolled = enrolledDoc.exists;

    // Fetch attendance records
    const weeklyDoc = await dbFB.collection('weekly').doc(matric).get();
    const records = weeklyDoc.exists ? weeklyDoc.data() : {};

    // Get current session
    const sessDoc = await dbFB.collection('settings').doc('academic').get();
    const sess = sessDoc.exists ? sessDoc.data().session : _autoSession();
    const sem  = sessDoc.exists ? sessDoc.data().semester : _autoSemester();
    const sessKey = sess.replace('/','_')+'_'+sem.replace(/\s/g,'_');

    // Group by course
    const courses = {};
    Object.entries(records).forEach(([k,v])=>{
      if(!k.includes(sessKey)) return;
      const match = k.match(/^(.+?)_\d{4}_\d{4}_/);
      if(!match) return;
      const code = match[1].replace(/_/g,' ');
      if(!courses[code]) courses[code]={present:0,absent:0,total:0};
      if(v.status==='P') courses[code].present++;
      else if(v.status==='A') courses[code].absent++;
      courses[code].total++;
    });

    statusEl.textContent='✓ Found: '+esc(studentInfo.name);
    statusEl.style.cssText='font-size:11px;margin-top:5px;display:block;padding:7px 10px;border-radius:7px;font-weight:600;background:rgba(0,192,106,.1);color:#00C06A;border:1px solid #6EE7B7;';

    const courseEntries = Object.entries(courses);
    let html = `<div style="background:#f8faff;border:1.5px solid #e2e8f0;border-radius:10px;padding:12px;margin-bottom:10px;">
      <div style="font-size:13px;font-weight:800;color:#003DCC;margin-bottom:2px;">${esc(studentInfo.name)}</div>
      <div style="font-size:11px;color:#64748b;">${esc(studentInfo.level)}${studentInfo.option?' · '+esc(studentInfo.option):''} &nbsp;·&nbsp; ${esc(matric)}</div>
      <div style="font-size:11px;color:#64748b;margin-top:2px;">Session: ${esc(sess)} · ${esc(sem)}</div>
      <div style="font-size:11px;margin-top:4px;font-weight:700;color:${isEnrolled?'#00C06A':'#FF3B5C'};">${isEnrolled?'✓ Face enrolled':'⚠ Face not enrolled yet'}</div>
    </div>`;

    if(!courseEntries.length){
      html += '<div style="font-size:12px;color:#94a3b8;text-align:center;padding:12px;">No attendance records yet for this session.</div>';
    } else {
      html += '<div style="font-size:11px;font-weight:700;color:#475569;margin-bottom:6px;">Attendance by Course</div>';
      courseEntries.forEach(([code, d])=>{
        const pct = d.total>0 ? Math.round(d.present/d.total*100) : 0;
        const col = pct<75?'#FF3B5C':pct>=90?'#00C06A':'#FF9500';
        const bg  = pct<75?'#fee2e2':pct>=90?'rgba(0,192,106,.1)':'#fef3c7';
        html += `<div style="background:${bg};border-radius:8px;padding:8px 12px;margin-bottom:6px;display:flex;align-items:center;gap:10px;">
          <div style="flex:1;">
            <div style="font-size:12px;font-weight:700;color:#0f172a;">${esc(code)}</div>
            <div style="font-size:10px;color:#64748b;">${d.present} present · ${d.absent} absent of ${d.total} recorded</div>
          </div>
          <div style="font-size:16px;font-weight:900;color:${col};">${pct}%</div>
        </div>`;
      });
      // Overall
      const totalP = courseEntries.reduce((s,[,d])=>s+d.present,0);
      const totalT = courseEntries.reduce((s,[,d])=>s+d.total,0);
      const overall = totalT>0?Math.round(totalP/totalT*100):0;
      html += `<div style="background:#003DCC;border-radius:8px;padding:8px 12px;display:flex;align-items:center;gap:10px;margin-top:4px;">
        <div style="flex:1;font-size:12px;font-weight:700;color:white;">Overall Average</div>
        <div style="font-size:16px;font-weight:900;color:${overall<75?'#FF8FA3':'#6EE7B7'};">${overall}%</div>
      </div>`;
    }
    resultsEl.innerHTML = html;
    resultsEl.style.display = 'block';
    excuseEl.style.display = 'block'; // show excuse section
  } catch(e) {
    statusEl.textContent = 'Error: '+e.message;
    statusEl.style.cssText='font-size:11px;margin-top:5px;display:block;padding:7px 10px;border-radius:7px;font-weight:600;background:rgba(255,59,92,.1);color:#FF3B5C;border:1px solid #FF8FA3;';
  }
}

// ══════════════════════════════════════════════════════════════════
// #8: EXCUSE / ABSENCE SUBMISSION
// ══════════════════════════════════════════════════════════════════
function updateExcuseDocLabel() {
  const type = document.getElementById('mr-excuse-type').value;
  const label = document.getElementById('mr-doc-label');
  const hint = document.getElementById('mr-doc-hint');
  const map = {
    'Medical': ['Hospital Report (Required)', 'Attach your hospital attendance card or medical report (JPG/PNG/PDF)'],
    'Legal': ['Police Report (Required)', 'Attach official police report or statement (JPG/PNG/PDF)'],
    'Family': ['Supporting Document (Optional)', 'Death certificate, hospital receipt, or any official proof'],
    'Academic': ['Official Letter (Required)', 'Department approval letter or activity programme (JPG/PNG/PDF)'],
    'Other': ['Supporting Document', 'Any official document supporting your excuse (JPG/PNG/PDF)'],
  };
  if(map[type]) {
    if(label) label.textContent = map[type][0];
    if(hint) hint.textContent = map[type][1];
  }
}

let _excuseFileData = null;
let _excuseFileName = '';

function handleExcuseFile(input) {
  const file = input.files[0];
  const preview = document.getElementById('mr-file-preview');
  if(!file) { _excuseFileData = null; _excuseFileName = ''; if(preview) preview.style.display='none'; return; }
  if(file.size > 2 * 1024 * 1024) {
    alert('File too large. Maximum size is 2MB. Please compress or resize the image.');
    input.value = ''; _excuseFileData = null; return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    _excuseFileData = e.target.result; // base64 data URL
    _excuseFileName = file.name;
    if(preview) {
      preview.style.display = 'block';
      preview.innerHTML = `✓ Attached: <b>${file.name}</b> (${(file.size/1024).toFixed(0)}KB)`;
    }
  };
  reader.readAsDataURL(file);
}

async function submitExcuse() {
  const matric  = (document.getElementById('mr-matric')||{}).value?.trim();
  const week    = parseInt((document.getElementById('mr-excuse-week')||{}).value);
  const course  = (document.getElementById('mr-excuse-course')||{}).value?.trim().toUpperCase();
  const excuseType = (document.getElementById('mr-excuse-type')||{}).value;
  const reason  = (document.getElementById('mr-excuse-reason')||{}).value?.trim();
  const statusEl= document.getElementById('mr-excuse-status');

  if(!matric||!week||!course||!excuseType||!reason){
    statusEl.textContent='Please fill in all fields — week, course, type, and reason.';
    statusEl.style.cssText='font-size:11px;margin-top:6px;display:block;padding:7px 10px;border-radius:7px;font-weight:600;background:rgba(255,59,92,.2);color:#FF8FA3;border:1px solid rgba(252,165,165,.3);';
    return;
  }
  if(reason.length<20){
    statusEl.textContent='Please provide a more detailed reason (at least 20 characters).';
    statusEl.style.cssText='font-size:11px;margin-top:6px;display:block;padding:7px 10px;border-radius:7px;font-weight:600;background:rgba(255,59,92,.2);color:#FF8FA3;border:1px solid rgba(252,165,165,.3);';
    return;
  }
  // Medical/Legal/Academic require a document
  if(['Medical','Legal','Academic'].includes(excuseType) && !_excuseFileData) {
    statusEl.textContent='A supporting document is required for this excuse type. Please attach the relevant report.';
    statusEl.style.cssText='font-size:11px;margin-top:6px;display:block;padding:10px;border-radius:7px;font-weight:600;background:rgba(217,119,6,.25);color:#fcd34d;border:1px solid rgba(252,211,77,.3);line-height:1.5;';
    return;
  }
  statusEl.textContent='⏳ Submitting...';
  statusEl.style.cssText='font-size:11px;margin-top:6px;display:block;padding:7px 10px;border-radius:7px;font-weight:600;background:rgba(255,255,255,.1);color:rgba(255,255,255,.7);';
  try {
    if(!authFB.currentUser) await authFB.signInAnonymously();
    const excuseData = {
      matric, week, course, excuseType, reason,
      documentAttached: !!_excuseFileData,
      documentName: _excuseFileName || '',
      // Store document as base64 (small files only — max 2MB enforced above)
      documentData: _excuseFileData || null,
      status: 'pending',
      submittedAt: new Date().toISOString()
    };
    await dbFB.collection('excuses').add(excuseData);
    statusEl.textContent='✓ Excuse submitted successfully! Your HOD will review it and update your record if approved.';
    statusEl.style.cssText='font-size:11px;margin-top:6px;display:block;padding:10px;border-radius:7px;font-weight:600;background:rgba(0,192,106,.25);color:#6EE7B7;border:1px solid rgba(110,231,183,.3);line-height:1.6;';
    // Clear form
    document.getElementById('mr-excuse-week').value='';
    document.getElementById('mr-excuse-course').value='';
    document.getElementById('mr-excuse-type').value='';
    document.getElementById('mr-excuse-reason').value='';
    const fp = document.getElementById('mr-file-preview'); if(fp) fp.style.display='none';
    const fi = document.getElementById('mr-excuse-file'); if(fi) fi.value='';
    _excuseFileData = null; _excuseFileName = '';
    addLog('info','Excuse submitted by matric: '+matric+' for '+course+' Week '+week+' ('+excuseType+')');
  } catch(e) {
    statusEl.textContent='Submit failed: '+e.message;
    statusEl.style.cssText='font-size:11px;margin-top:6px;display:block;padding:7px 10px;border-radius:7px;font-weight:600;background:rgba(255,59,92,.2);color:#FF8FA3;border:1px solid rgba(252,165,165,.3);';
  }
}

// ══════════════════════════════════════════════════════════════════
// #6: AT-RISK AUTOMATED ALERTS — HOD sees pending excuses + at-risk summary on dashboard
// ══════════════════════════════════════════════════════════════════
async function loadPendingExcuses() {
  const el = document.getElementById('excuse-review-list');
  if(!el) return;
  try {
    const snap = await dbFB.collection('excuses').where('status','==','pending').orderBy('submittedAt','desc').get();
    if(snap.empty){ el.innerHTML='<div style="font-size:12px;color:var(--green);text-align:center;padding:10px;font-weight:700;">✓ No pending excuse requests</div>'; return; }
    el.innerHTML = snap.docs.map(d=>{
      const e=d.data(); const id=d.id;
      const date = e.submittedAt ? new Date(e.submittedAt).toLocaleDateString('en-GB') : '—';
      const typeColors = {Medical:'var(--teal)',Legal:'var(--red)',Family:'var(--purple)',Academic:'var(--blue)',Other:'var(--amber)'};
      const typeColor = typeColors[e.excuseType] || 'var(--txt3)';
      const hasDoc = e.documentAttached && e.documentData;
      const docBtn = hasDoc ? `<button onclick="viewExcuseDocument('${id}')" style="padding:4px 8px;background:var(--blue-l);color:var(--blue);border:1px solid var(--blue-b);border-radius:5px;font-family:'Plus Jakarta Sans',sans-serif;font-size:10px;font-weight:700;cursor:pointer;margin-bottom:6px;">View Document: ${esc(e.documentName||'Document')}</button>` : '';
      return `<div style="background:#fff;border:1.5px solid var(--border);border-radius:var(--rs);padding:10px 12px;margin-bottom:8px;">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
          <div style="font-size:12px;font-weight:800;color:var(--txt);">${esc(e.matric)} · ${esc(e.course)} Wk${e.week}</div>
          ${e.excuseType?`<span style="font-size:9px;font-weight:700;padding:2px 7px;border-radius:20px;background:rgba(0,0,0,.06);color:${typeColor};">${esc(e.excuseType)}</span>`:''}
        </div>
        <div style="font-size:11px;color:var(--txt2);margin:4px 0;line-height:1.5;">${esc(e.reason)}</div>
        <div style="font-size:10px;color:var(--txt3);margin-bottom:6px;">Submitted: ${date} ${e.documentAttached?'· Document attached':''}</div>
        ${docBtn}
        <div style="display:flex;gap:8px;">
          <button onclick="reviewExcuse('${id}','approved')" style="flex:1;padding:7px;background:linear-gradient(135deg,var(--green),#008F4E);color:white;border:none;border-radius:7px;font-family:'Plus Jakarta Sans',sans-serif;font-size:11px;font-weight:700;cursor:pointer;">✓ Approve</button>
          <button onclick="reviewExcuse('${id}','rejected')" style="flex:1;padding:7px;background:var(--red-l);color:var(--red);border:1.5px solid var(--red-b);border-radius:7px;font-family:'Plus Jakarta Sans',sans-serif;font-size:11px;font-weight:700;cursor:pointer;">✕ Reject</button>
        </div>
      </div>`;
    }).join('');
  } catch(e) { el.innerHTML='<div style="font-size:12px;color:var(--red);padding:10px;">Error: '+e.message+'</div>'; }
}

function viewExcuseDocument(excuseId) {
  // Find the excuse in Firestore and open the attached document
  dbFB.collection('excuses').doc(excuseId).get().then(doc => {
    if(!doc.exists || !doc.data().documentData) { alert('Document not available.'); return; }
    const data = doc.data();
    const w = window.open('', '_blank');
    if(!w) { alert('Please allow popups to view documents.'); return; }
    if(data.documentData.startsWith('data:image')) {
      w.document.write(`<html><body style="margin:0;background:#000;display:flex;align-items:center;justify-content:center;min-height:100vh;">
        <img src="${data.documentData}" style="max-width:100%;max-height:100vh;object-fit:contain;" alt="Excuse Document">
        </body></html>`);
    } else {
      // PDF — open in iframe
      w.document.write(`<html><body style="margin:0;"><iframe src="${data.documentData}" style="width:100%;height:100vh;border:none;"></iframe></body></html>`);
    }
    w.document.close();
  }).catch(e => alert('Error loading document: '+e.message));
}

async function reviewExcuse(id, decision) {
  if(currentUserRole!=='admin'){alert('Only the HOD can review excuses.');return;}
  try {
    const excuseDoc = await dbFB.collection('excuses').doc(id).get();
    if(!excuseDoc.exists) return;
    const e = excuseDoc.data();
    await dbFB.collection('excuses').doc(id).update({
      status: decision,
      reviewedBy: currentUserName,
      reviewedAt: new Date().toISOString()
    });
    // If approved — mark attendance as Excused (E) instead of Absent
    if(decision === 'approved'){
      const sessDoc = await dbFB.collection('settings').doc('academic').get();
      const sess = sessDoc.exists ? sessDoc.data().session : _autoSession();
      const sem  = sessDoc.exists ? sessDoc.data().semester : _autoSemester();
      const key = e.course.replace(/\s/g,'_')+'_'+sess.replace('/','_')+'_'+sem.replace(/\s/g,'_')+'_wk'+e.week;
      const weeklyDoc = await dbFB.collection('weekly').doc(e.matric).get();
      const existing = weeklyDoc.exists ? weeklyDoc.data() : {};
      existing[key] = {...(existing[key]||{}), status:'E', excuseApproved:true, approvedBy:currentUserName};
      await dbFB.collection('weekly').doc(e.matric).set(existing, {merge:true});
      // Audit log
      await dbFB.collection('audit_log').add({
        type:'excuse_approved', matric:e.matric, course:e.course, week:e.week,
        approvedBy:currentUserName, timestamp:new Date().toISOString()
      });
      setAdminSt('✓ Excuse approved — Week '+e.week+' for '+e.matric+' marked Excused (E)','ok');
    } else {
      setAdminSt('Excuse rejected for '+e.matric+' Week '+e.week,'warn');
    }
    addLog('ok','Excuse '+decision+' for '+e.matric+' | '+e.course+' Wk'+e.week);
    loadPendingExcuses();
  } catch(err) { alert('Error: '+err.message); }
}

// ══════════════════════════════════════════════════════════════════
// #17: ATTENDANCE TREND CHART — week-by-week line chart on dashboard
// ══════════════════════════════════════════════════════════════════
function renderAttendanceTrendChart() {
  const container = document.getElementById('trend-chart-container');
  if(!container) return;
  const course = adminActiveCourse || activeCourse;
  if(!course){ container.innerHTML='<div style="font-size:12px;color:var(--txt3);text-align:center;padding:16px;">Select a course to view attendance trend</div>'; return; }
  const courseStudents = getStudentsForCourse(course);
  if(!courseStudents.length){ container.innerHTML='<div style="font-size:12px;color:var(--txt3);text-align:center;padding:12px;">No students enrolled for this course</div>'; return; }
  const baseKey = course.code.replace(/\s/g,'_')+'_'+getAcademicSession().replace('/','_')+'_'+getSemester().replace(/\s/g,'_')+'_wk';

  // Build week-by-week attendance % data
  const weeks = [], pcts = [];
  for(let w=1;w<=currentWeek;w++){
    let presentCount=0, totalCount=0;
    courseStudents.forEach(u=>{
      const k=baseKey+w;
      const entry=weeklyData[u.matric]&&weeklyData[u.matric][k];
      if(entry){ totalCount++; if(entry.status==='P'||entry.status==='E') presentCount++; }
    });
    if(totalCount>0){ weeks.push('W'+w); pcts.push(Math.round(presentCount/totalCount*100)); }
  }
  if(!weeks.length){ container.innerHTML='<div style="font-size:12px;color:var(--txt3);text-align:center;padding:12px;">No data yet — finalise a session to see trends</div>'; return; }

  // Draw simple SVG bar/line chart
  const W=container.clientWidth||300, H=140, pad={top:16,right:16,bottom:28,left:36};
  const chartW=W-pad.left-pad.right, chartH=H-pad.top-pad.bottom;
  const barW=Math.max(4, Math.min(20, chartW/weeks.length - 4));
  const x=(i)=>pad.left + i*(chartW/weeks.length) + chartW/(weeks.length*2);
  const y=(pct)=>pad.top + chartH - (pct/100)*chartH;

  let bars='', labels='', line='', points='';
  weeks.forEach((w,i)=>{
    const px=x(i), py=y(pcts[i]);
    const col=pcts[i]<75?'#FF3B5C':pcts[i]>=90?'#00C06A':'#FF9500';
    bars+=`<rect x="${px-barW/2}" y="${py}" width="${barW}" height="${y(0)-py}" fill="${col}" opacity="0.2" rx="2"/>`;
    labels+=`<text x="${px}" y="${H-8}" text-anchor="middle" font-size="9" fill="#94a3b8">${w}</text>`;
    if(i>0){
      const ppx=x(i-1), ppy=y(pcts[i-1]);
      const lc=pcts[i]<75?'#FF3B5C':pcts[i]>=90?'#00C06A':'#FF9500';
      line+=`<line x1="${ppx}" y1="${ppy}" x2="${px}" y2="${py}" stroke="${lc}" stroke-width="2"/>`;
    }
    points+=`<circle cx="${px}" cy="${py}" r="4" fill="${pcts[i]<75?'#FF3B5C':pcts[i]>=90?'#00C06A':'#FF9500'}" stroke="white" stroke-width="1.5"/>`;
    points+=`<text x="${px}" y="${py-8}" text-anchor="middle" font-size="9" font-weight="700" fill="${pcts[i]<75?'#FF3B5C':'#475569'}">${pcts[i]}%</text>`;
  });
  // 75% threshold line
  const threshY = y(75);
  const threshLine = `<line x1="${pad.left}" y1="${threshY}" x2="${W-pad.right}" y2="${threshY}" stroke="#FF3B5C" stroke-width="1" stroke-dasharray="4,3" opacity="0.5"/>
    <text x="${pad.left+2}" y="${threshY-3}" font-size="8" fill="#FF3B5C" opacity="0.7">75%</text>`;
  // Y axis labels
  let yLabels='';
  [0,25,50,75,100].forEach(v=>{
    yLabels+=`<text x="${pad.left-4}" y="${y(v)+4}" text-anchor="end" font-size="8" fill="#cbd5e1">${v}%</text>`;
  });

  container.innerHTML=`<svg width="100%" viewBox="0 0 ${W} ${H}" style="overflow:visible;">
    ${yLabels}${threshLine}${bars}${line}${points}${labels}
  </svg>`;
}

// ══════════════════════════════════════════════════════════════════
// #18: CROSS-SEMESTER / HISTORICAL STUDENT VIEW
// ══════════════════════════════════════════════════════════════════
async function viewStudentHistory(matric) {
  const u = students.find(s=>s.matric===matric);
  if(!u){alert('Student not found.');return;}
  // Load full historical data
  let freshData={};
  try{
    const doc=await dbFB.collection('weekly').doc(matric).get();
    if(doc.exists) freshData=doc.data();
  }catch(e){freshData=weeklyData[matric]||{};}

  // Group by session-semester
  const sessionMap={};
  Object.entries(freshData).forEach(([k,v])=>{
    const mSess=k.match(/(\d{4}_\d{4})/);
    const mSem=k.match(/(1st_Semester|2nd_Semester)/);
    if(!mSess||!mSem) return;
    const sessLabel=mSess[1].replace('_','/')+' · '+mSem[1].replace('_',' ');
    if(!sessionMap[sessLabel]) sessionMap[sessLabel]={present:0,total:0,courses:new Set()};
    sessionMap[sessLabel].total++;
    if(v.status==='P'||v.status==='E') sessionMap[sessLabel].present++;
    const cMatch=k.match(/^([A-Z]+_\d+)/);
    if(cMatch) sessionMap[sessLabel].courses.add(cMatch[1].replace('_',' '));
  });

  const now=new Date();
  const dateStr=now.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  let sectHtml='';
  Object.entries(sessionMap).sort().reverse().forEach(([sess,d])=>{
    const pct=d.total>0?Math.round(d.present/d.total*100):0;
    const col=pct<75?'#FF3B5C':pct>=90?'#00C06A':'#FF9500';
    sectHtml+=`<tr>
      <td style="font-weight:600;font-size:12px;">${esc(sess)}</td>
      <td style="text-align:center;">${d.present}/${d.total}</td>
      <td style="text-align:center;font-weight:800;color:${col};">${pct}%</td>
      <td style="font-size:10px;color:#64748b;">${[...d.courses].join(', ')}</td>
    </tr>`;
  });
  if(!sectHtml) sectHtml='<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:12px;">No historical records found</td></tr>';

  const html=`<html><head><title>Student History — ${esc(u.name)}</title>${getReportStyles()}</head><body>
  ${getReportHeader('STUDENT ATTENDANCE HISTORY — ALL SESSIONS')}
  <div class="info-row">
    <div class="info-cell">Name: <span>${esc(u.name)}</span></div>
    <div class="info-cell">Matric: <span>${esc(u.matric)}</span></div>
    <div class="info-cell">Level: <span>${esc(u.level)}${u.option?' · '+esc(u.option):''}</span></div>
    <div class="info-cell">Report Date: <span>${dateStr}</span></div>
  </div>
  <table>
    <thead><tr><th>Session</th><th style="text-align:center;">Present/Total</th><th style="text-align:center;">Attendance%</th><th>Courses</th></tr></thead>
    <tbody>${sectHtml}</tbody>
  </table>
  <div class="footer">The Gateway Polytechnic, Saapade &nbsp;·&nbsp; EEE Attendance System &nbsp;·&nbsp; Historical Report</div>
  </body></html>`;
  const w=window.open('','_blank');
  if(w){w.document.write(html);w.document.close();setTimeout(()=>w.print(),400);}
  addLog('info','Student history printed: '+u.name);
}

// ══════════════════════════════════════════════════════════════════
// #20: DESCRIPTOR COMPRESSION — when re-enrolling, compress to 4 decimal places
// (already 6dp from before; change to 4dp to reduce storage ~33%)
// ══════════════════════════════════════════════════════════════════
function compressDescriptors(descriptorArray){
  return descriptorArray.map(d=>Array.from(d).map(v=>Number(v).toFixed(4)).join(','));
}


async function checkScheduledBackup(){
  if(currentUserRole !== 'admin') return; // HOD only
  try{
    const now = new Date();
    const hour = now.getHours();
    const today = now.toLocaleDateString('en-GB');
    const lastBackupStr = lsGet('lastBackupDate');
    const lastDismissStr = lsGet('backupDismissedDate');

    // Already backed up today → no reminder
    if(lastBackupStr){
      const lastDay = new Date(lastBackupStr).toLocaleDateString('en-GB');
      if(lastDay === today) return;
    }

    // Before 5PM → schedule check for 5PM
    if(hour < 17){
      const msUntil5pm = ((17 - hour) * 3600 - now.getMinutes() * 60 - now.getSeconds()) * 1000;
      if(msUntil5pm > 0) setTimeout(checkScheduledBackup, msUntil5pm + 500);
      return;
    }

    // Already dismissed today
    if(lastDismissStr === today) return;

    // Show banner
    if(document.getElementById('backup-reminder')) return;
    setTimeout(()=>{
      if(document.getElementById('backup-reminder')) return;
      const daysSince = lastBackupStr ? Math.floor((now - new Date(lastBackupStr)) / 86400000) : 999;
      const banner = document.createElement('div');
      banner.id = 'backup-reminder';
      banner.style.cssText='position:fixed;bottom:80px;left:50%;transform:translateX(-50%);width:calc(100% - 24px);max-width:640px;z-index:7500;font-family:\'Plus Jakarta Sans\',sans-serif;';
      banner.innerHTML=`<div style="background:linear-gradient(135deg,#FF9500,#CC7700);color:white;padding:11px 14px;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,.4);display:flex;align-items:center;gap:10px;">
        <span style="font-size:20px;flex-shrink:0;"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg></span>
        <div style="flex:1;font-size:12px;font-weight:700;line-height:1.4;">${daysSince < 999?'Last backup <b>'+daysSince+' day'+(daysSince!==1?'s':'')+' ago</b>.':'<b>No backup taken yet today.</b>'} Back up now.</div>
        <button onclick="doScheduledBackup()" style="padding:7px 12px;background:white;color:#FF9500;border:none;border-radius:8px;font-family:'Plus Jakarta Sans',sans-serif;font-size:11px;font-weight:800;cursor:pointer;flex-shrink:0;">Backup Now</button>
        <button onclick="dismissBackupReminder()" style="padding:7px 10px;background:rgba(255,255,255,.15);color:white;border:none;border-radius:8px;font-size:11px;cursor:pointer;flex-shrink:0;">Later</button>
      </div>`;
      document.body.appendChild(banner);
      addLog('warn','Backup reminder shown. Last: '+(lastBackupStr?new Date(lastBackupStr).toLocaleDateString('en-GB'):'never'));
    }, 2000);
  }catch(e){ addLog('warn','Backup check: '+e.message); }
}

function dismissBackupReminder(){
  const el = document.getElementById('backup-reminder');
  if(el) el.remove();
  lsSet('backupDismissedDate', new Date().toLocaleDateString('en-GB'));
}

async function doScheduledBackup(){
  const el = document.getElementById('backup-reminder');
  if(el) el.remove();
  await exportFullDB();
  setAdminSt('✓ Database backed up successfully.','ok');
}



async function loadSecretCode(){
  try{const d=await dbFB.collection('settings').doc('auth').get();if(d.exists&&d.data().secretCode)document.getElementById('code-display').value=d.data().secretCode;}
  catch(e){addLog('warn','Load code: '+e.message);}
}
async function saveCode(){
  const code=document.getElementById('new-code').value.trim();
  if(!code||code.length<4){setAdminSt('Enter a code of at least 4 characters.','err');return;}
  try{
    await dbFB.collection('settings').doc('auth').set({secretCode:code},{merge:true});
    document.getElementById('code-display').value=code;
    document.getElementById('new-code').value='';
    setAdminSt('✓ Secret code saved! Share it with your lecturers via WhatsApp.','ok');
    addLog('ok','Secret code updated');
  }catch(e){setAdminSt('Save failed: '+e.message,'err');}
}
function copyCode(){
  const code=document.getElementById('code-display').value;
  if(!code){setAdminSt('No code set yet.','warn');return;}
  navigator.clipboard.writeText(code).then(()=>setAdminSt('✓ Code copied! Share via WhatsApp.','ok')).catch(()=>{
    const t=document.createElement('textarea');t.value=code;document.body.appendChild(t);t.select();document.execCommand('copy');document.body.removeChild(t);
    setAdminSt('✓ Code copied!','ok');
  });
}
async function renderPendingLecturers(){
  const el = document.getElementById('pending-list');
  const badge = document.getElementById('pending-badge');
  if(!el) return;
  if(currentUserRole !== 'admin'){
    el.innerHTML = '<div style="font-size:12px;color:var(--txt3);text-align:center;padding:12px;">HOD access required</div>';
    return;
  }

  // Strategy: try 3 approaches in order
  // 1. Query users where role==pending (works if admin rule is updated)
  // 2. Read from pending_registrations collection (new fallback collection)
  // 3. Show rule fix instructions

  const buildCard = (uid, u) => {
    const regDate = u.registeredAt ? new Date(u.registeredAt).toLocaleDateString('en-GB') : '—';
    const courseCount = (u.assignedCourses||[]).length;
    return `<div style="background:#fff;border:1.5px solid var(--amber-b);border-radius:var(--rs);padding:11px 13px;margin-bottom:8px;">
      <div style="font-size:13px;font-weight:800;color:var(--txt);margin-bottom:2px;">${esc(u.name||'Unknown')}</div>
      <div style="font-size:11px;color:var(--txt3);margin-bottom:8px;">${esc(u.email||'')} · Registered ${regDate} · ${courseCount} course(s) selected</div>
      <div style="display:flex;gap:8px;">
        <button onclick="approveLecturer('${uid}','${(u.name||'').replace(/'/g,'&#39;')}')" style="flex:1;padding:8px;background:linear-gradient(135deg,var(--green),#008F4E);color:white;border:none;border-radius:7px;font-family:'Plus Jakarta Sans',sans-serif;font-size:12px;font-weight:700;cursor:pointer;">✓ Approve</button>
        <button onclick="rejectLecturer('${uid}','${(u.name||'').replace(/'/g,'&#39;')}')" style="flex:1;padding:8px;background:var(--red-l);color:var(--red);border:1.5px solid var(--red-b);border-radius:7px;font-family:'Plus Jakarta Sans',sans-serif;font-size:12px;font-weight:700;cursor:pointer;">✕ Reject</button>
      </div>
    </div>`;
  };

  // Approach 1: direct where() query — works if Firestore rule allows admin to read all users
  try{
    const snap = await dbFB.collection('users').where('role','==','pending').get();
    badge.textContent = snap.size;
    if(snap.empty){
      el.innerHTML='<div style="font-size:12px;color:var(--green);text-align:center;padding:12px;font-weight:700;">✓ No pending approvals</div>';
      return;
    }
    el.innerHTML = snap.docs.map(d=>buildCard(d.id, d.data())).join('');
    return;
  }catch(e){ /* fall through to next approach */ }

  // Approach 2: read from pending_registrations collection (admin-readable, no restriction)
  try{
    const snap = await dbFB.collection('pending_registrations').get();
    badge.textContent = snap.size;
    if(snap.empty){
      el.innerHTML='<div style="font-size:12px;color:var(--green);text-align:center;padding:12px;font-weight:700;">✓ No pending approvals</div>';
      return;
    }
    el.innerHTML = snap.docs.map(d=>buildCard(d.id, d.data())).join('');
    return;
  }catch(e2){ /* fall through to instruction */ }

  // Approach 3: Show exact Firestore rule fix
  badge.textContent = '?';
  el.innerHTML=`<div style="font-size:12px;color:var(--amber);padding:10px;line-height:1.8;background:var(--amber-l);border:1px solid var(--amber-b);border-radius:8px;">
    ⚠ <b>One-time Firestore rule fix needed.</b><br>
    In Firebase Console → Firestore → Rules, change the <b>users</b> match to:<br>
    <code style="display:block;background:#0f172a;color:#00D68F;padding:8px;border-radius:6px;margin-top:6px;font-size:10px;line-height:1.6;white-space:pre-wrap;">match /users/{uid} {
  allow read: if request.auth != null && (
    request.auth.uid == uid ||
    get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin'
  );
  allow write: if request.auth != null &&
    get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
  allow create: if request.auth != null;
}</code>
    After publishing those rules, tap <b>↻ Refresh</b> to load approvals.
  </div>`;
  addLog('warn','Pending lecturers: Firestore rules need update for admin to read all users');
}

async function approveLecturer(uid, name){
  if(!confirm('Approve "'+name+'" as a lecturer? They will be able to log in immediately.'))return;
  try{
    await dbFB.collection('users').doc(uid).update({ role:'lecturer', approvedBy:currentUserName, approvedAt:new Date().toISOString() });
    // Remove from pending_registrations
    try{ await dbFB.collection('pending_registrations').doc(uid).delete(); }catch(e){}
    await dbFB.collection('audit_log').add({
      type:'lecturer_approved', uid, name, approvedBy:currentUserName, timestamp:new Date().toISOString()
    });
    addLog('ok','Lecturer approved: '+name);
    setAdminSt('✓ '+name+' approved — they can now log in.','ok');
    renderPendingLecturers();
    renderLecturerList();
  }catch(e){alert('Error: '+e.message);}
}

async function rejectLecturer(uid, name){
  if(!confirm('Reject and delete "'+name+'"\'s account? They will need to register again.'))return;
  try{
    await dbFB.collection('users').doc(uid).delete();
    try{ await dbFB.collection('pending_registrations').doc(uid).delete(); }catch(e){}
    await dbFB.collection('audit_log').add({
      type:'lecturer_rejected', uid, name, rejectedBy:currentUserName, timestamp:new Date().toISOString()
    });
    addLog('warn','Lecturer rejected & deleted: '+name);
    setAdminSt('Account for "'+name+'" rejected and removed.','warn');
    renderPendingLecturers();
  }catch(e){alert('Error: '+e.message);}
}

async function renderLecturerList(){
  if(currentUserRole !== 'admin') return;
  const el=document.getElementById('lec-list');
  const buildRow = (d) => {
    const u=d.data(); const uid=d.id;
    const courseCount=(u.assignedCourses||[]).length;
    const courses = (u.assignedCourses||[]).slice(0,3).map(k=>{
      const p=k.split('_'); return p[0]+(p[1]?' '+p[1]:'');
    }).join(', ') + (courseCount>3?' +more':'');
    return `<div class="ei" onclick="manageLecturerCourses('${uid}','${(u.name||'').replace(/'/g,'&#39;')}')" style="cursor:pointer;" title="Click to manage courses">
      <div class="ein" style="background:linear-gradient(135deg,var(--blue),var(--navy));color:white;">L</div>
      <div class="eii" style="flex:1;">
        <div class="ein2">${esc(u.name||'')}</div>
        <div class="eim">${esc(u.email||'')}</div>
        <div style="font-size:10px;color:var(--blue);font-weight:600;margin-top:2px;">${courseCount} course${courseCount!==1?'s':''}: ${courses||'None assigned'}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0;">
        <button onclick="event.stopPropagation();manageLecturerCourses('${uid}','${(u.name||'').replace(/'/g,'&#39;')}')"
          style="padding:5px 8px;background:var(--blue-l);color:var(--blue);border:1px solid var(--blue-b);border-radius:6px;font-family:'Plus Jakarta Sans',sans-serif;font-size:10px;font-weight:700;cursor:pointer;"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Courses</button>
        <button onclick="event.stopPropagation();deleteLecturer('${uid}','${(u.name||'').replace(/'/g,'&#39;')}')"
          style="padding:5px 8px;background:var(--red-l);color:var(--red);border:1px solid var(--red-b);border-radius:6px;font-family:'Plus Jakarta Sans',sans-serif;font-size:10px;font-weight:700;cursor:pointer;">✕ Remove</button>
      </div>
    </div>`;
  };
  try{
    const snap=await dbFB.collection('users').where('role','==','lecturer').get();
    if(snap.empty){el.innerHTML='<div style="font-size:12px;color:var(--txt3);text-align:center;padding:12px">No lecturer accounts yet</div>';return;}
    el.innerHTML=snap.docs.map(buildRow).join('');
  }catch(e){
    try{
      const allSnap=await dbFB.collection('users').get();
      const lecturers=allSnap.docs.filter(d=>d.data().role==='lecturer');
      if(!lecturers.length){el.innerHTML='<div style="font-size:12px;color:var(--txt3);text-align:center;padding:12px">No lecturer accounts yet</div>';return;}
      el.innerHTML=lecturers.map(buildRow).join('');
    }catch(e2){
      el.innerHTML='<div style="font-size:12px;color:var(--red);padding:10px;">⚠ Permission error loading lecturers. Please update your Firestore rules.</div>';
      addLog('err','Load lecturers: '+e2.message);
    }
  }
}

// ── HOD: MANAGE LECTURER COURSES ─────────────────────────────────
let _manageLecturerUID = '';
let _manageLecturerName = '';
let _manageLecturerCurrentCourses = [];

async function manageLecturerCourses(uid, name) {
  _manageLecturerUID = uid;
  _manageLecturerName = name;
  // Fetch current courses for this lecturer
  try {
    const doc = await dbFB.collection('users').doc(uid).get();
    _manageLecturerCurrentCourses = doc.exists ? (doc.data().assignedCourses || []) : [];
  } catch(e) { _manageLecturerCurrentCourses = []; }

  // Build course picker modal content
  const semNum = getSemester().includes('1st') ? 1 : 2;
  const relevantCourses = COURSES.filter(c => c.sem === semNum);

  let html = `<div style="font-size:13px;font-weight:800;color:var(--navy);margin-bottom:4px;">Manage Courses: ${esc(name)}</div>
  <div style="font-size:11px;color:var(--txt3);margin-bottom:12px;">Tick the courses this lecturer is assigned to teach this semester.</div>
  <div style="max-height:260px;overflow-y:auto;border:1.5px solid var(--border);border-radius:9px;padding:8px;background:var(--bg);">`;

  const grouped = {};
  relevantCourses.forEach(c => {
    const key = c.level + (c.option ? ' — ' + c.option : '');
    if(!grouped[key]) grouped[key] = [];
    grouped[key].push(c);
  });

  Object.entries(grouped).forEach(([grp, courses]) => {
    html += `<div style="font-size:10px;font-weight:800;text-transform:uppercase;color:var(--txt3);letter-spacing:.5px;padding:6px 6px 3px;">${esc(grp)}</div>`;
    courses.forEach(c => {
      const key = c.code + '_' + c.level + '_' + (c.option || '');
      const checked = _manageLecturerCurrentCourses.includes(key) ? 'checked' : '';
      html += `<label style="display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:7px;cursor:pointer;transition:background .15s;font-size:12px;" 
        onmouseover="this.style.background='var(--blue-l)'" onmouseout="this.style.background=''">
        <input type="checkbox" value="${key}" ${checked} style="width:15px;height:15px;cursor:pointer;accent-color:var(--blue);">
        <span><b>${esc(c.code)}</b> — ${esc(c.title)}</span>
      </label>`;
    });
  });
  html += `</div>
  <div style="display:flex;gap:8px;margin-top:12px;">
    <button onclick="saveLecturerCourses()" style="flex:1;padding:11px;background:linear-gradient(135deg,var(--green),#008F4E);color:white;border:none;border-radius:9px;font-family:'Plus Jakarta Sans',sans-serif;font-size:13px;font-weight:700;cursor:pointer;">Save Courses</button>
    <button onclick="closeM('mlec-courses')" style="padding:11px 16px;background:var(--bg);color:var(--txt2);border:1.5px solid var(--border2);border-radius:9px;font-family:'Plus Jakarta Sans',sans-serif;font-size:13px;font-weight:700;cursor:pointer;">Cancel</button>
  </div>`;

  let modal = document.getElementById('mlec-courses');
  if(!modal) {
    modal = document.createElement('div');
    modal.id = 'mlec-courses';
    modal.className = 'mbg';
    modal.innerHTML = '<div class="mbox" id="mlec-courses-body"></div>';
    document.body.appendChild(modal);
  }
  document.getElementById('mlec-courses-body').innerHTML = html;
  openM('mlec-courses');
}

async function saveLecturerCourses() {
  const checkboxes = document.querySelectorAll('#mlec-courses-body input[type=checkbox]');
  const selected = [];
  checkboxes.forEach(cb => { if(cb.checked) selected.push(cb.value); });
  try {
    await dbFB.collection('users').doc(_manageLecturerUID).update({ assignedCourses: selected });
    closeM('mlec-courses');
    setAdminSt('✓ Courses updated for '+_manageLecturerName+' ('+selected.length+' course'+( selected.length!==1?'s':'')+' assigned)','ok');
    addLog('ok','HOD updated courses for '+_manageLecturerName+': '+selected.length+' courses');
    renderLecturerList();
  } catch(e) {
    alert('Save failed: '+e.message);
  }
}

async function deleteLecturer(uid, name) {
  if(currentUserRole!=='admin'){alert('Only the HOD can delete lecturers.');return;}
  if(!confirm('Remove lecturer "'+name+'" from the system?\nThey will need to re-register to access the system again.'))return;
  try{
    await dbFB.collection('users').doc(uid).delete();
    setAdminSt('✓ Lecturer "'+name+'" removed. They can re-register with the department code.','ok');
    addLog('warn','Lecturer deleted: '+name+' ('+uid+')');
    renderLecturerList();
  }catch(e){setAdminSt('Error: '+e.message,'err');addLog('err','Delete lecturer: '+e.message);}
}
function setAdminSt(m,t=''){const b=document.getElementById('admin-st');b.textContent=m;b.className='st '+t;}

// ── LIST & STATS ──────────────────────────────────────────────────
let activeEnrollTab = 'all';

function setEnrollTab(level) {
  activeEnrollTab = level;
  // Update tab styles
  ['all','ND1','ND2','HND1','HND2'].forEach(k => {
    const btn = document.getElementById('etab-' + k);
    if (!btn) return;
    const isActive = (k === 'all' ? level === 'all' : level === k.replace('ND1','ND 1').replace('ND2','ND 2').replace('HND1','HND 1').replace('HND2','HND 2'));
    btn.style.background = isActive ? 'linear-gradient(135deg,var(--navy),var(--blue))' : 'var(--bg)';
    btn.style.color = isActive ? 'white' : 'var(--txt2)';
    btn.style.borderColor = isActive ? 'var(--blue)' : 'var(--border2)';
  });
  renderList();
}

function printEnrolledStudents() {
  const filtered = getFilteredEnrolled();
  if (!filtered.length) { alert('No students to print for the selected filter.'); return; }
  const levelLabel = activeEnrollTab === 'all' ? 'All Levels' : activeEnrollTab;
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB', {weekday:'long',day:'numeric',month:'long',year:'numeric'});
  // Group by level for print
  const levels = ['ND 1','ND 2','HND 1','HND 2'];
  let bodyHtml = '';
  if (activeEnrollTab === 'all') {
    levels.forEach(lvl => {
      const group = filtered.filter(u => u.level === lvl);
      if (!group.length) return;
      bodyHtml += `<tr><td colspan="5" style="background:#003DCC;color:white;font-weight:800;padding:8px 10px;font-size:12px;">${lvl} — ${group.length} student(s)</td></tr>`;
      group.forEach((u,i) => {
        bodyHtml += `<tr><td>${i+1}</td><td style="font-family:monospace">${u.matric}</td><td>${u.name}</td><td>${u.level}</td><td>${u.option||'General'}</td></tr>`;
      });
    });
  } else {
    filtered.forEach((u,i) => {
      bodyHtml += `<tr><td>${i+1}</td><td style="font-family:monospace">${u.matric}</td><td>${u.name}</td><td>${u.level}</td><td>${u.option||'General'}</td></tr>`;
    });
  }
  const html = `<html><head><title>Enrolled Students</title>${getReportStyles()}</head><body>
  ${getReportHeader('ENROLLED STUDENTS — ' + levelLabel.toUpperCase())}
  <div class="info-row">
    <div class="info-cell">Printed: <span>${dateStr}</span></div>
    <div class="info-cell">Total: <span>${filtered.length} student${filtered.length!==1?'s':''}</span></div>
  </div>
  <table>
    <thead><tr><th style="width:36px">#</th><th>Matric No.</th><th>Full Name</th><th>Level</th><th>Specialisation / Option</th></tr></thead>
    <tbody>${bodyHtml}</tbody>
  </table>
  <div class="footer">The Gateway Polytechnic, Saapade — EEE Attendance System &nbsp;|&nbsp; Printed: ${new Date().toLocaleString('en-GB')}</div>
  </body></html>`;
  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
  w.print();
  addLog('info', 'Enrolled list printed: ' + filtered.length + ' students (' + levelLabel + ')');
}

function getFilteredEnrolled() {
  const q = (document.getElementById('enroll-search') ? document.getElementById('enroll-search').value : '').toLowerCase();
  return students.filter(u => {
    const levelMatch = activeEnrollTab === 'all' || u.level === activeEnrollTab;
    const searchMatch = !q || u.name.toLowerCase().includes(q) || u.matric.toLowerCase().includes(q);
    return levelMatch && searchMatch;
  });
}

function renderList(){
  document.getElementById('ecnt').textContent=students.length;
  const el=document.getElementById('elist');
  if(!students.length){el.innerHTML='<div style="font-size:12px;color:var(--txt3);text-align:center;padding:16px">No students enrolled yet</div>';return;}
  const filtered = getFilteredEnrolled();
  if (!filtered.length) {
    el.innerHTML='<div style="font-size:12px;color:var(--txt3);text-align:center;padding:16px">No students match this filter</div>';return;
  }
  // Group by level when showing all
  let html = '';
  if (activeEnrollTab === 'all') {
    const levels = ['ND 1','ND 2','HND 1','HND 2'];
    levels.forEach(lvl => {
      const group = filtered.filter(u => u.level === lvl);
      if (!group.length) return;
      html += `<div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:var(--blue);background:var(--blue-l);padding:5px 12px;border-radius:7px;margin-bottom:5px;border:1px solid var(--blue-b)">${esc(lvl)} — ${group.length} student(s)</div>`;
      html += group.map((u,i) => `
        <div class="ei">
          <div class="ein">${i+1}</div>
          <div class="eii"><div class="ein2">${esc(u.name)}</div><div class="eim">${esc(u.matric)} · ${esc(u.level)}${u.option?' · '+esc(u.option):''}</div></div>
          ${currentUserRole==='admin'?`<div style="display:flex;gap:5px"><button style="background:var(--blue-l);color:var(--blue);border:none;border-radius:7px;padding:5px 8px;font-size:11px;cursor:pointer;font-weight:800" onclick="editStudent('${esc(u.matric)}')">✏</button><button class="edel" onclick="deleteStudent('${esc(u.matric)}')">✕</button></div>`:''}
        </div>`).join('');
    });
  } else {
    html = filtered.map((u,i) => `
      <div class="ei">
        ${u.photo ? `<img src="${u.photo}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;border:2px solid var(--border2);flex-shrink:0;" onerror="this.style.display='none'">` : `<div class="ein">${i+1}</div>`}
        <div class="eii"><div class="ein2">${u.name}</div><div class="eim">${u.matric} · ${u.level}${u.option?' · '+u.option:''}</div></div>
        ${currentUserRole==='admin'?`<div style="display:flex;gap:5px"><button style="background:var(--blue-l);color:var(--blue);border:none;border-radius:7px;padding:5px 8px;font-size:11px;cursor:pointer;font-weight:800" onclick="editStudent('${u.matric}')">✏</button><button class="edel" onclick="deleteStudent('${u.matric}')">✕</button></div>`:''}
      </div>`).join('');
  }
  el.innerHTML = html;
}

async function removeBiometricData(matric){
  if(currentUserRole!=='admin'){alert('Only the HOD can remove biometric data.');return;}
  const u=students.find(s=>s.matric===matric);
  if(!u){alert('Student not found.');return;}
  if(!confirm(
    'REMOVE FACE DATA for '+u.name+' ('+matric+')?\n\n'+
    '• Their face descriptors will be permanently deleted\n'+
    '• Their ATTENDANCE RECORDS are kept intact\n'+
    '• They will no longer be recognized by the scanner\n'+
    '• They must re-enroll their face to be scanned again\n\n'+
    'This is logged in the audit trail. Continue?'
  )) return;
  try{
    // Remove only face descriptors — keep all other student data intact
    await dbFB.collection('students').doc(matric).update({
      descriptors: [],
      biometricRemovedAt: new Date().toISOString(),
      biometricRemovedBy: currentUserName
    });
    // Update in-memory
    const idx=students.findIndex(s=>s.matric===matric);
    if(idx>=0){ students[idx].descriptors=[]; }
    buildMatcher(); // rebuild face matcher without this student
    // Audit log
    await dbFB.collection('audit_log').add({
      type:'biometric_data_removed',
      matric, studentName:u.name,
      removedBy:currentUserName,
      reason:'HOD-initiated removal (NDPR compliance)',
      timestamp:new Date().toISOString()
    });
    renderAdminStudents();
    setAdminSt('✓ Face data removed for '+u.name+'. Attendance records preserved. Action logged.','ok');
    addLog('warn','BIOMETRIC REMOVED: '+u.name+' ('+matric+') by '+currentUserName);
  }catch(e){alert('Error: '+e.message);}
}

async function deleteStudent(matric){
  if(currentUserRole!=='admin'){alert('Only the HOD can delete students.');return;}
  if(!confirm('Remove '+matric+' and all their attendance records?'))return;
  try{
    await dbFB.collection('students').doc(matric).delete();
    await dbFB.collection('weekly').doc(matric).delete();
    students=students.filter(u=>u.matric!==matric);
    delete weeklyData[matric];
    buildMatcher();
    renderList();
    renderWeeklyGrid();
    renderAdminStudents();
    refreshAdminDashboard();
    document.getElementById('ecnt').textContent=students.length;
    addLog('warn','Deleted: '+matric);
  }catch(e){alert('Error: '+e.message);}
}

function editStudent(matric) {
  if(currentUserRole!=='admin'){alert('Only the HOD can edit students.');return;}
  const u = students.find(s => s.matric === matric);
  if(!u){alert('Student not found.');return;}
  // Fill the correction modal for student info editing
  const newName = prompt('Edit full name (current: '+u.name+'):', u.name);
  if (newName === null) return; // cancelled
  const newLevel = prompt('Edit level (current: '+u.level+')\nOptions: ND 1, ND 2, HND 1, HND 2', u.level);
  if (newLevel === null) return;
  const validLevels = ['ND 1','ND 2','HND 1','HND 2'];
  if (!validLevels.includes(newLevel.trim())) { alert('Invalid level. Must be: ND 1, ND 2, HND 1, or HND 2'); return; }
  const isHND = newLevel.includes('HND');
  let newOption = u.option || '';
  if (isHND) {
    newOption = prompt('Edit specialisation option (current: '+(u.option||'none')+')\nOptions: Power and Machines, Electronics and Telecommunication', u.option||'');
    if (newOption === null) return;
  }
  if (!confirm('Save changes for '+matric+'?\nName: '+newName+'\nLevel: '+newLevel+(isHND?'\nOption: '+newOption:''))) return;
  dbFB.collection('students').doc(matric).update({
    name: newName.trim(),
    level: newLevel.trim(),
    option: isHND ? newOption.trim() : '',
    programme: isHND ? newOption.trim()+' Option' : 'Electrical & Electronics Engineering Technology',
    editedBy: currentUserName,
    editedAt: new Date().toISOString()
  }).then(() => {
    // Update local
    const idx = students.findIndex(s => s.matric === matric);
    if (idx >= 0) {
      students[idx].name = newName.trim();
      students[idx].level = newLevel.trim();
      students[idx].option = isHND ? newOption.trim() : '';
    }
    renderList(); buildMatcher();
    renderAdminStudents();
    refreshAdminDashboard();
    addLog('ok','Student edited: '+matric+' → '+newName+' | '+newLevel);
    setAdminSt('✓ Student info updated for '+matric,'ok');
  }).catch(e => alert('Save failed: '+e.message));
}

async function confirmClearAll(){
  if(currentUserRole!=='admin'){alert('Only the HOD can clear all data.');return;}
  if(!confirm('Delete ALL students and attendance data permanently?'))return;
  if(!confirm('FINAL WARNING — This cannot be undone. Continue?'))return;
  for(const u of students){
    await dbFB.collection('students').doc(u.matric).delete().catch(()=>{});
    await dbFB.collection('weekly').doc(u.matric).delete().catch(()=>{});
  }
  students=[];weeklyData={};buildMatcher();renderList();renderWeeklyGrid();
  renderAdminStudents();
  refreshAdminDashboard();
  document.getElementById('ecnt').textContent=0;
  addLog('warn','All data cleared');
}

// ── TABS ──────────────────────────────────────────────────────────
function goTab(t){
  ['scan','weekly','enroll','admin','logs'].forEach(id=>{
    document.getElementById('nt-'+id).classList.toggle('active',id===t);
    document.getElementById('p-'+id).classList.toggle('active',id===t);
  });
  // FIX 16: Load face descriptors lazily — only when scan or enroll tab opens
  if(t==='scan'||t==='enroll'){
    loadDescriptorsIfNeeded().then(()=>{
      if(t==='enroll') syncEnrollCam();
    });
  }
  if(t==='weekly'){loadWeeklyData().then(()=>renderWeeklyGrid());}
  if(t==='admin'){refreshAdminDashboard();}
}

// ── HELPERS ───────────────────────────────────────────────────────
function setS(m,t=''){const b=document.getElementById('sbox');b.textContent=m;b.className='st '+t;}
function setER(m,t=''){const b=document.getElementById('ereg');b.textContent=m;b.className='st '+t;}
function addLog(type,msg){
  const a=document.getElementById('logarea'),t=new Date().toTimeString().slice(0,8);
  const d=document.createElement('div');
  const cls={ok:'lok',err:'lerr2',info:'linf',warn:'lwrn'}[type]||'linf';
  d.className='lr '+cls;
  d.innerHTML='<span class="lt">['+t+']</span><span class="lm">'+msg+'</span>';a.prepend(d);
}
function openM(id){const el=document.getElementById(id);el.style.display='flex';el.classList.add('open');}
function closeM(id){const el=document.getElementById(id);el.style.display='none';el.classList.remove('open');}

// ═══════════════════════════════════════════════════════════════════
// LECTURER COURSE ASSIGNMENT — registration course picker
// ═══════════════════════════════════════════════════════════════════
let regSelectedCourses = new Set();

function renderRegCoursePicker() {
  const el = document.getElementById('reg-course-picker');
  if (!el) return;
  // Get current semester
  const sem = getSemester().includes('1st') ? 1 : 2;
  // Deduplicate courses by code+level+option
  const seen = new Set();
  const unique = COURSES.filter(c => {
    const k = c.code + c.level + (c.option || '');
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
  el.innerHTML = unique.map(c => `
    <div onclick="toggleRegCourse('${c.code}_${c.level}_${c.option||''}')"
      style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;cursor:pointer;transition:background .15s;background:${regSelectedCourses.has(c.code+'_'+c.level+'_'+(c.option||''))?'#e8f0fe':'transparent'}">
      <div style="width:18px;height:18px;border-radius:4px;border:2px solid ${regSelectedCourses.has(c.code+'_'+c.level+'_'+(c.option||''))?'#0057FF':'#cbd5e1'};background:${regSelectedCourses.has(c.code+'_'+c.level+'_'+(c.option||''))?'#0057FF':'transparent'};display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:11px;color:white;">${regSelectedCourses.has(c.code+'_'+c.level+'_'+(c.option||''))?'✓':''}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:12px;font-weight:700;color:#0f172a;">${c.code} — ${c.title}</div>
        <div style="font-size:10px;color:#94a3b8;">${c.level} · ${c.option||'General'} · Sem ${c.sem}</div>
      </div>
    </div>`).join('');
}

function toggleRegCourse(key) {
  if (regSelectedCourses.has(key)) regSelectedCourses.delete(key);
  else regSelectedCourses.add(key);
  renderRegCoursePicker();
  document.getElementById('reg-course-count').textContent = regSelectedCourses.size + ' course' + (regSelectedCourses.size !== 1 ? 's' : '') + ' selected';
}

// ═══════════════════════════════════════════════════════════════════
// STUDENT MASTER LIST — HOD uploads official student list
// ═══════════════════════════════════════════════════════════════════
let masterList = []; // { matric, name, level, option }

async function loadMasterList() {
  try {
    const snap = await dbFB.collection('masterlist').get();
    masterList = snap.docs.map(d => d.data());
    renderMasterList();
    document.getElementById('master-list-count').textContent = masterList.length;
    document.getElementById('master-count-badge').textContent = masterList.length + ' students';
  } catch(e) { addLog('err', 'Load master list: ' + e.message); }
}

async function addToMasterList() {
  const matric = document.getElementById('ml-matric').value.trim();
  const name = document.getElementById('ml-name').value.trim();
  const level = document.getElementById('ml-level').value;
  const option = document.getElementById('ml-option').value;
  const isHND = level === 'HND 1' || level === 'HND 2';
  if (!matric || !name || !level) { setMasterSt('Fill in matric, name and level.', 'err'); return; }
  if (isHND && !option) { setMasterSt('HND students need a specialisation option.', 'err'); return; }
  if (masterList.find(s => s.matric.toLowerCase() === matric.toLowerCase())) {
    setMasterSt('"' + matric + '" already in master list.', 'err'); return;
  }
  const entry = { matric, name, level, option: isHND ? option : '' };
  try {
    await dbFB.collection('masterlist').doc(matric).set(entry);
    masterList.push(entry);
    renderMasterList();
    document.getElementById('ml-matric').value = '';
    document.getElementById('ml-name').value = '';
    document.getElementById('ml-level').value = '';
    document.getElementById('ml-option').value = '';
    document.getElementById('ml-option').style.display = 'none';
    document.getElementById('master-list-count').textContent = masterList.length;
    document.getElementById('master-count-badge').textContent = masterList.length + ' students';
    setMasterSt('✓ ' + name + ' added to master list.', 'ok');
    addLog('ok', 'Master list: added ' + matric + ' — ' + name);
  } catch(e) { setMasterSt('Save failed: ' + e.message, 'err'); }
}

function updateMlOption() {
  const level = document.getElementById('ml-level').value;
  const isHND = level === 'HND 1' || level === 'HND 2';
  document.getElementById('ml-option').style.display = isHND ? 'block' : 'none';
}

let activeMasterTab = 'all';

function setMasterTab(tab) {
  activeMasterTab = tab;
  const tabIds = {
    'all':'all','ND 1':'ND1','ND 2':'ND2',
    'HND 1|Power':'HND1P','HND 1|Elec':'HND1E',
    'HND 2|Power':'HND2P','HND 2|Elec':'HND2E'
  };
  Object.entries(tabIds).forEach(([key, id]) => {
    const btn = document.getElementById('mtab-' + id);
    if (!btn) return;
    btn.classList.toggle('mtab-active', key === tab);
  });
  renderMasterList();
}

function renderMasterList() {
  const el = document.getElementById('master-list-body');
  if (!el) return;
  const q = (document.getElementById('master-filter') ? document.getElementById('master-filter').value : '').toLowerCase();

  // Determine level + option filter from active tab
  let lvlFilter = '', optFilter = null;
  if (activeMasterTab !== 'all') {
    const parts = activeMasterTab.split('|');
    lvlFilter = parts[0];
    if (parts[1] === 'Power') optFilter = 'Power and Machines';
    else if (parts[1] === 'Elec') optFilter = 'Electronics and Telecommunication';
  }

  const filtered = masterList.filter(s => {
    const levelMatch = !lvlFilter || s.level === lvlFilter;
    const optMatch = optFilter === null || (s.option || '') === optFilter;
    const searchMatch = !q || s.matric.toLowerCase().includes(q) || s.name.toLowerCase().includes(q) || s.level.toLowerCase().includes(q);
    return levelMatch && optMatch && searchMatch;
  });

  // Sort: by level order then name
  const levelOrder = ['ND 1','ND 2','HND 1','HND 2'];
  filtered.sort((a,b) => {
    const li = levelOrder.indexOf(a.level) - levelOrder.indexOf(b.level);
    if (li !== 0) return li;
    return a.name.localeCompare(b.name);
  });

  document.getElementById('master-list-count').textContent = masterList.length;

  if (!filtered.length) {
    el.innerHTML = '<div style="font-size:12px;color:var(--txt3);text-align:center;padding:16px">' +
      (masterList.length ? 'No results for this filter' : 'No students in master list yet') + '</div>';
    return;
  }

  // Level colour map
  const lvlColors = {'ND 1':'var(--blue)','ND 2':'var(--green)','HND 1':'var(--purple)','HND 2':'var(--amber)'};
  const lvlBgs    = {'ND 1':'var(--blue-l)','ND 2':'var(--green-l)','HND 1':'var(--purple-l)','HND 2':'var(--amber-l)'};

  // When showing all, group by level then option
  let html = '';
  if (activeMasterTab === 'all') {
    levelOrder.forEach(lvl => {
      const grp = filtered.filter(s => s.level === lvl);
      if (!grp.length) return;
      const col = lvlColors[lvl]||'var(--navy)';
      const bg  = lvlBgs[lvl]||'var(--blue-l)';
      html += `<div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.8px;color:${col};background:${bg};border-radius:6px;padding:5px 10px;margin-bottom:5px;margin-top:8px;">${lvl} — ${grp.length} student${grp.length!==1?'s':''}</div>`;
      html += grp.map((s,i) => buildMasterRow(s, i, col, bg)).join('');
    });
  } else {
    const col = lvlColors[lvlFilter]||'var(--blue)';
    const bg  = lvlBgs[lvlFilter]||'var(--blue-l)';
    html = filtered.map((s,i) => buildMasterRow(s, i, col, bg)).join('');
  }
  el.innerHTML = html;
}

function buildMasterRow(s, i, col, bg) {
  return `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:white;border:1.5px solid var(--border);border-radius:var(--rs);margin-bottom:5px;">
      <div style="font-size:10px;font-weight:800;color:${col};background:${bg};padding:2px 7px;border-radius:5px;flex-shrink:0;">${s.level}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:12px;font-weight:700;color:var(--txt)">${s.name}</div>
        <div style="font-size:10px;color:var(--txt3);font-family:'JetBrains Mono';">${s.matric}${s.option?' · '+s.option:''}</div>
      </div>
      <button onclick="removeMasterEntry('${s.matric}')" style="background:var(--red-l);color:var(--red);border:none;border-radius:6px;padding:4px 9px;font-size:11px;cursor:pointer;font-weight:800;">✕</button>
    </div>`;
}

function filterMasterList() { renderMasterList(); }

async function removeMasterEntry(matric) {
  if (!confirm('Remove ' + matric + ' from master list?')) return;
  try {
    await dbFB.collection('masterlist').doc(matric).delete();
    masterList = masterList.filter(s => s.matric !== matric);
    renderMasterList();
    document.getElementById('master-count-badge').textContent = masterList.length + ' students';
    addLog('warn', 'Master list: removed ' + matric);
  } catch(e) { alert('Error: ' + e.message); }
}

async function clearMasterList() {
  if(currentUserRole!=='admin'){alert('Only the HOD can clear the master list.');return;}
  const count = masterList.length;
  if(!count){alert('Master list is already empty.');return;}
  // FIX 11: Require typing DELETE to prevent accidental wipe
  const typed = prompt(
    'DANGER: This will permanently delete ALL '+count+' students from the master list.\n\n'+
    'Students will no longer be able to self-enroll.\n'+
    'This CANNOT be undone.\n\n'+
    'Type  DELETE  (all caps) to confirm:'
  );
  if(typed === null) return; // cancelled
  if(typed.trim() !== 'DELETE'){
    alert('Cancelled — you must type DELETE exactly to confirm this action.');
    return;
  }
  try {
    const snap = await dbFB.collection('masterlist').get();
    const batch = dbFB.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    masterList = [];
    renderMasterList();
    document.getElementById('master-count-badge').textContent = '0 students';
    document.getElementById('master-list-count').textContent = '0';
    // Log to audit trail
    await dbFB.collection('audit_log').add({
      type:'master_list_cleared', count, clearedBy:currentUserName,
      timestamp:new Date().toISOString()
    });
    setAdminSt('Master list cleared ('+count+' students removed). This action has been logged.','warn');
    addLog('warn','MASTER LIST CLEARED: '+count+' students deleted by '+currentUserName);
  } catch(e) { alert('Error: ' + e.message); }
}

async function importMasterCSV(input) {
  const file = input.files[0];
  if (!file) return;
  setMasterSt('Reading CSV...', 'info');
  const text = await file.text();
  const lines = text.split('\n').filter(l => l.trim());
  if (!lines.length) { setMasterSt('CSV file is empty.', 'err'); return; }

  // ── SMART HEADER DETECTION ────────────────────────────────────────
  // Detect column positions from the header row regardless of order.
  // Supports: matric first OR name first, any case, with/without spaces.
  const headerLine = lines[0].toLowerCase();
  const headerParts = headerLine.split(',').map(h => h.trim().replace(/^"|"$/g, ''));

  // Find which column index holds what
  let iMatric = -1, iName = -1, iLevel = -1, iOption = -1;
  headerParts.forEach((h, i) => {
    if (h.includes('matric') || h.includes('number') || h.includes('reg')) iMatric = i;
    else if (h.includes('name') || h.includes('student')) iName = i;
    else if (h.includes('level') || h.includes('class') || h.includes('year')) iLevel = i;
    else if (h.includes('option') || h.includes('specialisation') || h.includes('programme')) iOption = i;
  });

  // If we found a proper header row with at least matric + name
  const hasHeader = iMatric >= 0 && iName >= 0;
  const startIdx = hasHeader ? 1 : 0;

  // If no header detected, fall back to fixed order: matric, name, level, option
  if (!hasHeader) {
    iMatric = 0; iName = 1; iLevel = 2; iOption = 3;
    addLog('warn', 'CSV: No header detected — using default column order (matric, name, level, option)');
  } else {
    // Fill in level/option defaults if not found in header
    if (iLevel < 0) iLevel = 2;
    if (iOption < 0) iOption = 3;
    addLog('info', `CSV columns detected — matric:${iMatric} name:${iName} level:${iLevel} option:${iOption}`);
  }
  // ── END HEADER DETECTION ─────────────────────────────────────────

  let added = 0, skipped = 0, errors = [];
  const batch = dbFB.batch();

  for (let i = startIdx; i < lines.length; i++) {
    // Handle commas inside quoted fields
    const raw = lines[i];
    const parts = raw.match(/(".*?"|[^,]+)(?=,|$)/g)
      ? raw.match(/(".*?"|[^,]+)(?=,|$)/g).map(p => p.trim().replace(/^"|"$/g, ''))
      : raw.split(',').map(p => p.trim().replace(/^"|"$/g, ''));

    const matric = (parts[iMatric] || '').trim();
    const name   = (parts[iName]   || '').trim();
    const level  = (parts[iLevel]  || '').trim();
    const option = (parts[iOption] || '').trim();

    if (!matric || !name || !level) {
      errors.push('Row ' + (i + 1) + ': missing matric/name/level — skipped');
      continue;
    }
    // Validate matric looks like a number (basic sanity check)
    if (!/^\d{6,15}$/.test(matric)) {
      errors.push('Row ' + (i + 1) + ': "' + matric + '" does not look like a matric number — skipped');
      continue;
    }
    if (masterList.find(s => s.matric.toLowerCase() === matric.toLowerCase())) {
      skipped++; continue;
    }

    // Normalise option field — map full text to system values
    let normOption = option;
    if (option.toLowerCase().includes('power')) normOption = 'Power and Machines';
    else if (option.toLowerCase().includes('electron') || option.toLowerCase().includes('telecom')) normOption = 'Electronics and Telecommunication';
    else if (option.toLowerCase().includes('electrical') || option.toLowerCase().includes('general')) normOption = '';

    const entry = { matric, name, level, option: normOption };
    batch.set(dbFB.collection('masterlist').doc(matric), entry);
    masterList.push(entry);
    added++;
  }

  if (errors.length && added === 0) {
    setMasterSt('Import failed — ' + errors.length + ' errors. First: ' + errors[0], 'err');
    addLog('err', 'CSV import failed: ' + errors.join(' | '));
    input.value = ''; return;
  }

  try {
    if (added > 0) await batch.commit();
    // Reload from Firestore to confirm all data is saved and in sync
    await loadMasterList();
    let msg = `✓ Imported ${added} student(s). ${skipped} already existed.`;
    if (errors.length) msg += ` ⚠ ${errors.length} row(s) skipped.`;
    msg += ` Master list now has ${masterList.length} total.`;
    setMasterSt(msg, 'ok');
    addLog('ok', 'CSV import: ' + added + ' added, ' + skipped + ' skipped, ' + errors.length + ' errors');
    if (errors.length) addLog('warn', 'Skipped rows: ' + errors.slice(0,5).join(' | '));
  } catch(e) { setMasterSt('Save failed: ' + e.message, 'err'); }
  input.value = '';
}

function downloadMasterTemplate() {
  const csv = 'matric,name,level,option\n22010611001,Adebola David,ND 1,\n22010611002,Fatima Bello,ND 1,\n22013731001,Chidi Eze,HND 1,Power and Machines\n22013631001,Ngozi Adeyemi,HND 1,Electronics and Telecommunication\n';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], {type: 'text/csv'}));
  a.download = 'GAPOSA_EEE_Student_Master_List_Template.csv';
  a.click();
  addLog('info', 'Master list template downloaded');
}

function setMasterSt(m, t='') {
  const b = document.getElementById('master-st');
  if (b) { b.textContent = m; b.className = 'st ' + t; }
}

function openPrintMasterModal() {
  if (!masterList.length) { alert('No students in master list yet.'); return; }
  openM('mprint-master');
}

function executePrintMasterList() {
  const sel = document.getElementById('print-master-select').value;
  closeM('mprint-master');
  printMasterList(sel);
}

function printMasterList(filter) {
  if (!masterList.length) { alert('No students in master list yet.'); return; }
  filter = filter || 'all';
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB', {weekday:'long', day:'numeric', month:'long', year:'numeric'});
  const levelOrder = ['ND 1','ND 2','HND 1','HND 2'];

  // Determine what to print
  let toPrint = [];
  let subtitle = 'MASTER STUDENT LIST';

  if (filter === 'all') {
    toPrint = [...masterList];
    subtitle = 'MASTER STUDENT LIST — ALL LEVELS';
  } else if (filter.includes('|')) {
    const [lvl, opt] = filter.split('|');
    toPrint = masterList.filter(s => s.level === lvl && (s.option||'') === opt);
    subtitle = `MASTER STUDENT LIST — ${lvl.toUpperCase()} (${opt.toUpperCase()})`;
  } else {
    toPrint = masterList.filter(s => s.level === filter);
    subtitle = `MASTER STUDENT LIST — ${filter.toUpperCase()}`;
  }

  if (!toPrint.length) { alert('No students found for the selected filter.'); return; }

  // Sort: level order then name
  toPrint.sort((a,b) => {
    const li = levelOrder.indexOf(a.level) - levelOrder.indexOf(b.level);
    if (li !== 0) return li;
    if (a.option && b.option && a.option !== b.option) return a.option.localeCompare(b.option);
    return a.name.localeCompare(b.name);
  });

  // Build rows — grouped by level when printing all
  let bodyHtml = '';
  if (filter === 'all') {
    levelOrder.forEach(lvl => {
      // Sub-group HND by option
      const lvlStudents = toPrint.filter(s => s.level === lvl);
      if (!lvlStudents.length) return;
      if (lvl.startsWith('HND')) {
        const opts = ['Power and Machines','Electronics and Telecommunication'];
        opts.forEach(opt => {
          const grp = lvlStudents.filter(s => (s.option||'') === opt);
          if (!grp.length) return;
          bodyHtml += `<tr class="section-hdr"><td colspan="4">${lvl} — ${opt} &nbsp;&nbsp; (${grp.length} student${grp.length!==1?'s':''})</td></tr>`;
          grp.forEach((s,i) => {
            bodyHtml += `<tr><td style="text-align:center;width:36px">${i+1}</td><td>${esc(s.matric)}</td><td>${esc(s.name)}</td><td>${esc(s.level)}</td></tr>`;
          });
        });
        // Any HND students without a recognised option
        const other = lvlStudents.filter(s => !['Power and Machines','Electronics and Telecommunication'].includes(s.option||''));
        if (other.length) {
          bodyHtml += `<tr class="section-hdr"><td colspan="4">${lvl} — Unspecified Option (${other.length})</td></tr>`;
          other.forEach((s,i) => {
            bodyHtml += `<tr><td style="text-align:center;width:36px">${i+1}</td><td>${esc(s.matric)}</td><td>${esc(s.name)}</td><td>${esc(s.level)}</td></tr>`;
          });
        }
      } else {
        bodyHtml += `<tr class="section-hdr"><td colspan="4">${lvl} — General &nbsp;&nbsp; (${lvlStudents.length} student${lvlStudents.length!==1?'s':''})</td></tr>`;
        lvlStudents.forEach((s,i) => {
          bodyHtml += `<tr><td style="text-align:center;width:36px">${i+1}</td><td>${esc(s.matric)}</td><td>${esc(s.name)}</td><td>${esc(s.level)}</td></tr>`;
        });
      }
    });
  } else {
    // Single level/option — no section headers needed, just number rows sequentially
    toPrint.forEach((s,i) => {
      bodyHtml += `<tr><td style="text-align:center;width:36px">${i+1}</td><td>${esc(s.matric)}</td><td>${esc(s.name)}</td><td>${esc(s.level)}${s.option?' · '+esc(s.option):''}</td></tr>`;
    });
  }

  const html = `<html><head><title>Master Student List</title>${getReportStyles()}</head><body>
  ${getReportHeader(subtitle)}
  <div class="info-row">
    <div class="info-cell">Printed: <span>${dateStr}</span></div>
    <div class="info-cell">Total Students: <span>${toPrint.length}</span></div>
    <div class="info-cell">Session: <span>${getAcademicSession()}</span></div>
  </div>
  <table>
    <thead>
      <tr>
        <th style="width:36px;text-align:center">#</th>
        <th>Matric No.</th>
        <th>Full Name</th>
        <th>Level / Option</th>
      </tr>
    </thead>
    <tbody>${bodyHtml}</tbody>
  </table>
  <div class="footer">
    The Gateway Polytechnic, Saapade &nbsp;·&nbsp; EEE Attendance System &nbsp;·&nbsp;
    Printed: ${now.toLocaleString('en-GB')} &nbsp;·&nbsp; Total: ${toPrint.length} students
  </div>
  </body></html>`;

  const w = window.open('', '_blank');
  if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 400); }
  addLog('info', 'Master list printed: ' + toPrint.length + ' students (' + filter + ')');
}

// ═══════════════════════════════════════════════════════════════════
// STUDENT PORTAL — face enrollment from student's own device
// ═══════════════════════════════════════════════════════════════════
let spStream = null, spSamples = [], spStudentData = null;
const SP_SAMPLES_NEEDED = 4;

// FIX 6: Rate limiting for student matric lookup — max 10 lookups per minute
let _spLookupCount = 0;
let _spLookupWindowStart = Date.now();
let _spLookupDebounce = null;
const SP_RATE_LIMIT = 10; // max lookups per minute

function checkStudentMasterList(val) {
  // Debounce: wait 600ms after last keystroke before firing
  clearTimeout(_spLookupDebounce);
  _spLookupDebounce = setTimeout(() => _doCheckStudentMasterList(val), 600);
}

async function _doCheckStudentMasterList(val) {
  const statusEl = document.getElementById('st-matric-status');
  const detailsEl = document.getElementById('st-details-block');
  val = val.trim();
  statusEl.style.display = 'none';
  detailsEl.style.display = 'none';
  if (val.length < 6) return;

  // Rate limit check — reset window every 60 seconds
  const now = Date.now();
  if(now - _spLookupWindowStart > 60000){ _spLookupCount = 0; _spLookupWindowStart = now; }
  _spLookupCount++;
  if(_spLookupCount > SP_RATE_LIMIT){
    statusEl.textContent = 'Too many attempts. Please wait a moment before trying again.';
    statusEl.style.cssText = 'font-size:11px;margin-top:5px;display:block;padding:7px 10px;border-radius:7px;font-weight:600;background:rgba(255,59,92,.1);color:#FF3B5C;border:1px solid #FF8FA3;';
    return;
  }

  // Show searching indicator immediately
  statusEl.textContent = 'Searching...';
  statusEl.style.cssText = 'font-size:11px;margin-top:5px;display:block;padding:7px 10px;border-radius:7px;font-weight:600;background:#e8f0fe;color:#0057FF;border:1px solid #bfdbfe;';

  // Ensure anonymous auth — required for Firestore access
  try {
    if (!authFB.currentUser) {
      await authFB.signInAnonymously();
    }
  } catch(e) {
    statusEl.textContent = 'System error: Anonymous sign-in not enabled. HOD must enable it in Firebase Console → Authentication → Sign-in providers → Anonymous.';
    statusEl.style.cssText = 'font-size:11px;margin-top:5px;display:block;padding:7px 10px;border-radius:7px;font-weight:600;background:rgba(255,149,0,.1);color:#FF9500;border:1px solid #fcd34d;';
    addLog('err', 'Anonymous auth failed: ' + e.message);
    return;
  }

  // Check DIRECTLY in Firebase if already enrolled — never use cached array
  try {
    const enrolledDoc = await dbFB.collection('students').doc(val).get();
    if (enrolledDoc.exists) {
      const ed = enrolledDoc.data();
      statusEl.innerHTML = `<b>Already Enrolled!</b><br><span style="font-weight:400">${ed.name ? ed.name+' is' : 'This matric is'} already registered in the face attendance system. No action needed — attend class and the scanner will recognise you automatically.</span>`;
      statusEl.style.cssText = 'font-size:11px;margin-top:5px;display:block;padding:10px 13px;border-radius:9px;font-weight:700;background:rgba(0,192,106,.1);color:#065f46;border:1.5px solid #6EE7B7;line-height:1.7;';
      detailsEl.style.display = 'none';
      addLog('info', 'Re-enroll attempt blocked — already enrolled: ' + val);
      return;
    }
  } catch(e) {
    addLog('warn', 'Students check: ' + e.message);
    // Continue to masterlist check even if students read fails
  }

  // Check master list DIRECTLY in Firestore — always fresh, never cached
  try {
    const doc = await dbFB.collection('masterlist').doc(val).get();
    if (!doc.exists) {
      statusEl.textContent = '❌ Matric number not found in master list. Contact your HOD.';
      statusEl.style.cssText = 'font-size:11px;margin-top:5px;display:block;padding:7px 10px;border-radius:7px;font-weight:600;background:rgba(255,59,92,.1);color:#FF3B5C;border:1px solid #FF8FA3;';
      return;
    }
    const data = doc.data();
    spStudentData = data;
    statusEl.textContent = '✓ Found in master list!';
    statusEl.style.cssText = 'font-size:11px;margin-top:5px;display:block;padding:7px 10px;border-radius:7px;font-weight:600;background:rgba(0,192,106,.1);color:#00C06A;border:1px solid #6EE7B7;';
    document.getElementById('st-details-display').innerHTML =
      `<b>${data.name}</b><br>${data.level}${data.option ? ' · ' + data.option : ' · General'}<br>Matric: ${data.matric}`;
    detailsEl.style.display = 'block';
  } catch(e) {
    if (e.code === 'permission-denied' || e.message.includes('permission') || e.message.includes('Missing')) {
      statusEl.textContent = 'Permission denied. HOD must set Firestore rule: match /masterlist/{m} { allow read: if true; }';
      statusEl.style.cssText = 'font-size:11px;margin-top:5px;display:block;padding:7px 10px;border-radius:7px;font-weight:600;background:rgba(255,149,0,.1);color:#FF9500;border:1px solid #fcd34d;';
      addLog('err', 'Masterlist permission denied: ' + e.message);
    } else {
      statusEl.textContent = 'Error: ' + e.message;
      statusEl.style.cssText = 'font-size:11px;margin-top:5px;display:block;padding:7px 10px;border-radius:7px;font-weight:600;background:rgba(255,59,92,.1);color:#FF3B5C;';
      addLog('err', 'Masterlist check error: ' + e.message);
    }
  }
}

function doStudentLoginNo() {
  // Student says details are wrong — clear and try again
  spStudentData = null;
  document.getElementById('st-matric').value = '';
  document.getElementById('st-matric-status').style.display = 'none';
  document.getElementById('st-details-block').style.display = 'none';
  showLoginErr('Please contact your HOD to correct your details in the master list.');
}

let _spSessionTimer = null;
const SP_SESSION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

async function doStudentLoginYes() {
  if (!spStudentData) { showLoginErr('Verify your matric number first.'); return; }
  // Open student portal
  document.getElementById('login-screen').classList.remove('show');
  const portal = document.getElementById('student-portal');
  portal.style.display = 'flex';
  document.getElementById('sp-name').textContent = spStudentData.name;
  document.getElementById('sp-details').textContent = spStudentData.level + (spStudentData.option ? ' · ' + spStudentData.option : ' · General') + ' · ' + spStudentData.matric;

  // FIX 14: Load logo from localStorage (cloud-synced) — not from DOM element which may not load offline
  const savedLogo = lsGet('schoolLogoDataUrl') || '';
  const spLogoEl = document.getElementById('sp-logo');
  if (savedLogo) {
    spLogoEl.src = savedLogo;
    spLogoEl.style.background = 'white';
    spLogoEl.style.padding = '4px';
  } else {
    // Fallback: try the header logo
    const hdrLogo = document.querySelector('.hdr-logo');
    spLogoEl.src = hdrLogo && hdrLogo.src ? hdrLogo.src : '';
  }

  spSamples = [];
  spUpdateProgress();

  // FIX 11: Auto-timeout student portal after 10 minutes of inactivity
  clearTimeout(_spSessionTimer);
  _spSessionTimer = setTimeout(() => {
    if (document.getElementById('student-portal').style.display !== 'none') {
      addLog('warn', 'Student portal timed out for: ' + (spStudentData ? spStudentData.matric : 'unknown'));
      alert('Session expired after 10 minutes of inactivity. Please re-enter your matric number.');
      spGoBackToLogin();
    }
  }, SP_SESSION_TIMEOUT_MS);

  addLog('info', 'Student portal opened for: ' + spStudentData.matric);
}

async function doStudentLogin() { doStudentLoginYes(); }

function spGoBackToLogin() {
  // FIX 11: Clear session timeout
  clearTimeout(_spSessionTimer);
  // Stop camera if running
  if (spStream) { spStream.getTracks().forEach(t => t.stop()); spStream = null; }
  // Clear all enrollment state
  spSamples = []; spStudentData = null;
  // Reset portal UI
  const capBtn = document.getElementById('sp-cap-btn');
  const saveBtn = document.getElementById('sp-save-btn');
  const camBtn = document.getElementById('sp-cam-btn');
  const retakeBtn = document.getElementById('sp-retake-btn');
  if(capBtn){capBtn.disabled=true;capBtn.style.opacity='.4';}
  if(saveBtn){saveBtn.disabled=true;saveBtn.style.opacity='.4';}
  if(camBtn){camBtn.textContent='▶ Start Camera';camBtn.disabled=false;camBtn.style.display='';}
  if(retakeBtn){retakeBtn.style.display='none';}
  // Reset dots
  for(let i=0;i<SP_SAMPLES_NEEDED;i++){
    const dot=document.getElementById('sp-dot'+i);
    if(dot){dot.innerHTML=String(i+1);dot.style.border='2px dashed rgba(255,255,255,.3)';dot.style.boxShadow='';}
  }
  document.getElementById('sp-prog-bar').style.width='0%';
  document.getElementById('sp-prog-lbl').textContent='0 / '+SP_SAMPLES_NEEDED;
  document.getElementById('sp-status').textContent='Tap Start Camera to begin enrollment';
  document.getElementById('sp-status').style.background='';
  document.getElementById('sp-status').style.color='';
  // Sign out anonymous auth so student must re-enter matric
  if(authFB.currentUser && authFB.currentUser.isAnonymous){
    authFB.signOut().catch(()=>{});
  }
  // Hide portal, clear student login fields, show login
  document.getElementById('student-portal').style.display='none';
  const matricInput=document.getElementById('st-matric');
  if(matricInput) matricInput.value='';
  const statusEl=document.getElementById('st-matric-status');
  if(statusEl) statusEl.style.display='none';
  const detailsEl=document.getElementById('st-details-block');
  if(detailsEl) detailsEl.style.display='none';
  const nameInput=document.getElementById('st-confirm-name');
  if(nameInput) nameInput.value='';
  showLogin();
  addLog('info','Student returned to login — state cleared');
}

async function spToggleCam() {
  const btn = document.getElementById('sp-cam-btn');
  if (spStream) {
    spStream.getTracks().forEach(t => t.stop()); spStream = null;
    document.getElementById('sp-vid').style.display = 'none';
    document.getElementById('sp-cam-ph').style.display = 'flex';
    document.getElementById('sp-cap-btn').disabled = true;
    document.getElementById('sp-cap-btn').style.opacity = '.4';
    btn.textContent = '▶ Start Camera';
    return;
  }
  btn.textContent = '⏳ Starting...'; btn.disabled = true;
  try {
    let s = null;
    for (const c of [
      {video:{facingMode:{ideal:'user'},width:{ideal:640},height:{ideal:480}}},
      {video:true},{video:{}}
    ]) { try { s = await navigator.mediaDevices.getUserMedia(c); break; } catch(e) { continue; } }
    if (!s) throw new Error('No camera available');
    spStream = s;
    const vid = document.getElementById('sp-vid');
    vid.srcObject = s; vid.style.display = 'block';
    await vid.play().catch(() => {});
    document.getElementById('sp-cam-ph').style.display = 'none';
    document.getElementById('sp-cap-btn').disabled = false;
    document.getElementById('sp-cap-btn').style.opacity = '1';
    btn.textContent = '■ Stop Camera'; btn.disabled = false;
    document.getElementById('sp-status').textContent = 'Camera active — tap Capture to take face sample';
  } catch(e) {
    btn.textContent = '▶ Start Camera'; btn.disabled = false;
    document.getElementById('sp-status').textContent = 'Camera error: ' + (e.name === 'NotAllowedError' ? 'Permission denied. Allow camera in browser settings.' : e.message);
  }
}

// ── FIX 4: ENHANCED LIVENESS — NOD + BLINK AUTO-CAPTURE ─────────
// Phase 1: Detect head nod (Y-axis movement) → auto-capture sample
// Phase 2: Detect blink (EAR) → auto-capture final sample
let _livenessPhase = 'nod'; // 'nod' | 'blink'
let _livenessNodBaseline = null;
let _livenessNodDetected = false;
let _livenessBlinkDetected = false;
let _livenessMonitorInterval = null;
const EAR_BLINK_THRESHOLD = 0.20;
const NOD_THRESHOLD = 18; // pixels of nose Y movement to count as nod

function calcEAR(eyePts) {
  const dist = (a, b) => Math.sqrt((a.x-b.x)**2 + (a.y-b.y)**2);
  const vert1 = dist(eyePts[1], eyePts[5]);
  const vert2 = dist(eyePts[2], eyePts[4]);
  const horiz = dist(eyePts[0], eyePts[3]);
  return horiz > 0 ? (vert1 + vert2) / (2 * horiz) : 0.4;
}

function startLivenessMonitor(phase) {
  _livenessPhase = phase || 'nod';
  _livenessNodBaseline = null;
  _livenessNodDetected = false;
  _livenessBlinkDetected = false;
  clearInterval(_livenessMonitorInterval);

  const banner = document.getElementById('sp-liveness-banner');
  const msg = document.getElementById('sp-liveness-msg');
  if (banner) { banner.style.display = 'block'; banner.style.background='rgba(123,97,255,.25)'; banner.style.borderColor='rgba(180,168,255,.4)'; }

  if (_livenessPhase === 'nod') {
    if (msg) { msg.style.color='#C4B5FD'; msg.textContent = 'NOD your head DOWN once to prove you\'re live...'; }
  } else {
    if (msg) { msg.style.color='#C4B5FD'; msg.textContent = 'BLINK once slowly for final confirmation...'; }
  }

  let nodPeakDetected = false;
  let eyeWasOpen = true;
  const vid = document.getElementById('sp-vid');

  _livenessMonitorInterval = setInterval(async () => {
    if (!spStream) { clearInterval(_livenessMonitorInterval); return; }
    try {
      const det = await faceapi.detectSingleFace(vid,
        new faceapi.TinyFaceDetectorOptions({inputSize:160, scoreThreshold:.45}))
        .withFaceLandmarks(true);
      if (!det) return;

      const lm = det.landmarks.positions;
      const noseY = lm[33] ? lm[33].y : null; // nose tip

      if (_livenessPhase === 'nod' && noseY !== null) {
        if (_livenessNodBaseline === null) {
          _livenessNodBaseline = noseY;
        } else {
          const delta = noseY - _livenessNodBaseline;
          // Nodding down = positive delta
          if (delta > NOD_THRESHOLD && !nodPeakDetected) {
            nodPeakDetected = true;
          }
          // Head returns to baseline after nod
          if (nodPeakDetected && delta < NOD_THRESHOLD * 0.5) {
            // Nod complete — auto-capture this sample!
            clearInterval(_livenessMonitorInterval);
            _livenessNodDetected = true;
            if (banner) { banner.style.background='rgba(0,192,106,.25)'; banner.style.borderColor='rgba(110,231,183,.4)'; }
            if (msg) { msg.style.color='#6EE7B7'; msg.textContent = '✓ Nod detected! Capturing...'; }
            setTimeout(() => { spCapture(); }, 300); // auto-capture after brief delay
          }
        }
      } else if (_livenessPhase === 'blink') {
        const leftEye = lm.slice(36, 42);
        const rightEye = lm.slice(42, 48);
        const ear = (calcEAR(leftEye) + calcEAR(rightEye)) / 2;

        if (eyeWasOpen && ear < EAR_BLINK_THRESHOLD) {
          eyeWasOpen = false;
        } else if (!eyeWasOpen && ear > EAR_BLINK_THRESHOLD) {
          // Blink complete — auto-capture!
          clearInterval(_livenessMonitorInterval);
          _livenessBlinkDetected = true;
          if (banner) { banner.style.background='rgba(0,192,106,.25)'; banner.style.borderColor='rgba(110,231,183,.4)'; }
          if (msg) { msg.style.color='#6EE7B7'; msg.textContent = '✓ Blink confirmed! Capturing final sample...'; }
          setTimeout(() => { spCapture(); }, 300); // auto-capture
        }
      }
    } catch(e) { /* ignore detection errors */ }
  }, 100); // check every 100ms — faster than before
}

function stopLivenessMonitor() {
  clearInterval(_livenessMonitorInterval);
  _livenessNodDetected = false;
  _livenessBlinkDetected = false;
  _livenessPhase = 'nod';
  const banner = document.getElementById('sp-liveness-banner');
  if (banner) banner.style.display = 'none';
}

// ── STUDENT SELF-ENROLL: 4-challenge liveness (mirrors HOD flow) ─
let spChallenge = 0;
let spLivenessActive = false;
let spLivenessInterval = null;
let spBestThumb = null;
const SP_CHALLENGES = [
  { label: 'Look straight — Neutral Face 1', icon: 'neutral', phase: 'neutral' },
  { label: 'Hold still — Neutral Face 2', icon: 'neutral', phase: 'neutral' },
  { label: 'BLINK once slowly', icon: 'blink', phase: 'blink' },
  { label: 'Turn head LEFT then RIGHT', icon: '↔', phase: 'headturn' },
];

function spUpdateStatus(text, col) {
  const el = document.getElementById('sp-status');
  if (!el) return;
  el.textContent = text;
  el.style.color = col || 'rgba(255,255,255,.85)';
}

function spUpdateLivenessBanner(idx) {
  const banner = document.getElementById('sp-liveness-banner');
  const msg = document.getElementById('sp-liveness-msg');
  if (!banner || !msg) return;
  if (idx >= SP_SAMPLES_NEEDED) {
    banner.style.background = 'rgba(0,192,106,.2)';
    banner.style.borderColor = 'rgba(110,231,183,.4)';
    msg.style.color = '#6EE7B7';
    msg.textContent = '✓ All 4 challenges passed! Tap Submit & Enroll.';
    banner.style.display = 'block';
    speak('Enrollment complete. Tap Submit to save.');
    return;
  }
  const ch = SP_CHALLENGES[idx];
  banner.style.background = 'rgba(123,97,255,.22)';
  banner.style.borderColor = 'rgba(180,168,255,.4)';
  msg.style.color = '#C4B5FD';
  msg.textContent = 'Challenge ' + (idx+1) + '/4: ' + ch.label;
  banner.style.display = 'block';
  speak(ch.label);
}

async function spCapture() {
  if (!spStream || !loaded) { spUpdateStatus('Camera not active or models loading...'); return; }
  if (spLivenessActive) return;
  if (spChallenge >= SP_SAMPLES_NEEDED) { spUpdateStatus('All done! Tap Submit.', '#6EE7B7'); return; }

  const banner = document.getElementById('sp-liveness-banner');
  if (banner) banner.style.display = 'block';
  spUpdateLivenessBanner(spChallenge);

  const ch = SP_CHALLENGES[spChallenge];
  const vid = document.getElementById('sp-vid');
  const capBtn = document.getElementById('sp-cap-btn');

  if (ch.phase === 'neutral') {
    spLivenessActive = true;
    if (capBtn) { capBtn.disabled = true; capBtn.style.opacity = '.5'; }
    spUpdateStatus('Detecting face...', '#C4B5FD');
    try {
      const det = await faceapi.detectSingleFace(vid, new faceapi.TinyFaceDetectorOptions({inputSize:320,scoreThreshold:.55}))
        .withFaceLandmarks(true).withFaceDescriptor();
      if (!det) {
        spUpdateStatus('No face detected. Centre your face and try again.');
        spLivenessActive = false;
        if (capBtn) { capBtn.disabled = false; capBtn.style.opacity = '1'; }
        return;
      }
      spSamples.push(det.descriptor);
      // Save clearest neutral thumb
      if (!spBestThumb) {
        const tc = document.createElement('canvas'); tc.width=80; tc.height=80;
        const b = det.detection.box;
        tc.getContext('2d').drawImage(vid, Math.max(0,b.x), Math.max(0,b.y), b.width, b.height, 0, 0, 80, 80);
        spBestThumb = tc.toDataURL('image/jpeg', 0.5);
      }
      _spMarkDot(spChallenge, vid, det);
      spChallenge++;
      spUpdateProgress();
      spUpdateLivenessBanner(spChallenge);
      speak('Good.');
    } catch(e) { spUpdateStatus('Error: ' + e.message); }
    spLivenessActive = false;
    if (capBtn) { capBtn.disabled = false; capBtn.style.opacity = '1'; }

  } else if (ch.phase === 'blink') {
    await _spRunBlink(vid, capBtn);
  } else if (ch.phase === 'headturn') {
    await _spRunHeadTurn(vid, capBtn);
  }
}

function _spMarkDot(idx, vid, det) {
  const dot = document.getElementById('sp-dot' + idx);
  if (!dot) return;
  const tmp = document.createElement('canvas'); tmp.width=56; tmp.height=56;
  if (det && det.detection) {
    const b = det.detection.box;
    tmp.getContext('2d').drawImage(vid, Math.max(0,b.x), Math.max(0,b.y), b.width, b.height, 0, 0, 56, 56);
  } else { tmp.getContext('2d').drawImage(vid,0,0,56,56); }
  dot.innerHTML = ''; dot.appendChild(tmp);
  const tk = document.createElement('div');
  tk.style.cssText='position:absolute;bottom:2px;right:2px;font-size:9px;color:#00D68F;font-weight:900;background:rgba(255,255,255,.9);border-radius:3px;padding:0 3px;';
  tk.textContent='✓'; dot.appendChild(tk);
  dot.style.border='2px solid #00D68F';
  dot.style.boxShadow='0 0 0 3px rgba(0,192,106,.2)';
}

function _spRunBlink(vid, capBtn) {
  return new Promise(resolve => {
    spLivenessActive = true;
    if (capBtn) { capBtn.disabled = true; capBtn.style.opacity = '.5'; capBtn.textContent='Waiting for blink...'; }
    spUpdateStatus('Blink once slowly...', '#C4B5FD');
    let eyeWasOpen = true; const EAR_T = 0.20;
    let t = setTimeout(() => {
      clearInterval(spLivenessInterval); spLivenessActive = false;
      spUpdateStatus('Timeout — tap again to retry blink.');
      if (capBtn) { capBtn.disabled=false; capBtn.style.opacity='1'; capBtn.textContent='Capture Face Sample'; }
      resolve();
    }, 12000);
    spLivenessInterval = setInterval(async () => {
      try {
        const d = await faceapi.detectSingleFace(vid, new faceapi.TinyFaceDetectorOptions({inputSize:160,scoreThreshold:.40})).withFaceLandmarks(true);
        if (!d) return;
        const lm = d.landmarks.positions;
        const ear = (calcEAR(lm.slice(36,42)) + calcEAR(lm.slice(42,48))) / 2;
        if (eyeWasOpen && ear < EAR_T) eyeWasOpen = false;
        else if (!eyeWasOpen && ear > EAR_T) {
          clearTimeout(t); clearInterval(spLivenessInterval); spLivenessActive = false;
          speak('Blink confirmed!');
          setTimeout(async () => {
            const d2 = await faceapi.detectSingleFace(vid, new faceapi.TinyFaceDetectorOptions({inputSize:320,scoreThreshold:.55})).withFaceLandmarks(true).withFaceDescriptor();
            if (d2) spSamples.push(d2.descriptor);
            _spMarkDot(spChallenge, vid, d2||d);
            spChallenge++; spUpdateProgress(); spUpdateLivenessBanner(spChallenge);
            if (spChallenge >= SP_SAMPLES_NEEDED) {
              document.getElementById('sp-save-btn').disabled=false;
              document.getElementById('sp-save-btn').style.opacity='1';
            }
            if (capBtn) { capBtn.disabled=false; capBtn.style.opacity='1'; capBtn.textContent='Capture Face Sample'; }
            resolve();
          }, 300);
        }
      } catch(e){}
    }, 80);
  });
}

function _spRunHeadTurn(vid, capBtn) {
  return new Promise(resolve => {
    spLivenessActive = true;
    if (capBtn) { capBtn.disabled=true; capBtn.style.opacity='.5'; capBtn.textContent='← Turn LEFT...'; }
    spUpdateStatus('Turn head LEFT → then RIGHT →', '#C4B5FD');
    speak('Turn your head to the left.');
    let phase='left', leftDone=false, baseline=null;
    let t = setTimeout(() => {
      clearInterval(spLivenessInterval); spLivenessActive = false;
      spUpdateStatus('Timeout — tap again to retry head turn.');
      if (capBtn) { capBtn.disabled=false; capBtn.style.opacity='1'; capBtn.textContent='Capture Face Sample'; }
      resolve();
    }, 16000);
    spLivenessInterval = setInterval(async () => {
      try {
        const d = await faceapi.detectSingleFace(vid, new faceapi.TinyFaceDetectorOptions({inputSize:160,scoreThreshold:.40})).withFaceLandmarks(true);
        if (!d) return;
        const noseX = d.landmarks.positions[33] ? d.landmarks.positions[33].x : null;
        if (!noseX) return;
        if (!baseline) { baseline=noseX; return; }
        const delta = noseX - baseline;
        if (phase==='left' && delta < -14) {
          phase='right'; leftDone=true;
          spUpdateStatus('Good! Now turn RIGHT →', '#C4B5FD');
          speak('Good. Now turn to the right.');
          if (capBtn) capBtn.textContent='Turn RIGHT →';
        } else if (phase==='right' && leftDone && delta > 14) {
          clearTimeout(t); clearInterval(spLivenessInterval); spLivenessActive = false;
          speak('Head turn complete!');
          setTimeout(async () => {
            const d2 = await faceapi.detectSingleFace(vid, new faceapi.TinyFaceDetectorOptions({inputSize:320,scoreThreshold:.55})).withFaceLandmarks(true).withFaceDescriptor();
            if (d2) spSamples.push(d2.descriptor);
            _spMarkDot(spChallenge, vid, d2||d);
            spChallenge++; spUpdateProgress(); spUpdateLivenessBanner(spChallenge);
            if (spChallenge >= SP_SAMPLES_NEEDED) {
              document.getElementById('sp-save-btn').disabled=false;
              document.getElementById('sp-save-btn').style.opacity='1';
            }
            if (capBtn) { capBtn.disabled=spChallenge>=SP_SAMPLES_NEEDED; capBtn.style.opacity='1'; capBtn.textContent='Capture Face Sample'; }
            resolve();
          }, 300);
        }
      } catch(e){}
    }, 80);
  });
}

function spUpdateProgress() {
  const pct = (spSamples.length / SP_SAMPLES_NEEDED * 100);
  document.getElementById('sp-prog-bar').style.width = pct + '%';
  document.getElementById('sp-prog-lbl').textContent = spSamples.length + ' / ' + SP_SAMPLES_NEEDED;
  // Show retake button once at least 1 sample taken
  const retakeBtn = document.getElementById('sp-retake-btn');
  if (retakeBtn) retakeBtn.style.display = spSamples.length > 0 ? 'block' : 'none';
  // Enable submit button when ALL challenges complete
  const saveBtn = document.getElementById('sp-save-btn');
  if (saveBtn) {
    if (spSamples.length >= SP_SAMPLES_NEEDED && spChallenge >= SP_SAMPLES_NEEDED) {
      saveBtn.disabled = false;
      saveBtn.style.opacity = '1';
    } else {
      saveBtn.disabled = true;
      saveBtn.style.opacity = '.4';
    }
  }
}

function spRetake() {
  spSamples = []; spChallenge = 0; spLivenessActive = false; spBestThumb = null;
  clearInterval(spLivenessInterval);
  stopLivenessMonitor();
  const labels = ['1','2','blink','←'];
  for (let i = 0; i < SP_SAMPLES_NEEDED; i++) {
    const dot = document.getElementById('sp-dot' + i);
    if (dot) { dot.innerHTML = labels[i]||String(i+1); dot.style.border = '2px dashed rgba(255,255,255,.3)'; dot.style.boxShadow = ''; }
  }
  const banner = document.getElementById('sp-liveness-banner');
  if (banner) banner.style.display = 'none';
  const capBtn = document.getElementById('sp-cap-btn');
  const saveBtn = document.getElementById('sp-save-btn');
  if (capBtn) { capBtn.disabled = false; capBtn.style.opacity = '1'; capBtn.textContent='Capture Face Sample'; }
  if (saveBtn) { saveBtn.disabled = true; saveBtn.style.opacity = '.4'; }
  spUpdateStatus('Samples cleared — tap Capture to begin challenges.');
  spUpdateProgress();
}

async function spSaveEnrollment() {
  if (!spStudentData || spSamples.length < SP_SAMPLES_NEEDED) return;
  const btn = document.getElementById('sp-save-btn');
  const statusEl = document.getElementById('sp-status');

  // ── LIVE DUPLICATE FACE CHECK ────────────────────────────────────
  btn.textContent = 'Checking...';
  btn.disabled = true;
  btn.style.opacity = '1';
  statusEl.textContent = 'Checking database for duplicate face — please wait...';
  statusEl.style.background = 'rgba(255,255,255,.1)';
  statusEl.style.color = 'rgba(255,255,255,.8)';

  const { matric, name, level, option } = spStudentData;
  // excludeMatric = null since this is a brand new enrollment
  const dupeResult = await checkFaceDuplicateLive(spSamples, null);
  if (dupeResult && dupeResult.fetchFailed) {
    btn.textContent = 'Submit & Enroll';
    btn.disabled = false;
    btn.style.opacity = '1';
    statusEl.textContent = '⚠ Cannot verify face — database unreachable. Ask your HOD to check Firestore rules (students: read if true).';
    statusEl.style.background = 'rgba(217,119,6,.2)';
    statusEl.style.color = '#fcd34d';
    addLog('warn', 'Dupe check blocked enrollment — DB unreachable for: ' + matric);
    return;
  }
  if (dupeResult) {
    btn.textContent = 'Submit & Enroll';
    btn.disabled = false;
    btn.style.opacity = '1';
    statusEl.textContent = '⛔ Duplicate face detected — enrollment blocked.';
    statusEl.style.background = 'rgba(220,38,38,.2)';
    statusEl.style.color = '#FF8FA3';
    showDupeModal(dupeResult, matric);
    return;
  }
  // ── END DUPLICATE CHECK ──────────────────────────────────────────

  btn.textContent = '⏳ Saving to cloud...';
  statusEl.textContent = 'Face verified — saving your enrollment...';
  try {
    // Ensure anonymous auth is active before writing
    if (!authFB.currentUser) {
      try { await authFB.signInAnonymously(); } catch(authErr) { /* continue anyway */ }
    }
    const programme = (level === 'HND 1' || level === 'HND 2') ? option + ' Option' : 'Electrical & Electronics Engineering Technology';
    const cleanDescriptors = spSamples.map(d => Array.from(d).map(v => Number(v).toFixed(4)).join(','));
    // Use best neutral thumbnail from liveness challenges
    let spPhotoDataUrl = spBestThumb || '';
    if(!spPhotoDataUrl) {
      try {
        const spVid2 = document.getElementById('sp-vid');
        if(spVid2 && spVid2.videoWidth > 0){
          const tc = document.createElement('canvas'); tc.width=80;tc.height=80;
          tc.getContext('2d').drawImage(spVid2,0,0,80,80);
          spPhotoDataUrl = tc.toDataURL('image/jpeg', 0.5);
        }
      } catch(e){}
    }
    const enrollData = {
      matric, name, level, option: option || '', programme,
      descriptors: cleanDescriptors,
      photo: spPhotoDataUrl,
      enrolledAt: new Date().toISOString(),
      enrolledByStudent: true
    };
    try {
      await dbFB.collection('students').doc(matric).set(enrollData);
    } catch(writeErr) {
      // If permission denied, show HOD-friendly error
      if(writeErr.code === 'permission-denied' || writeErr.message.includes('permission')) {
        statusEl.innerHTML = '⚠ <b>Firestore rule update needed.</b><br>Ask HOD to add this rule:<br><code style="font-size:9px;background:rgba(0,0,0,.3);padding:3px 6px;border-radius:4px;display:block;margin-top:4px;">match /students/{m} { allow write: if request.auth != null; }</code>';
        statusEl.style.background = 'rgba(217,119,6,.25)';
        statusEl.style.color = '#fcd34d';
        btn.textContent = 'Submit & Enroll';
        btn.disabled = false;
        return;
      }
      throw writeErr;
    }
    // Add to local students array (keep Float32Array for in-memory matching)
    students.push({ matric, name, level, option: option || '', programme, descriptors: spSamples.map(d => new Float32Array(d)) });
    buildMatcher();
    // Stop camera
    if (spStream) { spStream.getTracks().forEach(t => t.stop()); spStream = null; }
    // Show success
    statusEl.innerHTML = '✅ <b>Enrollment complete!</b> Your face has been saved. You will now be marked present by face scan in class.';
    statusEl.style.background = 'rgba(52,211,153,.2)';
    statusEl.style.color = '#00D68F';
    document.getElementById('sp-cam-btn').style.display = 'none';
    document.getElementById('sp-cap-btn').style.display = 'none';
    btn.textContent = '✓ Done — Close';
    btn.disabled = false;
    btn.style.opacity = '1';
    btn.onclick = () => {
      document.getElementById('student-portal').style.display = 'none';
      spStudentData = null; spSamples = [];
      showLogin();
    };
    addLog('ok', 'Student self-enrolled: ' + matric + ' — ' + name);
  } catch(e) {
    statusEl.textContent = 'Save failed: ' + e.message;
    btn.textContent = 'Submit & Enroll';
    btn.disabled = false;
    btn.style.opacity = '1';
  }
}

// ═══════════════════════════════════════════════════════════════════
// LECTURER COURSE FILTER — only show assigned courses in picker
// ═══════════════════════════════════════════════════════════════════
let lecturerCourses = []; // courses assigned to current logged-in lecturer

async function loadLecturerCourses() {
  if (!currentUser || currentUserRole === 'admin') return;
  try {
    const doc = await dbFB.collection('users').doc(currentUser.uid).get();
    if (doc.exists && doc.data().assignedCourses) {
      lecturerCourses = doc.data().assignedCourses;
      addLog('info', 'Lecturer courses loaded: ' + lecturerCourses.length + ' course(s)');
    }
  } catch(e) { addLog('warn', 'Load lecturer courses: ' + e.message); }
}

function getFilteredCourses() {
  // Admin sees all courses; lecturers see only their assigned ones
  if (currentUserRole === 'admin' || lecturerCourses.length === 0) return COURSES;
  return COURSES.filter(c => {
    const key = c.code + '_' + c.level + '_' + (c.option || '');
    return lecturerCourses.includes(key);
  });
}

// ── STARTUP ───────────────────────────────────────────────────────
// ── PWA INSTALL PROMPT ───────────────────────────────────────────
let pwaPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  pwaPrompt = e;
  // Show banner after 3 seconds if not dismissed before
  setTimeout(() => {
    if (pwaPrompt) {
      document.getElementById('pwa-banner').classList.add('show');
    }
  }, 3000);
});

async function pwaInstall() {
  if (!pwaPrompt) return;
  pwaPrompt.prompt();
  const { outcome } = await pwaPrompt.userChoice;
  if (outcome === 'accepted') {
    document.getElementById('pwa-banner').classList.remove('show');
    addLog('ok', 'App installed to home screen');
  }
  pwaPrompt = null;
}

function pwaDismiss() {
  document.getElementById('pwa-banner').classList.remove('show');
  pwaPrompt = null; // Don't ask again this session
}

window.addEventListener('appinstalled', () => {
  document.getElementById('pwa-banner').classList.remove('show');
  pwaPrompt = null;
});

// ── STARTUP ───────────────────────────────────────────────────────
window.addEventListener('load',()=>{
  // Firebase is hardcoded — init immediately when SDK is ready
  // Register service worker for PWA installability
  if ('serviceWorker' in navigator) {
    // FIX 13: Create service worker inline as a blob instead of referencing missing sw.js
    const swCode = `
      const CACHE = 'gaposa-eee-v1';
      const OFFLINE_URLS = [];
      self.addEventListener('install', e => self.skipWaiting());
      self.addEventListener('activate', e => { e.waitUntil(clients.claim()); });
      self.addEventListener('fetch', e => {
        // Only cache GET requests for same-origin non-Firebase resources
        if(e.request.method !== 'GET') return;
        if(e.request.url.includes('firestore.googleapis.com')) return;
        if(e.request.url.includes('firebase')) return;
        e.respondWith(
          fetch(e.request).catch(() => caches.match(e.request))
        );
      });
    `;
    const swBlob = new Blob([swCode], {type: 'application/javascript'});
    const swUrl = URL.createObjectURL(swBlob);
    navigator.serviceWorker.register(swUrl).then(reg => {
      addLog('info', 'Service worker registered (PWA ready)');
    }).catch(err => {
      addLog('warn', 'Service worker skipped: ' + err.message);
    });
  }
  // ── FORCED LOADER ESCAPE ─────────────────────────────────────────
  // If anything hangs, dismiss the loader after 12s max
  const BOOT_DEADLINE = setTimeout(()=>{
    const l=document.getElementById('ld');
    if(l&&l.style.display!=='none'){
      console.warn('Boot timeout — forcing login screen');
      l.style.opacity='0';
      setTimeout(()=>{ l.style.display='none'; showLogin(); },500);
    }
  }, 12000);

  function tryInit(){
    // Give Firebase SDK scripts max 8 seconds to load
    const sdkDeadline = Date.now() + 8000;
    function attempt(){
      if(typeof firebase!=='undefined'){
        clearTimeout(BOOT_DEADLINE);
        if(initFirebase()){
          bootApp().finally(()=>clearTimeout(BOOT_DEADLINE));
        } else {
          clearTimeout(BOOT_DEADLINE);
          const l=document.getElementById('ld');
          l.style.opacity='0';
          setTimeout(()=>{ l.style.display='none'; showLogin(); },500);
        }
        return;
      }
      if(Date.now() < sdkDeadline){
        setTimeout(attempt, 100);
      } else {
        // Firebase SDK never loaded — show login anyway
        console.warn('Firebase SDK load timeout — proceeding offline');
        clearTimeout(BOOT_DEADLINE);
        const l=document.getElementById('ld');
        l.style.opacity='0';
        setTimeout(()=>{ l.style.display='none'; showLogin(); },500);
      }
    }
    attempt();
  }
  tryInit();
});
