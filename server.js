// 헬스장 카카오 i 오픈빌더 스킬 서버 (단일 파일 · Render 배포용)
const express = require("express");
const crypto = require("crypto");
const app = express();
app.use(express.json());

const GYM = "○○피트니스";

// ── 환경 설정 ──
const BASE_URL = process.env.BASE_URL || "https://gym-skill-server.onrender.com";
// 실제 알림톡/친구톡 발송 스위치. 운영 채널 연결 + 템플릿 승인 전까지는 false(로그·봇테스트만).
// Render 환경변수에 SEND_ENABLED=true 를 넣는 순간 실제 발송 로직이 켜지는 구조.
const SEND_ENABLED = String(process.env.SEND_ENABLED).toLowerCase() === "true";
// 매일 스캔 실행 시각(KST, 0~23). 기본 09시.
const SCAN_HOUR_KST = Number.isFinite(Number(process.env.SCAN_HOUR_KST)) ? Number(process.env.SCAN_HOUR_KST) : 9;
// 연장 링크 서명용 시크릿
const RENEW_SECRET = process.env.RENEW_SECRET || "renew-secret-2026";

function kstDatePlus(days = 0) {
  return new Date(Date.now() + 9 * 3600000 + days * 86400000).toISOString().slice(0, 10);
}

const MEMBERS = {
  "01012345678": { name: "홍길동", membership: { type: "헬스 3개월", expire: "2026-07-25" }, pt: { remain: 3, trainer: "김코치" }, locker: true },
  "01099998888": { name: "김영희", membership: { type: "헬스+필라 6개월", expire: "2026-11-02" }, pt: { remain: 0, trainer: null }, locker: false },
  // ── 재등록 리마인드 데모용(만료 임박) ── 실제 회원 데이터 교체 시 삭제
  // ddayOf는 만료일 당일을 잔여 1일로 세므로, D-N 데모는 offset(N-1)로 설정
  "01077776666": { name: "박민수", membership: { type: "헬스 1개월", expire: kstDatePlus(6) }, pt: { remain: 0, trainer: null }, locker: false }, // D-7
  "01066665555": { name: "최지우", membership: { type: "헬스 3개월", expire: kstDatePlus(2) }, pt: { remain: 2, trainer: "이코치" }, locker: true }, // D-3
  "01055554444": { name: "정해나", membership: { type: "헬스 1개월", expire: kstDatePlus(-1) }, pt: { remain: 0, trainer: null }, locker: false }, // D-day(오늘 만료)
};
const APPUSER_TO_PHONE = { "demo-appuser-1": "01012345678" };

// ── 회전 코드(TOTP) ──
const GYM_SECRETS = { "demo": "demo-secret-key-2026" };
const WINDOW = 30000;
function codeFor(gym, win) {
  const secret = GYM_SECRETS[gym] || "default-secret";
  const h = crypto.createHmac("sha256", secret).update(String(win)).digest("hex");
  return String(parseInt(h.slice(0, 8), 16) % 1000000).padStart(6, "0");
}
function validCode(gym, code) {
  code = String(code).padStart(6, "0");
  const win = Math.floor(Date.now() / WINDOW);
  return [win - 1, win, win + 1].some((w) => codeFor(gym, w) === code);
}

const FAQ = {
  "가격": "○○피트니스 이용권 안내입니다 👇\n· 1개월 헬스 99,000원\n· 3개월 헬스 259,000원\n· PT 10회 550,000원\n· 헬스+필라 6개월 690,000원",
  "영업시간": "평일 06:00~24:00 / 주말·공휴일 08:00~22:00 운영합니다. 명절 당일은 휴무입니다.",
  "주차": "건물 지하 주차장 2시간 무료입니다 🚗 (초과 시 10분당 500원)",
  "위치": "서울시 강남구 ○○로 123, ○○빌딩 3층입니다. 2호선 △△역 3번 출구 도보 5분.",
  "샤워": "남녀 샤워실·수건·드라이어를 무료로 제공합니다. 운동복 대여는 1회 2,000원입니다.",
  "PT": "PT는 10회/20회/30회 단위로 등록 가능하며, 첫 상담은 무료입니다. 예약은 챗봇에서 바로 하실 수 있어요.",
};

function kstDate(daysAgo = 0) {
  return new Date(Date.now() + 9 * 3600000 - daysAgo * 86400000).toISOString().slice(0, 10);
}
const dayIdx = (s) => Math.floor(Date.parse(s + "T00:00:00+09:00") / 86400000);
function ddayOf(expire) {
  return Math.max(0, Math.ceil((new Date(expire + "T23:59:59+09:00") - new Date()) / 86400000));
}

// ── 출석 로그 (데모 시드) ──
const ATT = {};
ATT["01012345678"] = new Set([kstDate(0), kstDate(1), kstDate(2), kstDate(3), kstDate(4), kstDate(5), kstDate(6), kstDate(7)]); // 홍길동: 오늘 포함 연속
ATT["01099998888"] = new Set([kstDate(3), kstDate(8), kstDate(12)]); // 김영희: 뜸함
// ③④ 관리자 조회·휴면 데모용 시드
ATT["01077776666"] = new Set([kstDate(0), kstDate(1)]); // 박민수: 오늘 출석
ATT["01055554444"] = new Set([kstDate(0)]); // 정해나: 오늘 출석
MEMBERS["01044443333"] = { name: "강휴면", membership: { type: "헬스 6개월", expire: kstDatePlus(40) }, pt: { remain: 0, trainer: null }, locker: false }; // 휴면 데모 회원
ATT["01044443333"] = new Set([kstDate(18), kstDate(20), kstDate(25)]); // 강휴면: 18일째 미방문
// 가입일(이번 주 신규 등록 집계용). 데모.
MEMBERS["01012345678"].joinDate = kstDate(95);
MEMBERS["01099998888"].joinDate = kstDate(150);
MEMBERS["01077776666"].joinDate = kstDate(2); // 이번 주 신규
MEMBERS["01066665555"].joinDate = kstDate(60);
MEMBERS["01055554444"].joinDate = kstDate(4); // 이번 주 신규
MEMBERS["01044443333"].joinDate = kstDate(200);
function streakOf(set) {
  if (!set || !set.size) return 0;
  const idx = [...set].map(dayIdx).sort((a, b) => b - a);
  const today = dayIdx(kstDate(0));
  if (idx[0] !== today && idx[0] !== today - 1) return 0;
  let s = 1, prev = idx[0];
  for (let i = 1; i < idx.length; i++) { if (idx[i] === prev - 1) { s++; prev = idx[i]; } else if (idx[i] < prev - 1) break; }
  return s;
}
const monthCount = (set) => set ? [...set].filter((d) => d.slice(0, 7) === kstDate(0).slice(0, 7)).length : 0;
const weekCount = (set) => set ? [...set].map(dayIdx).filter((i) => i > dayIdx(kstDate(0)) - 7).length : 0;
const badge = (s) => (s >= 7 ? "🏆" : s >= 3 ? "🔥" : "👍");

// ── 발송 게이트웨이(중앙집중) ──
// 실제 발송은 SEND_ENABLED=true 일 때만. 그전까지는 dry-run 로그만 남겨 봇테스트/관리자 스캔으로 확인.
function sendMessage(phone, payload) {
  // payload: { channel, message, kind }
  const info = typeof payload === "string" ? { message: payload } : (payload || {});
  const line = `[${info.kind || "msg"}] ${info.channel || ""} → ${phone}: ${(info.message || "").replace(/\n/g, " / ")}`;
  if (!SEND_ENABLED) {
    console.log("[DRY-RUN·발송꺼짐] " + line);
    return { ok: true, dryRun: true, note: "SEND_ENABLED!=true (실제 발송 안 함)" };
  }
  // TODO: 실제 발송 — 카카오 비즈메시지 알림톡/친구톡 API(또는 발송대행사) 호출.
  // 템플릿 사전 승인 필요. 채널 연결되면 아래를 실제 API 호출로 교체.
  console.log("[SEND·발송켜짐(stub)] " + line);
  return { ok: true, sent: true, note: "stub-real (실 API 연결 필요)" };
}

// ── 마일스톤 리워드 엔진(②) — 스케줄러가 매일 실행 ──
const MILESTONES = [
  { key: "streak3", type: "streak", n: 3, channel: "알림톡(정보성)", msg: (m) => `[${GYM}] ${m.name}님, 출석 3일 연속 달성 🔥 꾸준함이 멋져요!` },
  { key: "streak7", type: "streak", n: 7, channel: "친구톡(광고성)", msg: (m) => `${m.name}님, 7일 연속 출석 축하드려요 🎁 [PT 1회 무료 쿠폰]을 드립니다! → 쿠폰 받기` },
  { key: "month12", type: "month", n: 12, channel: "친구톡(광고성)", msg: (m) => `${m.name}님, 이번 달 12회 개근 🏆 헬스타월을 증정합니다. 데스크에서 받아가세요!` },
];
const rewardLog = {}; // phone -> Set(key) : 이미 지급한 보상(중복 방지)
function scanRewards() {
  const out = [];
  for (const [phone, mem] of Object.entries(MEMBERS)) {
    const set = ATT[phone];
    if (!set) continue;
    const s = streakOf(set), mc = monthCount(set);
    rewardLog[phone] = rewardLog[phone] || new Set();
    for (const ms of MILESTONES) {
      const val = ms.type === "streak" ? s : mc;
      if (val >= ms.n && !rewardLog[phone].has(ms.key)) {
        rewardLog[phone].add(ms.key); // 중복 방지 기록
        const message = ms.msg(mem);
        const r = sendMessage(phone, { channel: ms.channel, message, kind: "milestone" });
        out.push({ phone, name: mem.name, milestone: ms.key, channel: ms.channel, message, sent: r.ok, dryRun: !!r.dryRun });
      }
    }
  }
  return out;
}

// ── ① 회원 재등록 자동화 엔진 ──────────────────────────────
// 만료 임박 회원에게 D-7 / D-3 / D-day 단계별 리마인드 + 원클릭 연장 링크.
const RENEWAL_STAGES = [
  { key: "dday", dday: 0, label: "D-day", channel: "알림톡(정보성)" },
  { key: "d3", dday: 3, label: "D-3", channel: "알림톡(정보성)" },
  { key: "d7", dday: 7, label: "D-7", channel: "알림톡(정보성)" },
]; // dday 오름차순 유지

const RENEW_PLANS = [
  { key: "1m", label: "헬스 1개월", price: 99000, months: 1 },
  { key: "3m", label: "헬스 3개월", price: 259000, months: 3 },
  { key: "6mp", label: "헬스+필라 6개월", price: 690000, months: 6 },
];
const won = (n) => n.toLocaleString("ko-KR") + "원";

function renewToken(phone) {
  return crypto.createHmac("sha256", RENEW_SECRET).update(String(phone)).digest("hex").slice(0, 12);
}
function renewLink(phone) {
  return `${BASE_URL}/renew?phone=${phone}&t=${renewToken(phone)}`;
}
function validRenewToken(phone, t) {
  return t && renewToken(phone) === t;
}

function stageForDday(dday) {
  for (const st of RENEWAL_STAGES) { // dday 오름차순
    if (dday <= st.dday) return st;
  }
  return null; // 7일 초과 → 리마인드 대상 아님
}
function renewalMessage(mem, phone, stage) {
  const link = renewLink(phone);
  const dday = ddayOf(mem.membership.expire);
  if (stage.key === "dday") {
    return `[${GYM}] ${mem.name}님, 오늘 회원권(${mem.membership.type})이 만료돼요 😢\n지금 연장하면 공백 없이 이어서 운동할 수 있어요.\n▶ 원클릭 연장하기: ${link}`;
  }
  return `[${GYM}] ${mem.name}님, 회원권 만료 ${dday}일 전이에요 (만료일 ${mem.membership.expire}).\n지금 재등록하면 혜택가로 바로 연장돼요 💪\n▶ 원클릭 연장하기: ${link}`;
}
const renewalLog = {}; // phone -> Set(stageKey) : 단계별 발송 중복 방지
function scanRenewals() {
  const out = [];
  for (const [phone, mem] of Object.entries(MEMBERS)) {
    if (!mem.membership || !mem.membership.expire) continue;
    const dday = ddayOf(mem.membership.expire);
    const stage = stageForDday(dday);
    if (!stage) continue; // 만료까지 8일 이상 → 대상 아님
    renewalLog[phone] = renewalLog[phone] || new Set();
    if (renewalLog[phone].has(stage.key)) continue; // 이 단계는 이미 보냄
    renewalLog[phone].add(stage.key);
    const message = renewalMessage(mem, phone, stage);
    const r = sendMessage(phone, { channel: stage.channel, message, kind: "renewal" });
    out.push({ phone, name: mem.name, stage: stage.key, label: stage.label, dday, expire: mem.membership.expire, channel: stage.channel, link: renewLink(phone), message, sent: r.ok, dryRun: !!r.dryRun });
  }
  return out;
}

function addMonths(baseYmd, months) {
  const [y, mo, d] = baseYmd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, mo - 1 + months, d));
  return dt.toISOString().slice(0, 10);
}
function extendMembership(phone, plan) {
  const mem = MEMBERS[phone];
  const today = kstDate(0);
  const base = mem.membership.expire > today ? mem.membership.expire : today; // 공백 없이 이어붙임
  const newExpire = addMonths(base, plan.months);
  mem.membership.expire = newExpire;
  mem.membership.type = plan.label;
  if (renewalLog[phone]) renewalLog[phone].clear(); // 연장 완료 → 리마인드 리셋
  return newExpire;
}

// ── ② PT 예약 고도화 엔진 ──────────────────────────────
const TRAINERS = {
  "김코치": { name: "김코치", specialty: "웨이트·체형교정", hours: [10, 11, 14, 15, 16, 17, 18, 19],
    photo: "KIM COACH", career: "경력 10년", certs: "생활스포츠지도사 2급 · NSCA-CPT",
    intro: "자세부터 잡아드립니다", tags: "#근력 #체형교정 #벌크업", clients: "누적 회원 800명+" },
  "이코치": { name: "이코치", specialty: "다이어트·재활", hours: [9, 10, 11, 13, 14, 15, 16],
    photo: "LEE COACH", career: "경력 7년", certs: "물리치료사 · 교정운동전문가(FMS)",
    intro: "무리 없이 꾸준하게", tags: "#다이어트 #재활 #통증개선", clients: "재활 PT 전문" },
  "박코치": { name: "박코치", specialty: "필라테스·바디프로필", hours: [11, 12, 13, 17, 18, 19, 20],
    photo: "PARK COACH", career: "경력 5년", certs: "필라테스 지도자 · 바디프로필 코칭",
    intro: "라인을 만드는 운동", tags: "#필라테스 #바디프로필 #체형라인", clients: "대회 입상 코칭" },
};
const TRAINER_NAMES = Object.keys(TRAINERS);
const RESERVATIONS = [];
let _resSeq = 1;
function newResId() { return "R" + (_resSeq++); }
const hhmm = (h) => `${String(h).padStart(2, "0")}:00`;
const nowHourKst = () => new Date(Date.now() + 9 * 3600000).getUTCHours();

function bookedHours(trainer, date) {
  return new Set(RESERVATIONS.filter((r) => r.status === "confirmed" && r.trainer === trainer && r.date === date).map((r) => r.time));
}
function availableHours(trainer, date) {
  const tr = TRAINERS[trainer];
  if (!tr) return [];
  const booked = bookedHours(trainer, date);
  const isToday = date === kstDate(0);
  const nh = nowHourKst();
  return tr.hours.filter((h) => !booked.has(hhmm(h)) && !(isToday && h <= nh));
}
function myReservations(phone) {
  const today = kstDate(0);
  return RESERVATIONS
    .filter((r) => r.phone === phone && r.status === "confirmed" && r.date >= today)
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}
function createReservation(m, trainer, date, time) {
  const r = { id: newResId(), phone: m.phone, name: m.name, trainer, date, time, status: "confirmed", remindedDayBefore: false };
  RESERVATIONS.push(r);
  return r;
}

function parseTrainer(s) { return TRAINER_NAMES.find((t) => (s || "").includes(t)) || null; }
function parseDate(s) {
  s = s || "";
  if (/오늘/.test(s)) return kstDate(0);
  if (/내일/.test(s)) return kstDatePlus(1);
  if (/모레/.test(s)) return kstDatePlus(2);
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];
  const md = s.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (md) return `${kstDate(0).slice(0, 4)}-${String(md[1]).padStart(2, "0")}-${String(md[2]).padStart(2, "0")}`;
  return null;
}
function parseHour(s) {
  s = s || "";
  let m = s.match(/(오전|오후)?\s*(\d{1,2})\s*시/);
  if (m) { let h = parseInt(m[2], 10); if (m[1] === "오후" && h < 12) h += 12; if (m[1] === "오전" && h === 12) h = 0; return h; }
  m = s.match(/\b([01]?\d|2[0-3]):00\b/);
  if (m) return parseInt(m[1], 10);
  return null;
}

function scanReservationReminders() {
  const tomorrow = kstDatePlus(1);
  const out = [];
  for (const r of RESERVATIONS) {
    if (r.status !== "confirmed" || r.remindedDayBefore) continue;
    if (r.date !== tomorrow) continue;
    r.remindedDayBefore = true;
    const message = `[${GYM}] ${r.name}님, 내일(${r.date}) ${r.time} ${r.trainer} PT 수업 예약이 있어요 💪\n시간에 맞춰 방문해 주세요! (변경/취소는 챗봇에서 '예약 취소')`;
    const rr = sendMessage(r.phone, { channel: "알림톡(정보성)", message, kind: "pt-remind" });
    out.push({ id: r.id, phone: r.phone, name: r.name, trainer: r.trainer, date: r.date, time: r.time, message, sent: rr.ok, dryRun: !!rr.dryRun });
  }
  return out;
}

// 데모 시드
RESERVATIONS.push({ id: newResId(), phone: "01012345678", name: "홍길동", trainer: "김코치", date: kstDatePlus(1), time: "19:00", status: "confirmed", remindedDayBefore: false });
RESERVATIONS.push({ id: newResId(), phone: "01066665555", name: "최지우", trainer: "이코치", date: kstDatePlus(2), time: "14:00", status: "confirmed", remindedDayBefore: false });

// ── ③ 사장님용 관리자 조회 엔진 ──────────────────────────────
function todayAttendanceList() {
  const today = kstDate(0);
  const list = [];
  for (const [phone, mem] of Object.entries(MEMBERS)) if (ATT[phone] && ATT[phone].has(today)) list.push(mem.name);
  return list;
}
function newThisWeek() {
  const cut = dayIdx(kstDate(0)) - 7;
  const list = [];
  for (const [, mem] of Object.entries(MEMBERS)) if (mem.joinDate && dayIdx(mem.joinDate) > cut) list.push({ name: mem.name, joinDate: mem.joinDate });
  return list.sort((a, b) => b.joinDate.localeCompare(a.joinDate));
}
function expiringSoon(days = 7) {
  const list = [];
  for (const [, mem] of Object.entries(MEMBERS)) { const d = ddayOf(mem.membership.expire); if (d <= days) list.push({ name: mem.name, dday: d, expire: mem.membership.expire }); }
  return list.sort((a, b) => a.dday - b.dday);
}

// ── ④ 휴면회원(2주+ 미방문) 세그먼트 + 리마인드 ──
function lastVisit(phone) { const s = ATT[phone]; if (!s || !s.size) return null; return [...s].sort().pop(); }
function daysSince(ymd) { return dayIdx(kstDate(0)) - dayIdx(ymd); }
function dormantMembers(thresholdDays = 14) {
  const out = [];
  for (const [phone, mem] of Object.entries(MEMBERS)) {
    const lv = lastVisit(phone);
    if (lv) { const d = daysSince(lv); if (d >= thresholdDays) out.push({ phone, name: mem.name, lastVisit: lv, days: d }); }
    else if (mem.joinDate && daysSince(mem.joinDate) >= thresholdDays) out.push({ phone, name: mem.name, lastVisit: null, days: null });
  }
  return out.sort((a, b) => (b.days || 9999) - (a.days || 9999));
}
const dormantLog = {}; // phone -> 마지막 발송 dayIdx (주 1회 제한)
function scanDormant() {
  const seg = dormantMembers(14);
  const todayIdx = dayIdx(kstDate(0));
  const out = [];
  for (const d of seg) {
    if (dormantLog[d.phone] && todayIdx - dormantLog[d.phone] < 7) continue;
    dormantLog[d.phone] = todayIdx;
    const msg = d.lastVisit
      ? `[${GYM}] ${d.name}님, ${d.days}일째 안 보이셔서 걱정돼요 🥺\n오랜만에 몸 풀러 오세요! 이번 주 방문 시 [단백질바 증정] 🎁`
      : `[${GYM}] ${d.name}님, 아직 첫 방문 전이시네요! 편하게 나오셔서 시설 둘러보세요 💪 (첫 방문 PT 체험 무료)`;
    const r = sendMessage(d.phone, { channel: "친구톡(광고성)", message: msg, kind: "dormant" });
    out.push({ phone: d.phone, name: d.name, lastVisit: d.lastVisit, days: d.days, message: msg, sent: r.ok, dryRun: !!r.dryRun });
  }
  return out;
}

// ── ⑤ 리드(무료 상담/체험 신청) 수집 엔진 ──────────────────
// 챗봇에서 성함·연락처·관심분야를 받아 접수 → 사장님 대시보드에 쌓고, 사장님에게 신규 리드 알림(dry-run).
// 실제 CRM/DB로 교체하기 전까지는 인메모리 저장.
const LEADS = [];
let _leadSeq = 1;
const LEAD_INTERESTS = ["다이어트", "체형교정", "근력", "재활", "바디프로필", "필라테스", "PT", "회원권"];
const LEAD_KEYWORDS = ["상담신청", "상담 신청", "무료상담", "무료 상담", "무료체험", "무료 체험", "체험신청", "체험 신청", "상담", "체험", "신청", "문의", "예약"];
function parseInterest(s) { return LEAD_INTERESTS.find((k) => (s || "").includes(k)) || null; }
function parseLeadName(s) {
  // 전화번호·신청 키워드·관심분야 단어를 제거한 뒤 남는 첫 한글 토큰(2~4자)을 성함으로.
  let c = (s || "").replace(/01\d{8,9}/g, " ");
  [...LEAD_KEYWORDS, ...LEAD_INTERESTS].forEach((k) => { c = c.split(k).join(" "); });
  const m = c.match(/[가-힣]{2,4}/);
  return m ? m[0] : null;
}
const maskPhone = (p) => (p ? String(p).replace(/(\d{3})(\d{3,4})(\d{4})/, "$1-****-$3") : p);
function createLead({ name, phone, interest }) {
  const at = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 16).replace("T", " ");
  const lead = { id: "L" + (_leadSeq++), name: name || "고객", phone, interest: interest || null, at, status: "신규" };
  LEADS.push(lead);
  return lead;
}
function newLeads() { return LEADS.filter((l) => l.status === "신규"); }
// 데모 시드(사장님 대시보드에 바로 보이도록 1건)
createLead({ name: "이서준", phone: "01033332222", interest: "다이어트" });

// ── ⑥ 프론트데스크 대체: 신청 접수(정지·환불·양도·정보변경·대여·분실물·주차) ──
// 데스크가 종이/전화로 받던 각종 신청을 챗봇으로 받아 사장님 대시보드에 쌓음.
const REQUESTS = [];
let _reqSeq = 1;
function nowKstStr() { return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 16).replace("T", " "); }
function createRequest({ type, name, phone, detail }) {
  const r = { id: "Q" + (_reqSeq++), type, name: name || "고객", phone: phone || null, detail: detail || null, at: nowKstStr(), status: "접수" };
  REQUESTS.push(r);
  return r;
}
function newRequests() { return REQUESTS.filter((r) => r.status === "접수"); }
function addDays(baseYmd, days) { return new Date(Date.parse(baseYmd + "T12:00:00+09:00") + days * 86400000).toISOString().slice(0, 10); }
function parseDays(s) { const m = (s || "").match(/(\d{1,3})\s*일/); return m ? parseInt(m[1], 10) : null; }

// ── 회원권 일시정지(홀딩) — 정지 일수만큼 만료일 연기 ──
function holdMembership(phone, days) {
  const mem = MEMBERS[phone];
  const today = kstDate(0);
  const base = mem.membership.expire > today ? mem.membership.expire : today;
  const newExpire = addDays(base, days);
  mem.membership.expire = newExpire;
  if (renewalLog[phone]) renewalLog[phone].clear();
  return newExpire;
}

// ── GX(그룹수업) 시간표 + 예약 ──
const GX_SCHEDULE = [
  { id: "GX1", name: "스피닝", time: "10:00", instructor: "제니", cap: 12 },
  { id: "GX2", name: "요가", time: "12:00", instructor: "하나", cap: 15 },
  { id: "GX3", name: "필라테스", time: "18:00", instructor: "수민", cap: 10 },
  { id: "GX4", name: "줌바", time: "20:00", instructor: "리아", cap: 20 },
];
const GX_BOOKINGS = {}; // gxId -> Set(phone)
function gxBookedCount(id) { return GX_BOOKINGS[id] ? GX_BOOKINGS[id].size : 0; }
function findGx(s) { return GX_SCHEDULE.find((c) => (s || "").includes(c.name)) || null; }
function bookGx(id, phone) {
  GX_BOOKINGS[id] = GX_BOOKINGS[id] || new Set();
  if (GX_BOOKINGS[id].has(phone)) return { ok: true, already: true };
  const cls = GX_SCHEDULE.find((c) => c.id === id);
  if (gxBookedCount(id) >= cls.cap) return { ok: false, full: true };
  GX_BOOKINGS[id].add(phone);
  return { ok: true };
}
GX_BOOKINGS["GX1"] = new Set(["01099998888", "01066665555"]); // 데모 시드

// ── 공지·운영 안내(사장님이 등록) ──
const NOTICES = [
  { title: "청소 시간", body: "매일 14:00~14:30 헬스존 청소로 이용이 제한됩니다." },
  { title: "단축 운영", body: "7/17(금)은 시설 점검으로 22:00 조기 마감합니다." },
];

// ── 락커·대여 ──
const RENTAL_ITEMS = { "락커": "월 20,000원 · 데스크에서 배정", "운동복": "1회 2,000원", "수건": "무료 (1일 2매)" };

// ── 분실물(보관 중) ──
const LOSTFOUND = [
  { item: "블루투스 이어폰(흰색)", where: "GX룸", date: kstDate(2) },
  { item: "삼성 텀블러(검정)", where: "샤워실", date: kstDate(1) },
];

// ── 주차 등록 ──
const PARKING = {}; // phone -> car number
function parseCar(s) { const m = (s || "").replace(/\s/g, "").match(/\d{2,3}[가-힣]\d{4}/); return m ? m[0] : null; }

// ────────────────────────────────────────────────────────────
// 기존 기능 디테일 강화용 데이터·헬퍼
// ────────────────────────────────────────────────────────────
// 회원 마이페이지: 결제내역·락커만료·노쇼·등급
MEMBERS["01012345678"].payments = [{ date: kstDate(95), item: "헬스 3개월", amount: 259000 }, { date: kstDate(5), item: "PT 10회", amount: 550000 }];
MEMBERS["01012345678"].lockerExpire = kstDatePlus(20);
MEMBERS["01012345678"].noShow = 0;
MEMBERS["01099998888"].payments = [{ date: kstDate(150), item: "헬스+필라 6개월", amount: 690000 }];
MEMBERS["01099998888"].noShow = 1;
MEMBERS["01077776666"].payments = [{ date: kstDate(2), item: "헬스 1개월", amount: 99000 }];
MEMBERS["01066665555"].payments = [{ date: kstDate(60), item: "헬스 3개월", amount: 259000 }, { date: kstDate(60), item: "PT 20회", amount: 990000 }];
MEMBERS["01066665555"].lockerExpire = kstDatePlus(40);

function memberGrade(m) {
  const spent = (m.payments || []).reduce((s, p) => s + p.amount, 0);
  if (spent >= 900000) return { name: "골드", icon: "🥇", spent };
  if (spent >= 300000) return { name: "실버", icon: "🥈", spent };
  return { name: "브론즈", icon: "🥉", spent };
}

// 개인 최고 연속 출석
function bestStreak(set) {
  if (!set || !set.size) return 0;
  const idx = [...set].map(dayIdx).sort((a, b) => a - b);
  let best = 1, cur = 1;
  for (let i = 1; i < idx.length; i++) {
    if (idx[i] === idx[i - 1] + 1) { cur++; best = Math.max(best, cur); }
    else if (idx[i] !== idx[i - 1]) { cur = 1; }
  }
  return best;
}

// 이번 달 출석 잔디밭(텍스트 히트맵)
function attendanceCalendar(set) {
  const now = new Date(Date.now() + 9 * 3600000);
  const y = now.getUTCFullYear(), mo = now.getUTCMonth(), today = now.getUTCDate();
  const firstDow = new Date(Date.UTC(y, mo, 1)).getUTCDay();
  const dim = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  const ymd = (d) => `${y}-${String(mo + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push("⬛");
  for (let d = 1; d <= dim; d++) cells.push(d === today ? "🔥" : (set && set.has(ymd(d)) ? "🟩" : "⬜"));
  while (cells.length % 7 !== 0) cells.push("⬛");
  const rows = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7).join(""));
  return `🗓️ ${y}년 ${mo + 1}월\n${rows.join("\n")}`;
}
function progressBar(cur, goal) {
  const n = 10, filled = Math.max(0, Math.min(n, Math.round((cur / goal) * n)));
  return "▓".repeat(filled) + "░".repeat(n - filled) + ` ${cur}/${goal}회`;
}

// 실시간 혼잡도(시간대 기반 추정)
function zoneCongestion(peak) {
  const h = nowHourKst();
  if (peak && peak.includes(h)) return { icon: "🔴", label: "붐빔" };
  if (peak && (peak.includes(h - 1) || peak.includes(h + 1))) return { icon: "🟡", label: "보통" };
  return { icon: "🟢", label: "여유" };
}

// 지난 수업(운동 기록)
function pastReservations(phone) {
  const today = kstDate(0);
  return RESERVATIONS.filter((r) => r.phone === phone && (r.status === "done" || (r.status === "confirmed" && r.date < today)))
    .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
}
RESERVATIONS.push({ id: newResId(), phone: "01012345678", name: "홍길동", trainer: "김코치", date: kstDate(3), time: "19:00", status: "done", attended: true, feedback: "스쿼트 자세 교정 완료 · 다음 목표 데드리프트 60kg", remindedDayBefore: true });
RESERVATIONS.push({ id: newResId(), phone: "01012345678", name: "홍길동", trainer: "김코치", date: kstDate(6), time: "19:00", status: "done", attended: true, feedback: "인터벌 유산소 20분 · 코어 루틴 추가", remindedDayBefore: true });

// 강사 리뷰·평점·대표 프로그램
Object.assign(TRAINERS["김코치"], { rating: 4.9, reviews: 127, program: "3개월 벌크업 프로그램" });
Object.assign(TRAINERS["이코치"], { rating: 4.8, reviews: 94, program: "8주 체지방 감량반" });
Object.assign(TRAINERS["박코치"], { rating: 5.0, reviews: 63, program: "바디프로필 12주 완성" });

// 이벤트(마감 카운트다운·선착순)
const EVENTS = [
  { title: "🎉 신규 3개월 등록 PT 2회 무료", desc: "등록비 면제 + PT 2회 증정", end: kstDatePlus(12), total: 30, left: 8 },
  { title: "👥 친구 추천 이벤트", desc: "추천·피추천 양쪽 회원권 2주 연장", end: kstDatePlus(20), total: 0, left: 0 },
  { title: "📊 인바디 무료 체험 (7월 한정)", desc: "체성분 측정 + 결과 상담 무료", end: kstDatePlus(6), total: 50, left: 12 },
];

// ── 스킬 응답 빌더 ──
const skill = (outputs, quickReplies) => {
  const template = { outputs };
  if (quickReplies && quickReplies.length) template.quickReplies = quickReplies;
  return { version: "2.0", template };
};
const text = (t) => ({ simpleText: { text: t } });
const qr = (label, messageText) => ({ label, action: "message", messageText: messageText || label });
const btnMsg = (label) => ({ action: "message", label, messageText: label });
const btnLink = (label, url) => ({ action: "webLink", label, webLinkUrl: url });
const MENU = [qr("회원권 조회", "내 회원권 조회"), qr("출석 체크", "출석"), qr("출석 현황", "출석 현황"), qr("가격 안내", "가격 알려줘")];

const normPhone = (s) => String(s || "").replace(/\D/g, "");
function findMember(body) {
  const props = body?.userRequest?.user?.properties || {};
  const id = props.appUserId;
  if (id && APPUSER_TO_PHONE[id]) { const p = APPUSER_TO_PHONE[id]; return { phone: p, ...MEMBERS[p] }; }
  const params = body?.action?.params || {};
  let phone = normPhone(params.phone || params.sys_phone_number || params.전화번호);
  if (!phone || !MEMBERS[phone]) {
    const m = normPhone(body?.userRequest?.utterance).match(/01\d{8,9}/);
    if (m) phone = m[0];
  }
  if (phone && MEMBERS[phone]) return { phone, ...MEMBERS[phone] };
  return null;
}
function extractCode(body) {
  const params = body?.action?.params || {};
  if (params.code) return String(params.code).replace(/\D/g, "");
  const utter = body?.userRequest?.utterance || "";
  const groups = (utter.replace(/01\d{8,9}/g, " ").match(/\d{6}/g)) || [];
  return groups[0] || null;
}

app.get("/", (_req, res) => res.send("gym-skill-server OK"));

// ── 매장 태블릿 키오스크 ──
app.get("/kiosk/code", (req, res) => {
  const gym = req.query.gym || "demo";
  res.json({ code: codeFor(gym, Math.floor(Date.now() / WINDOW)), expiresIn: Math.ceil((WINDOW - (Date.now() % WINDOW)) / 1000) });
});
app.get("/kiosk", (req, res) => {
  const gym = req.query.gym || "demo";
  res.set("Content-Type", "text/html; charset=utf-8").send(`<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>출석 체크인</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
<style>*{box-sizing:border-box}body{font-family:system-ui,sans-serif;background:#1B2430;color:#fff;height:100vh;margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
h1{font-size:22px;color:#FFB020;margin:0 0 24px}#qr{background:#fff;padding:16px;border-radius:16px;line-height:0}
#code{font-size:64px;font-weight:800;letter-spacing:10px;margin:26px 0 6px}#cd{color:#9AA3AD;font-size:15px}</style></head>
<body><h1>💪 ${GYM} 출석 체크인</h1><div id="qr"></div><div id="code">------</div>
<div id="cd">챗봇에서 QR을 스캔하거나 코드를 입력하세요</div>
<script>var gym=${JSON.stringify(gym)};var qr=new QRCode(document.getElementById("qr"),{width:220,height:220});
async function tick(){try{var j=await(await fetch("/kiosk/code?gym="+encodeURIComponent(gym))).json();
document.getElementById("code").textContent=j.code;qr.clear();qr.makeCode(j.code);
document.getElementById("cd").textContent=j.expiresIn+"초 후 코드 변경";}catch(e){}}
tick();setInterval(tick,1000);</script></body></html>`);
});

// ── 관리자: 마일스톤 스캔 ──
app.get("/admin/reward-scan", (_req, res) => {
  const rewards = scanRewards();
  res.json({ scannedAt: new Date().toISOString(), count: rewards.length, rewards,
    note: "매일 새벽 스케줄러가 이 스캔을 실행. 실제 발송은 sendMessage() 스텁을 카카오 비즈메시지(알림톡/친구톡) 또는 발송대행사 API로 교체하세요. 템플릿 사전 승인 필요." });
});

// ── ① 관리자: 재등록 리마인드 스캔 ──
app.get("/admin/renewal-scan", (_req, res) => {
  const reminders = scanRenewals();
  res.json({
    scannedAt: new Date().toISOString(),
    sendEnabled: SEND_ENABLED,
    count: reminders.length,
    reminders,
    note: SEND_ENABLED
      ? "SEND_ENABLED=true — 실제 발송 로직(sendMessage stub) 경유. 템플릿 승인·채널 연결 확인 필요."
      : "SEND_ENABLED가 꺼져 있어 실제 발송은 하지 않고 dry-run 로그만 남깁니다. 채널 연결·템플릿 승인 후 Render 환경변수 SEND_ENABLED=true 로 켜세요.",
  });
});

// ── ② 관리자: PT 수업 전날 리마인드 스캔 ──
app.get("/admin/reservation-scan", (_req, res) => {
  const reminders = scanReservationReminders();
  res.json({ scannedAt: new Date().toISOString(), sendEnabled: SEND_ENABLED, count: reminders.length, reminders,
    note: SEND_ENABLED ? "SEND_ENABLED=true — 실제 발송." : "dry-run 로그만. 채널 연결·템플릿 승인 후 SEND_ENABLED=true." });
});

// ── ④ 관리자: 휴면회원 리마인드 스캔 ──
app.get("/admin/dormant-scan", (_req, res) => {
  const sent = scanDormant();
  res.json({ scannedAt: new Date().toISOString(), sendEnabled: SEND_ENABLED, count: sent.length, dormant: sent,
    note: SEND_ENABLED ? "SEND_ENABLED=true — 실제 발송." : "dry-run 로그만. 채널 연결·템플릿 승인 후 SEND_ENABLED=true." });
});

// ── 관리자: 스캔을 한 번에 ──
app.get("/admin/daily-scan", (_req, res) => {
  const rewards = scanRewards();
  const renewals = scanRenewals();
  const ptReminders = scanReservationReminders();
  const dormant = scanDormant();
  res.json({ scannedAt: new Date().toISOString(), sendEnabled: SEND_ENABLED,
    rewards: { count: rewards.length, items: rewards },
    renewals: { count: renewals.length, items: renewals },
    ptReminders: { count: ptReminders.length, items: ptReminders },
    dormant: { count: dormant.length, items: dormant } });
});

// ── ⑤ 관리자: 리드(상담 신청) 목록 조회(JSON) ──
app.get("/admin/leads", (_req, res) => {
  res.json({ scannedAt: new Date().toISOString(), total: LEADS.length, newCount: newLeads().length, leads: LEADS });
});

// ── ① 원클릭 연장 페이지 ──
app.get("/renew", (req, res) => {
  const phone = normPhone(req.query.phone);
  const t = req.query.t;
  const mem = MEMBERS[phone];
  const bad = (msg) => res.status(400).set("Content-Type", "text/html; charset=utf-8")
    .send(`<!doctype html><meta charset="utf-8"><div style="font-family:system-ui;padding:40px;text-align:center;color:#1B2430">${msg}</div>`);
  if (!mem) return bad("회원 정보를 찾을 수 없어요.");
  if (!validRenewToken(phone, t)) return bad("링크가 올바르지 않거나 만료되었어요.");
  const dday = ddayOf(mem.membership.expire);
  const plans = RENEW_PLANS.map((p) =>
    `<form method="POST" action="/renew/confirm" style="margin:0">
      <input type="hidden" name="phone" value="${phone}">
      <input type="hidden" name="t" value="${t}">
      <input type="hidden" name="plan" value="${p.key}">
      <button type="submit" class="plan"><span>${p.label}</span><b>${won(p.price)}</b></button>
    </form>`).join("");
  res.set("Content-Type", "text/html; charset=utf-8").send(`<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>회원권 연장</title>
<style>*{box-sizing:border-box}body{font-family:system-ui,sans-serif;background:#F4F6F8;color:#1B2430;margin:0;padding:24px;max-width:460px;margin:0 auto}
h1{font-size:20px;color:#FFB020}.card{background:#fff;border-radius:16px;padding:20px;box-shadow:0 2px 12px rgba(0,0,0,.06);margin-bottom:16px}
.muted{color:#7A828A;font-size:14px}.dday{font-size:15px;font-weight:700;color:#E5484D}
.plan{width:100%;display:flex;justify-content:space-between;align-items:center;background:#fff;border:1.5px solid #E3E6EA;border-radius:12px;padding:16px;margin-bottom:10px;font-size:16px;cursor:pointer}
.plan:hover{border-color:#FFB020}.plan b{color:#1B2430}</style></head>
<body><h1>💪 ${GYM} 회원권 연장</h1>
<div class="card"><div style="font-size:18px;font-weight:700">${mem.name} 회원님</div>
<div class="muted" style="margin-top:6px">현재 회원권: ${mem.membership.type}<br>만료일: ${mem.membership.expire} · <span class="dday">${dday === 0 ? "오늘 만료" : "D-" + dday}</span></div></div>
<div class="card"><div style="font-weight:700;margin-bottom:12px">연장 상품을 선택하세요</div>${plans}
<div class="muted" style="margin-top:6px">* 데모 환경: 선택 시 즉시 연장 처리됩니다(실결제 미연동).</div></div>
</body></html>`);
});

app.use(express.urlencoded({ extended: false }));
app.post("/renew/confirm", (req, res) => {
  const phone = normPhone(req.body.phone);
  const t = req.body.t;
  const plan = RENEW_PLANS.find((p) => p.key === req.body.plan);
  const mem = MEMBERS[phone];
  const bad = (msg) => res.status(400).set("Content-Type", "text/html; charset=utf-8")
    .send(`<!doctype html><meta charset="utf-8"><div style="font-family:system-ui;padding:40px;text-align:center">${msg}</div>`);
  if (!mem || !validRenewToken(phone, t) || !plan) return bad("연장 처리에 실패했어요. 링크를 다시 확인해 주세요.");
  const newExpire = extendMembership(phone, plan);
  res.set("Content-Type", "text/html; charset=utf-8").send(`<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>연장 완료</title>
<style>body{font-family:system-ui,sans-serif;background:#F4F6F8;color:#1B2430;margin:0;padding:40px 24px;max-width:460px;margin:0 auto;text-align:center}
.card{background:#fff;border-radius:16px;padding:28px;box-shadow:0 2px 12px rgba(0,0,0,.06)}.ok{font-size:40px}.muted{color:#7A828A;font-size:14px;margin-top:8px}</style></head>
<body><div class="card"><div class="ok">✅</div><h2>연장이 완료됐어요!</h2>
<div>${mem.name} 회원님 · ${plan.label}</div>
<div class="muted">새 만료일: <b>${newExpire}</b><br>결제금액: ${won(plan.price)}<br>카카오톡으로 영수증·안내를 보내드릴게요.</div></div>
</body></html>`);
});

app.post("/skill/welcome", (req, res) => {
  const m = findMember(req.body);
  const hello = m ? `${m.name} 회원님, 안녕하세요! ${GYM}입니다 💪` : `안녕하세요! ${GYM}입니다 💪`;
  const menu = [
    qr("회원권 조회", "내 회원권 조회"), qr("PT 예약", "PT 예약할래"), qr("수업 시간표", "수업 시간표"),
    qr("출석 체크", "출석"), qr("무료 상담 신청", "무료 상담 신청"), qr("가격 안내", "가격 알려줘"),
    qr("시설 안내", "시설 안내"), qr("공지사항", "공지사항"), qr("각종 신청", "신청"), qr("상담원 연결", "상담원 연결"),
  ];
  res.json(skill([{ basicCard: {
    title: hello,
    description: "무엇을 도와드릴까요?\n아래 메뉴를 누르거나 궁금한 점을 입력해 주세요 👇",
    buttons: [btnMsg("가격 안내"), btnMsg("무료 상담 신청"), btnMsg("시설 안내")],
  } }], menu));
});

app.post("/skill/identify", (req, res) => {
  const m = findMember(req.body);
  if (!m) return res.json(skill([text("회원 정보를 찾지 못했어요. 등록하신 전화번호를 입력해 주세요. (예: 010-1234-5678)")]));
  res.json(skill([text(`${m.name} 회원님, 연결이 완료됐어요! ✅\n이제 회원권 조회·수업 예약을 카톡에서 바로 하실 수 있습니다.`)], MENU));
});

app.post("/skill/membership", (req, res) => {
  const m = findMember(req.body);
  if (!m) return res.json(skill([text("회원 정보를 찾지 못했어요. 등록하신 전화번호를 함께 입력해 주세요.\n예) 회원권 01012345678")], [qr("가격 안내", "가격 알려줘")]));
  const dday = ddayOf(m.membership.expire);
  const set = ATT[m.phone] || new Set();
  const g = memberGrade(m);
  const next = myReservations(m.phone)[0];
  const nextStr = next ? `${dateLabel(next.date)} ${next.time} ${next.trainer}` : "예약 없음";
  const ptStr = m.pt.remain > 0 ? `${m.pt.remain}회 (다음 ${nextStr})` : `없음 (다음 ${nextStr})`;
  const lockerStr = m.locker ? `이용 중${m.lockerExpire ? ` · 만료 ${m.lockerExpire}` : ""}` : "미이용";
  const lastPay = (m.payments || []).slice(-1)[0];
  const near = dday <= 7;
  const buttons = [btnMsg("출석 현황")];
  buttons.push(near ? btnLink("재등록/연장", renewLink(m.phone)) : btnMsg("재등록/연장"));
  const stats = `📊 이번 달 ${monthCount(set)}회 방문 (연속 ${streakOf(set)}일) · 이번 주 ${weekCount(set)}회` +
    (lastPay ? `\n💳 최근 결제: ${lastPay.item} ${won(lastPay.amount)} (${lastPay.date})` : "") +
    `\n🏅 누적 결제 ${won(g.spent)} · ${g.icon} ${g.name} 등급`;
  res.json(skill([
    { itemCard: {
      head: { title: `${g.icon} ${m.name}님 마이페이지` },
      itemList: [
        { title: "등급", description: `${g.icon} ${g.name}` },
        { title: "회원권", description: `${m.membership.type} · D-${dday}` },
        { title: "만료일", description: m.membership.expire },
        { title: "PT", description: ptStr },
        { title: "락커", description: lockerStr },
      ],
      buttons,
    } },
    text(stats),
  ], MENU));
});

// ── ① 재등록/연장 스킬 ──
app.post("/skill/renew", (req, res) => {
  const m = findMember(req.body);
  if (!m) return res.json(skill([text("회원 정보를 찾지 못했어요. 등록하신 전화번호를 함께 입력해 주세요.\n예) 연장 01077776666")], [qr("가격 안내", "가격 알려줘")]));
  const dday = ddayOf(m.membership.expire);
  const link = renewLink(m.phone);
  const stage = stageForDday(dday);
  const head = dday === 0 ? "오늘 회원권이 만료돼요 😢"
    : dday <= 7 ? `회원권 만료 ${dday}일 전이에요 ⏰`
    : `회원권이 아직 여유 있어요 (D-${dday}) 😊`;
  const desc = `${m.name} 회원님\n· 현재 회원권: ${m.membership.type}\n· 만료일: ${m.membership.expire} (D-${dday})\n` +
    (stage ? `\n지금 재등록하면 공백 없이 이어서 운동하실 수 있어요.\n아래 버튼으로 원클릭 연장!` : `\n만료 7일 전부터 자동으로 리마인드를 보내드려요.\n미리 연장도 가능해요 👇`);
  res.json(skill([{ basicCard: {
    title: head,
    description: desc,
    buttons: [btnLink("원클릭 연장하기", link), btnMsg("가격 안내")],
  } }], MENU));
});

app.post("/skill/checkin", (req, res) => {
  const gym = (req.body?.action?.params || {}).gym || "demo";
  const m = findMember(req.body);
  if (!m) return res.json(skill([text("회원 정보를 찾지 못했어요. 등록하신 전화번호를 함께 입력해 주세요.\n예) 출석 01012345678 123456")]));
  const code = extractCode(req.body);
  if (!code) return res.json(skill([text("매장 화면의 QR을 스캔하거나 6자리 코드를 입력해 주세요.")], [qr("출석 다시", "출석")]));
  if (!validCode(gym, code)) return res.json(skill([text("❌ 코드가 만료되었거나 올바르지 않아요.\n매장 화면의 최신 코드를 확인해 주세요.")], [qr("출석 다시", "출석")]));
  ATT[m.phone] = ATT[m.phone] || new Set();
  const today = kstDate(0);
  const already = ATT[m.phone].has(today);
  ATT[m.phone].add(today);
  const s = streakOf(ATT[m.phone]);
  const toGoal = Math.max(0, 3 - weekCount(ATT[m.phone]));
  const head = already ? `${badge(s)} 오늘은 이미 출석했어요!` : `${badge(s)} 출석 완료! ${s}일 연속 🔥`;
  const goalLine = toGoal === 0 ? "이번 주 목표(3회) 달성! 🎉" : `주 3회 목표까지 ${toGoal}회 남았어요`;
  res.json(skill([{ basicCard: {
    title: head,
    description: `${m.name} 회원님 (✅ 매장 인증)\n· 연속 출석: ${s}일\n· 이번 달 방문: ${monthCount(ATT[m.phone])}회\n· ${goalLine}`,
    buttons: [btnMsg("출석 현황"), btnMsg("회원권 조회")],
  } }], MENU));
});

app.post("/skill/attendance", (req, res) => {
  const m = findMember(req.body);
  if (!m) return res.json(skill([text("회원 정보를 찾지 못했어요. 등록하신 전화번호를 함께 입력해 주세요.\n예) 출석 현황 01012345678")]));
  const set = ATT[m.phone] || new Set();
  const s = streakOf(set), best = bestStreak(set), mc = monthCount(set), wc = weekCount(set);
  const goal = 12;
  const body = `${badge(s)} ${m.name}님 출석 현황\n\n${attendanceCalendar(set)}\n🟩 출석 · 🔥 오늘 · ⬜ 미방문\n\n` +
    `🔥 연속 ${s}일 (최고 ${best}일)\n📅 이번 주 ${wc}회 · 이번 달 ${mc}회\n🎯 이달 목표 ${progressBar(mc, goal)}`;
  res.json(skill([text(body)], [qr("출석 체크", "출석"), qr("회원권 조회", "내 회원권 조회"), qr("수업 시간표", "수업 시간표")]));
});

// ── ② PT 예약/취소/조회 통합 스킬 ──
const dateLabel = (d) => (d === kstDate(0) ? "오늘" : d === kstDatePlus(1) ? "내일" : d === kstDatePlus(2) ? "모레" : d);
const RESERVE_MENU = [qr("PT 예약", "PT 예약할래"), qr("내 예약 조회", "내 예약 조회"), qr("가격 안내", "가격 알려줘")];

app.post("/skill/reserve", (req, res) => {
  const body = req.body;
  const p = body?.action?.params || {};
  const utterRaw = body?.userRequest?.utterance || "";
  const utter = utterRaw.replace(/01\d{8,9}/g, " ");
  const m = findMember(body);

  // 지난 수업 기록/피드백
  if (/(수업\s*기록|운동\s*기록|지난\s*수업|운동\s*일지)/.test(utter)) {
    if (!m) return res.json(skill([text("기록 조회를 위해 전화번호를 함께 입력해 주세요.\n예) 운동 기록 01012345678")], RESERVE_MENU));
    const past = pastReservations(m.phone);
    if (!past.length) return res.json(skill([text(`${m.name}님, 아직 완료된 수업 기록이 없어요.`)], RESERVE_MENU));
    return res.json(skill([{ itemCard: {
      head: { title: `📒 ${m.name}님 운동 기록` },
      itemList: past.slice(0, 5).map((r) => ({ title: `${r.date} ${r.trainer}`, description: r.feedback || "기록 없음" })),
      buttons: [btnMsg("PT 예약")],
    } }], RESERVE_MENU));
  }
  // 강사 실시간 빈 시간
  if (/(빈\s*시간|가능\s*시간|빈시간)/.test(utter)) {
    const tr = parseTrainer(utter);
    if (!tr) return res.json(skill([text("어떤 트레이너의 빈 시간을 볼까요?")], TRAINER_NAMES.map((t) => qr(t, `${t} 빈시간`))));
    const t0 = kstDate(0), t1 = kstDatePlus(1);
    const fmt = (arr) => (arr.length ? arr.map((h) => hhmm(h)).join(", ") : "마감");
    return res.json(skill([{ basicCard: {
      title: `⏱️ ${tr} 실시간 예약 가능 시간`,
      description: `· 오늘(${t0}): ${fmt(availableHours(tr, t0))}\n· 내일(${t1}): ${fmt(availableHours(tr, t1))}\n\n원하시는 시간으로 바로 예약하세요.`,
      buttons: [btnMsg(`${tr} 오늘 예약`), btnMsg(`${tr} 내일 예약`)],
    } }], RESERVE_MENU));
  }

  if (/취소/.test(utter)) {
    const idm = utterRaw.match(/R\d+/i);
    let target = null;
    if (idm) target = RESERVATIONS.find((r) => r.id.toUpperCase() === idm[0].toUpperCase() && r.status === "confirmed");
    else if (m) { const list = myReservations(m.phone); if (list.length === 1) target = list[0]; }
    if (!target) {
      if (m) {
        const list = myReservations(m.phone);
        if (!list.length) return res.json(skill([text("취소할 예약이 없어요.")], RESERVE_MENU));
        return res.json(skill([text("취소할 예약을 선택해 주세요 👇")],
          list.map((r) => qr(`${dateLabel(r.date)} ${r.time} ${r.trainer}`, `예약취소 ${r.id} ${m.phone}`))));
      }
      return res.json(skill([text("취소하실 예약자 전화번호를 함께 입력해 주세요.\n예) 예약취소 01012345678")], RESERVE_MENU));
    }
    target.status = "canceled";
    return res.json(skill([{ basicCard: {
      title: "🗑️ 예약이 취소됐어요",
      description: `${target.name}님 · ${dateLabel(target.date)}(${target.date}) ${target.time} ${target.trainer}\n다시 예약하시려면 'PT 예약'을 눌러주세요.`,
      buttons: [btnMsg("PT 예약"), btnMsg("내 예약 조회")],
    } }], RESERVE_MENU));
  }

  if (/(내\s*예약|예약\s*조회|예약\s*내역|예약\s*확인)/.test(utter)) {
    if (!m) return res.json(skill([text("예약자 확인을 위해 전화번호를 함께 입력해 주세요.\n예) 내 예약 조회 01012345678")], RESERVE_MENU));
    const list = myReservations(m.phone);
    if (!list.length) return res.json(skill([text(`${m.name}님, 예정된 PT 예약이 없어요.\n'PT 예약'으로 새 수업을 잡아보세요!`)], RESERVE_MENU));
    return res.json(skill([{ itemCard: {
      head: { title: `📅 ${m.name}님 예약 내역${m.noShow ? ` · 노쇼 ${m.noShow}회` : ""}` },
      itemList: list.map((r) => ({ title: `${dateLabel(r.date)} ${r.time}`, description: `${r.trainer} (${r.id})` })),
      buttons: [...list.slice(0, 2).map((r) => btnMsg(`예약취소 ${r.id} ${m.phone}`)), btnMsg("운동 기록")],
    } }], RESERVE_MENU));
  }

  const trainer = parseTrainer(utter) || (TRAINERS[p.trainer] ? p.trainer : null);
  if (!trainer) {
    return res.json(skill([text("어떤 트레이너로 예약할까요? 전문 분야를 참고해 선택해 주세요 💪\n" +
      TRAINER_NAMES.map((t) => `· ${t} — ${TRAINERS[t].specialty}`).join("\n"))],
      TRAINER_NAMES.map((t) => qr(t, `${t} 예약`))));
  }
  const date = parseDate(utter) || p.date || p.sys_date;
  if (!date) {
    return res.json(skill([text(`${trainer} 트레이너로 예약할게요.\n원하시는 날짜를 선택해 주세요 📅`)],
      [qr("오늘", `${trainer} 오늘 예약`), qr("내일", `${trainer} 내일 예약`), qr("모레", `${trainer} 모레 예약`)]));
  }
  const avail = availableHours(trainer, date);
  const hour = parseHour(utter);
  const time = hour != null ? hhmm(hour) : (p.time || p.sys_time);
  if (!time) {
    if (!avail.length) return res.json(skill([text(`${trainer} 트레이너는 ${dateLabel(date)}(${date}) 예약 가능한 시간이 없어요 😢\n다른 날짜를 선택해 주세요.`)],
      [qr("오늘", `${trainer} 오늘 예약`), qr("내일", `${trainer} 내일 예약`), qr("모레", `${trainer} 모레 예약`)]));
    return res.json(skill([text(`${trainer} 트레이너 ${dateLabel(date)}(${date}) 가능 시간이에요.\n원하시는 시간을 선택해 주세요 ⏰`)],
      avail.map((h) => qr(hhmm(h), `${trainer} ${date} ${hhmm(h)} 예약`))));
  }
  if (!m) return res.json(skill([text(`예약을 확정하려면 예약자 전화번호를 함께 입력해 주세요.\n예) ${trainer} ${dateLabel(date)} ${time} 예약 01012345678`)], RESERVE_MENU));
  if (!avail.includes(parseInt(time, 10))) {
    return res.json(skill([text(`앗, ${trainer} 트레이너 ${dateLabel(date)} ${time}은(는) 방금 마감됐어요 😢\n다른 시간을 선택해 주세요.`)],
      availableHours(trainer, date).map((h) => qr(hhmm(h), `${trainer} ${date} ${hhmm(h)} 예약`))));
  }
  const r = createReservation(m, trainer, date, time);
  res.json(skill([{ basicCard: {
    title: "✅ PT 예약 완료",
    description: `${m.name}님 · ${dateLabel(date)}(${date}) ${time}\n${trainer} (${TRAINERS[trainer].specialty})\n예약번호 ${r.id}\n\n📋 준비물: 운동복·실내화·수건·물\n⏰ 10분 전 도착 · 식사는 2시간 전 권장\n수업 전날 리마인드를 보내드릴게요!`,
    buttons: [btnMsg(`예약취소 ${r.id} ${m.phone}`), btnMsg("내 예약 조회")],
  } }], RESERVE_MENU));
});

// ── ⑤ 무료 상담/체험 신청(리드 수집) 스킬 ──
app.post("/skill/lead", (req, res) => {
  const utterRaw = req.body?.userRequest?.utterance || "";
  const params = req.body?.action?.params || {};
  const phone = normPhone(params.phone || (utterRaw.match(/01\d{8,9}/) || [])[0]);
  if (!phone) {
    return res.json(skill([{ basicCard: {
      title: "🎟️ 무료 상담·체험 신청",
      description: "성함과 연락처, 관심분야를 함께 남겨주세요.\n담당 트레이너가 순차적으로 연락드릴게요!\n\n예) 상담신청 홍길동 01012345678 다이어트",
      buttons: [btnMsg("가격 안내"), btnMsg("시설 안내")],
    } }], [qr("가격 안내", "가격 알려줘"), qr("시설 안내", "시설 안내")]));
  }
  const name = parseLeadName(utterRaw) || params.name || "고객";
  const interest = parseInterest(utterRaw) || params.interest || null;
  const lead = createLead({ name, phone, interest });
  sendMessage("owner", { channel: "알림톡(정보성)", kind: "lead",
    message: `[${GYM}] 신규 상담 신청 · ${name}(${phone})${interest ? " · " + interest : ""} · 접수 ${lead.id}` });
  res.json(skill([{ basicCard: {
    title: "✅ 상담 신청이 접수됐어요!",
    description: `${name}님 (${maskPhone(phone)})${interest ? "\n· 관심분야: " + interest : ""}\n· 접수번호: ${lead.id}\n\n영업일 기준 1일 이내에 담당자가 연락드릴게요. 감사합니다 🙌`,
    buttons: [btnMsg("가격 안내"), btnMsg("시설 안내")],
  } }], MENU));
});

// ── 회원권 일시정지(홀딩) 신청 스킬 ──
app.post("/skill/hold", (req, res) => {
  const m = findMember(req.body);
  const utter = req.body?.userRequest?.utterance || "";
  if (!m) return res.json(skill([{ basicCard: {
    title: "⏸️ 회원권 일시정지 신청",
    description: "여행·부상 등으로 잠시 쉬실 때 회원권을 정지할 수 있어요.\n등록 전화번호와 정지 일수를 함께 남겨주세요.\n\n예) 일시정지 01012345678 14일",
    buttons: [btnMsg("회원권 조회")],
  } }], MENU));
  const days = parseDays(utter);
  if (!days) return res.json(skill([text(`${m.name} 회원님, 며칠간 정지할까요? 일수를 함께 입력해 주세요.\n예) 일시정지 ${m.phone} 14일`)],
    [qr("7일", `일시정지 ${m.phone} 7일`), qr("14일", `일시정지 ${m.phone} 14일`), qr("30일", `일시정지 ${m.phone} 30일`)]));
  const newExpire = holdMembership(m.phone, days);
  const r = createRequest({ type: "일시정지", name: m.name, phone: m.phone, detail: `${days}일` });
  sendMessage("owner", { channel: "알림톡(정보성)", kind: "hold", message: `[${GYM}] 일시정지 신청 · ${m.name}(${m.phone}) · ${days}일 · 접수 ${r.id}` });
  res.json(skill([{ basicCard: {
    title: "✅ 일시정지 신청 완료",
    description: `${m.name} 회원님 · ${days}일 정지\n· 만료일이 ${newExpire}로 연장됐어요\n· 접수번호: ${r.id}\n\n정지 기간 종료 후 자동 재개됩니다.`,
    buttons: [btnMsg("회원권 조회")],
  } }], MENU));
});

// ── GX(그룹수업) 시간표 조회 + 예약 스킬 ──
app.post("/skill/gx", (req, res) => {
  const utter = req.body?.userRequest?.utterance || "";
  const m = findMember(req.body);
  const cls = findGx(utter);
  if (cls && /(예약|신청|등록)/.test(utter)) {
    if (!m) return res.json(skill([text(`${cls.name} 수업 예약을 위해 전화번호를 함께 입력해 주세요.\n예) ${cls.name} 예약 01012345678`)], [qr("시간표 보기", "수업 시간표")]));
    const r = bookGx(cls.id, m.phone);
    if (r.full) return res.json(skill([text(`😢 ${cls.name}(${cls.time}) 수업은 정원(${cls.cap}명)이 찼어요. 다른 수업을 선택해 주세요.`)], [qr("시간표 보기", "수업 시간표")]));
    return res.json(skill([{ basicCard: {
      title: r.already ? "이미 예약된 수업이에요" : "✅ 수업 예약 완료",
      description: `${m.name}님 · ${cls.name} ${cls.time}\n강사: ${cls.instructor}\n현재 ${gxBookedCount(cls.id)}/${cls.cap}명`,
      buttons: [btnMsg("수업 시간표")],
    } }], MENU));
  }
  return res.json(skill([{ listCard: {
    header: { title: "🧘 오늘의 그룹수업(GX) 시간표" },
    items: GX_SCHEDULE.map((c) => ({ title: `${c.time} ${c.name}`, description: `${c.instructor} · ${gxBookedCount(c.id)}/${c.cap}명` })),
    buttons: [btnMsg("스피닝 예약"), btnMsg("요가 예약")],
  } }], [qr("스피닝 예약", "스피닝 예약"), qr("요가 예약", "요가 예약"), qr("필라테스 예약", "필라테스 예약")]));
});

// ── 공지·운영 안내 스킬 ──
app.post("/skill/notice", (_req, res) => {
  if (!NOTICES.length) return res.json(skill([text("현재 등록된 공지사항이 없어요. 정상 운영 중입니다 😊")], MENU));
  return res.json(skill([{ listCard: {
    header: { title: `📢 ${GYM} 공지사항` },
    items: NOTICES.slice(0, 5).map((n) => ({ title: n.title, description: n.body })),
    buttons: [btnMsg("영업시간"), btnMsg("가격 안내")],
  } }], MENU));
});

// ── 락커·대여 안내/신청 스킬 ──
app.post("/skill/rental", (req, res) => {
  const utter = req.body?.userRequest?.utterance || "";
  const m = findMember(req.body);
  if (/(신청|대여할|빌|등록)/.test(utter)) {
    if (!m) return res.json(skill([text("대여 신청을 위해 전화번호를 함께 입력해 주세요.\n예) 락커 신청 01012345678")], [qr("대여 안내", "대여 안내")]));
    const item = ["락커", "운동복", "수건"].find((k) => utter.includes(k)) || "락커";
    const r = createRequest({ type: "대여신청", name: m.name, phone: m.phone, detail: item });
    return res.json(skill([{ basicCard: {
      title: "✅ 대여 신청 접수",
      description: `${m.name}님 · ${item} 대여 신청\n· 접수번호: ${r.id}\n데스크에서 배정 후 안내드릴게요.`,
      buttons: [btnMsg("대여 안내")],
    } }], MENU));
  }
  return res.json(skill([{ listCard: {
    header: { title: "🔐 락커·대여 안내" },
    items: Object.entries(RENTAL_ITEMS).map(([k, v]) => ({ title: k, description: v })),
    buttons: [btnMsg("락커 신청"), btnMsg("운동복 신청")],
  } }], MENU));
});

// ── 분실물 문의/신고 스킬 ──
app.post("/skill/lostfound", (req, res) => {
  const utter = req.body?.userRequest?.utterance || "";
  const m = findMember(req.body);
  if (/(신고|잃|두고|분실했|맡)/.test(utter) && !/(목록|보관|조회|있)/.test(utter)) {
    const phone = m ? m.phone : (normPhone((utter.match(/01\d{8,9}/) || [])[0]) || null);
    const r = createRequest({ type: "분실물신고", name: m ? m.name : "고객", phone, detail: utter.replace(/01\d{8,9}/g, "").trim().slice(0, 40) });
    return res.json(skill([{ basicCard: {
      title: "✅ 분실물 신고 접수",
      description: `접수번호: ${r.id}\n보관 중인 물품이 확인되면 연락드릴게요.\n\n현재 보관 중인 분실물도 아래에서 확인하실 수 있어요.`,
      buttons: [btnMsg("분실물 목록")],
    } }], MENU));
  }
  if (!LOSTFOUND.length) return res.json(skill([text("현재 보관 중인 분실물이 없어요.")], [qr("분실물 신고", "분실물 신고")]));
  return res.json(skill([{ listCard: {
    header: { title: "🧳 보관 중인 분실물" },
    items: LOSTFOUND.slice(0, 5).map((l) => ({ title: l.item, description: `${l.where} · ${l.date} 발견` })),
    buttons: [btnMsg("분실물 신고")],
  } }], MENU));
});

// ── 주차 등록 스킬 ──
app.post("/skill/parking", (req, res) => {
  const utter = req.body?.userRequest?.utterance || "";
  const m = findMember(req.body);
  const car = parseCar(utter);
  if (!car) return res.json(skill([{ basicCard: {
    title: "🚗 주차 등록",
    description: "차량번호를 함께 입력해 주세요. 지하주차장 2시간 무료 등록됩니다.\n\n예) 주차등록 12가3456",
    buttons: [btnMsg("주차 안내")],
  } }], MENU));
  if (m) PARKING[m.phone] = car;
  const r = createRequest({ type: "주차등록", name: m ? m.name : "고객", phone: m ? m.phone : null, detail: car });
  return res.json(skill([{ basicCard: {
    title: "✅ 주차 등록 완료",
    description: `차량번호: ${car}\n2시간 무료 주차가 등록됐어요.\n접수번호: ${r.id}`,
    buttons: [btnMsg("주차 안내")],
  } }], MENU));
});

// ── 각종 신청 통합(환불·양도·정보변경) 스킬 ──
app.post("/skill/request", (req, res) => {
  const utter = req.body?.userRequest?.utterance || "";
  const m = findMember(req.body);
  const type = /환불/.test(utter) ? "환불" : /양도/.test(utter) ? "양도" : /(정보변경|연락처|번호변경|정보 변경)/.test(utter) ? "정보변경" : null;
  if (!type) return res.json(skill([text("어떤 신청을 도와드릴까요? 아래에서 선택해 주세요.")],
    [qr("환불 신청", "환불 신청"), qr("양도 신청", "양도 신청"), qr("정보 변경", "정보 변경"), qr("일시정지", "일시정지 신청")]));
  if (!m) return res.json(skill([text(`${type} 신청을 위해 등록 전화번호를 함께 입력해 주세요.\n예) ${type} 신청 01012345678`)], MENU));
  const r = createRequest({ type, name: m.name, phone: m.phone, detail: utter.replace(/01\d{8,9}/g, "").trim().slice(0, 40) });
  sendMessage("owner", { channel: "알림톡(정보성)", kind: "request", message: `[${GYM}] ${type} 신청 · ${m.name}(${m.phone}) · 접수 ${r.id}` });
  return res.json(skill([{ basicCard: {
    title: `✅ ${type} 신청 접수`,
    description: `${m.name}님 · ${type} 신청\n· 접수번호: ${r.id}\n담당자가 확인 후 연락드릴게요.`,
    buttons: [btnMsg("회원권 조회")],
  } }], MENU));
});

app.post("/skill/faq", (req, res) => {
  const p = req.body?.action?.params || {};
  const utter = req.body?.userRequest?.utterance || "";
  let answer = FAQ[p.category || p.faq || ""] || FAQ[Object.keys(FAQ).find((k) => utter.includes(k))];
  if (!answer) return res.json(skill([text("어떤 점이 궁금하세요? 아래에서 선택해 주세요.")],
    [qr("가격", "가격 알려줘"), qr("영업시간", "영업시간"), qr("주차", "주차되나요"), qr("위치", "위치 알려줘"), qr("상담원 연결", "상담원 연결")]));
  res.json(skill([text(answer)], MENU));
});

// ── 매장 소개(브랜딩) 기능 — 존별 카드 캐러셀 ──
// 이미지는 데모용 플레이스홀더(실제 매장 사진 URL로 교체하면 그대로 노출됨).
const facilityImg = (label) => `https://placehold.co/800x400/1B2430/FFB020.png?text=${encodeURIComponent(label)}`;
const FACILITIES = [
  {
    title: "💪 헬스존", img: "GYM ZONE", peak: [18, 19, 20],
    description: "· 유산소 머신 20대 (트레드밀·싸이클·천정)\n· 웨이트 머신 30종 (라이프피트니스·해머스트렝스)\n· 프리웨이트 덤벨 2~50kg · 파워랙 4대",
    buttons: [btnMsg("가격 안내"), btnMsg("PT 예약")],
  },
  {
    title: "🧘 GX룸", img: "GX ROOM", peak: [19, 20],
    description: "· 스피닝 바이크 20대 · 층고 3.5m\n· 요가·필라테스·줌바 그룹수업\n· 전문 사운드·무대 조명 시스템",
    buttons: [btnMsg("수업 시간표")],
  },
  {
    title: "🚿 샤워·사우나", img: "SHOWER & SAUNA", peak: [20, 21],
    description: "· 개인 샤워부스 8칸 · 건식 사우나\n· 수건·드라이어·어메니티 무료\n· 운동복 대여 (1회 2,000원)",
    buttons: [btnMsg("대여 안내")],
  },
  {
    title: "📊 인바디존", img: "INBODY",
    description: "· 체성분 분석기 InBody 970 상시 무료\n· 측정 후 트레이너 1:1 결과 상담\n· 목표별 맞춤 운동 처방",
    buttons: [btnMsg("PT 예약")],
  },
  {
    title: "🔐 라커·편의시설", img: "LOCKER & LOUNGE",
    description: "· 개인 락커 300개 (월 20,000원)\n· 무인 정수기 · 단백질바 자판기\n· 라운지·무료 Wi-Fi",
    buttons: [btnMsg("대여 안내")],
  },
  {
    title: "🚗 주차장", img: "PARKING",
    description: "· 지하주차장 40면 · 2시간 무료\n· 초과 시 10분당 500원\n· 챗봇에서 차량번호 바로 등록",
    buttons: [btnMsg("주차 등록")],
  },
];
app.post("/skill/facility", (_req, res) => {
  res.json(skill([{ carousel: { type: "basicCard", items: FACILITIES.map((f) => {
    let desc = f.description;
    if (f.peak) { const c = zoneCongestion(f.peak); desc = `지금 ${c.icon} ${c.label}\n${desc}`; }
    return { title: f.title, description: desc, thumbnail: { imageUrl: facilityImg(f.img) }, buttons: f.buttons };
  }) } }], [qr("체험 상담", "무료 상담 신청"), qr("수업 시간표", "수업 시간표"), qr("위치 안내", "위치 알려줘"), qr("가격 안내", "가격 알려줘")]));
});

app.post("/skill/event", (_req, res) => {
  const items = EVENTS.map((e) => {
    const dday = ddayOf(e.end);
    const lines = [`⏰ D-${dday} 마감 (~${e.end})`];
    if (e.total > 0) lines.push(`🎟️ 선착순 ${e.left}/${e.total}명 남음`);
    lines.push(e.desc);
    return { title: e.title, description: lines.join("\n"), buttons: [btnMsg("무료 상담 신청"), btnMsg("가격 안내")] };
  });
  res.json(skill([{ carousel: { type: "basicCard", items } }],
    [qr("무료 상담", "무료 상담 신청"), qr("가격 안내", "가격 알려줘")]));
});

const hoursRange = (hrs) => `${Math.min(...hrs)}시~${Math.max(...hrs)}시`;
app.post("/skill/trainer", (_req, res) => {
  const img = (t) => `https://placehold.co/800x400/1B2430/FFB020.png?text=${encodeURIComponent(t)}`;
  const items = Object.values(TRAINERS).map((t) => ({
    title: `${t.name} · ${t.specialty}`,
    description: `⭐ ${t.rating} (후기 ${t.reviews}) · ${t.career}\n📌 ${t.specialty} · ${t.clients}\n📜 ${t.certs}\n🎯 대표: ${t.program}\n🕒 담당 ${hoursRange(t.hours)} (평일)\n💬 "${t.intro}"`,
    thumbnail: { imageUrl: img(t.photo) },
    buttons: [btnMsg(`${t.name} 예약`), btnMsg(`${t.name} 빈시간`)],
  }));
  res.json(skill([{ carousel: { type: "basicCard", items } }],
    [qr("PT 예약", "PT 예약할래"), qr("무료 상담", "무료 상담 신청"), qr("가격 안내", "가격 알려줘")]));
});

app.post("/skill/pt", (_req, res) => {
  res.json(skill([{ basicCard: {
    title: "💪 PT 안내",
    description: "1:1 맞춤 프로그램으로 목표(다이어트·근력·재활)에 맞춰 트레이너를 매칭해 드려요.\n· 10/20/30회 단위 등록\n· 첫 상담·체험 무료",
    buttons: [btnMsg("PT 예약"), btnMsg("강사 소개")],
  } }], [qr("강사 소개", "강사 소개"), qr("PT 예약", "PT 예약할래"), qr("가격 안내", "가격 알려줘")]));
});

app.post("/skill/fallback", (_req, res) => {
  res.json(skill([text("담당자가 정확히 안내드릴게요.\n상담 가능 시간(평일 10~20시)에 순차적으로 답변드립니다.\n성함과 연락처를 남겨주시겠어요?")],
    [qr("무료 상담 신청", "무료 상담 신청"), qr("처음으로", "메뉴")]));
});

// ── ③ 사장님용 관리자 조회 스킬 ──
// 주의(운영): 실제 배포 시 이 블록은 사장님 전용 채널/봇 또는 관리자 인증 뒤에 두세요.
const ADMIN_MENU = [qr("오늘 출석", "오늘 출석 명단"), qr("이번 주 신규", "이번 주 신규 등록"), qr("만료 임박", "만료 임박 명단"), qr("휴면 회원", "휴면 회원 명단"), qr("상담 접수", "상담 접수 현황"), qr("요청 접수", "요청 접수 현황")];
app.post("/skill/admin", (req, res) => {
  const utter = req.body?.userRequest?.utterance || "";
  const att = todayAttendanceList();
  if (/요청/.test(utter)) {
    const rs = newRequests();
    return res.json(skill([{ itemCard: {
      head: { title: `🗂️ 신규 요청 ${rs.length}건 (정지·환불·대여·분실물·주차 등)` },
      itemList: rs.length ? rs.slice(-10).reverse().map((r) => ({ title: `${r.type} · ${r.name}`, description: `${r.phone || "-"}${r.detail ? " · " + r.detail : ""} · ${r.at}` })) : [{ title: "없음", description: "접수된 요청이 없어요" }],
      buttons: [btnMsg("상담 접수 현황")],
    } }], ADMIN_MENU));
  }
  if (/상담|리드/.test(utter)) {
    const ls = newLeads();
    return res.json(skill([{ itemCard: {
      head: { title: `🎟️ 신규 상담 신청 ${ls.length}건` },
      itemList: ls.length ? ls.slice(-10).reverse().map((l) => ({ title: `${l.name}${l.interest ? " (" + l.interest + ")" : ""}`, description: `${l.phone} · ${l.at}` })) : [{ title: "없음", description: "접수된 상담이 없어요" }],
      buttons: [btnMsg("오늘 출석 명단")],
    } }], ADMIN_MENU));
  }
  if (/출석/.test(utter)) {
    return res.json(skill([text(`📊 오늘 출석 ${att.length}명\n${att.length ? att.join(", ") : "아직 없음"}`)], ADMIN_MENU));
  }
  if (/신규|가입|등록/.test(utter)) {
    const nw = newThisWeek();
    return res.json(skill([text(`🆕 이번 주 신규 등록 ${nw.length}명\n${nw.length ? nw.map((n) => `· ${n.name} (${n.joinDate})`).join("\n") : "없음"}`)], ADMIN_MENU));
  }
  if (/만료|재등록|연장|임박/.test(utter)) {
    const exp = expiringSoon(7);
    return res.json(skill([{ itemCard: {
      head: { title: `⏰ 만료 임박 ${exp.length}명 (7일 내)` },
      itemList: exp.length ? exp.map((e) => ({ title: e.name, description: `D-${e.dday} · 만료 ${e.expire}` })) : [{ title: "없음", description: "임박 회원이 없어요" }],
    } }], ADMIN_MENU));
  }
  if (/휴면|미방문/.test(utter)) {
    const dorm = dormantMembers(14);
    return res.json(skill([{ itemCard: {
      head: { title: `💤 휴면 회원 ${dorm.length}명 (2주+ 미방문)` },
      itemList: dorm.length ? dorm.map((d) => ({ title: d.name, description: d.lastVisit ? `${d.days}일째 미방문` : "방문 기록 없음" })) : [{ title: "없음", description: "휴면 회원이 없어요" }],
    } }], ADMIN_MENU));
  }
  // 요약 대시보드
  const nw = newThisWeek(), exp = expiringSoon(7), dorm = dormantMembers(14), lead = newLeads(), reqs = newRequests();
  res.json(skill([{ itemCard: {
    head: { title: `👔 ${GYM} 사장님 대시보드` },
    itemList: [
      { title: "오늘 출석", description: `${att.length}명` },
      { title: "이번 주 신규", description: `${nw.length}명` },
      { title: "상담 신청(신규)", description: `${lead.length}건` },
      { title: "요청 접수(정지·환불 등)", description: `${reqs.length}건` },
      { title: "만료 임박 / 휴면", description: `${exp.length}명 / ${dorm.length}명` },
    ],
    buttons: [btnMsg("상담 접수 현황"), btnMsg("요청 접수 현황")],
  } }], ADMIN_MENU));
});

// ── 매일 스케줄러(인프로세스) ──
let _lastScanDate = null;
function schedulerTick() {
  const nowKst = new Date(Date.now() + 9 * 3600000);
  const hh = nowKst.getUTCHours();
  const dateStr = nowKst.toISOString().slice(0, 10);
  if (hh === SCAN_HOUR_KST && _lastScanDate !== dateStr) {
    _lastScanDate = dateStr;
    const rewards = scanRewards();
    const renewals = scanRenewals();
    const ptReminders = scanReservationReminders();
    const dormant = scanDormant();
    console.log(`[스케줄러 ${dateStr} ${String(hh).padStart(2, "0")}시 KST] 리워드 ${rewards.length} / 재등록 ${renewals.length} / PT전날 ${ptReminders.length} / 휴면 ${dormant.length} (SEND_ENABLED=${SEND_ENABLED})`);
  }
}
setInterval(schedulerTick, 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`gym-skill-server listening on ${PORT} (SEND_ENABLED=${SEND_ENABLED}, SCAN_HOUR_KST=${SCAN_HOUR_KST})`));
