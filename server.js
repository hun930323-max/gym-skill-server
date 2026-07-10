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
ATT["01012345678"] = new Set([kstDate(1), kstDate(2), kstDate(3), kstDate(4), kstDate(5), kstDate(6), kstDate(7)]); // 홍길동: 7일 연속
ATT["01099998888"] = new Set([kstDate(3), kstDate(8), kstDate(12)]); // 김영희: 뜸함
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
  //       템플릿 사전 승인 필요. 채널 연결되면 아래를 실제 API 호출로 교체.
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
// 마일스톤 엔진과 동일한 패턴(스캔 + 중복방지 로그 + sendMessage 게이트웨이).
const RENEWAL_STAGES = [
  { key: "dday", dday: 0, label: "D-day", channel: "알림톡(정보성)" },
  { key: "d3", dday: 3, label: "D-3", channel: "알림톡(정보성)" },
  { key: "d7", dday: 7, label: "D-7", channel: "알림톡(정보성)" },
]; // dday 오름차순 유지

// 연장 상품(재등록 옵션). 실제 결제 연동 전까지는 데모 연장으로 처리.
const RENEW_PLANS = [
  { key: "1m", label: "헬스 1개월", price: 99000, months: 1 },
  { key: "3m", label: "헬스 3개월", price: 259000, months: 3 },
  { key: "6mp", label: "헬스+필라 6개월", price: 690000, months: 6 },
];
const won = (n) => n.toLocaleString("ko-KR") + "원";

// 서명된 원클릭 링크(전화번호 변조 방지)
function renewToken(phone) {
  return crypto.createHmac("sha256", RENEW_SECRET).update(String(phone)).digest("hex").slice(0, 12);
}
function renewLink(phone) {
  return `${BASE_URL}/renew?phone=${phone}&t=${renewToken(phone)}`;
}
function validRenewToken(phone, t) {
  return t && renewToken(phone) === t;
}

// 현재 dday에 해당하는 리마인드 단계(가장 임박한 브래킷). 스캔이 하루 걸러도 중복/누락 없이 동작.
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

// 매월 갱신: 오늘 또는 현재 만료일 중 더 늦은 날짜 기준으로 months 만큼 연장
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

// ── 관리자: 마일스톤 스캔(스케줄러가 매일 호출) ──
app.get("/admin/reward-scan", (_req, res) => {
  const rewards = scanRewards();
  res.json({ scannedAt: new Date().toISOString(), count: rewards.length, rewards,
    note: "매일 새벽 스케줄러가 이 스캔을 실행. 실제 발송은 sendMessage() 스텁을 카카오 비즈메시지(알림톡/친구톡) 또는 발송대행사 API로 교체하세요. 템플릿 사전 승인 필요." });
});

// ── ① 관리자: 재등록 리마인드 스캔(스케줄러/외부 cron이 매일 호출) ──
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

// ── ① 관리자: 두 스캔을 한 번에(하루 1회 실행용) ──
app.get("/admin/daily-scan", (_req, res) => {
  const rewards = scanRewards();
  const renewals = scanRenewals();
  res.json({ scannedAt: new Date().toISOString(), sendEnabled: SEND_ENABLED,
    rewards: { count: rewards.length, items: rewards },
    renewals: { count: renewals.length, items: renewals } });
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

// 폼 전송 파싱용
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
    qr("회원권 조회", "내 회원권 조회"), qr("PT 예약", "PT 예약할래"), qr("출석 체크", "출석"),
    qr("가격 안내", "가격 알려줘"), qr("시설 안내", "시설 안내"), qr("강사 소개", "강사 소개"),
    qr("이달의 이벤트", "이벤트"), qr("상담원 연결", "상담원 연결"),
  ];
  res.json(skill([{ basicCard: {
    title: hello,
    description: "무엇을 도와드릴까요?\n아래 메뉴를 누르거나 궁금한 점을 입력해 주세요 👇",
    buttons: [btnMsg("가격 안내"), btnMsg("시설 안내"), btnMsg("상담원 연결")],
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
  const pt = m.pt.remain > 0 ? `${m.pt.remain}회 남음 (${m.pt.trainer})` : "없음";
  const near = dday <= 7; // 만료 임박 시 연장 버튼을 웹링크로
  const buttons = [btnMsg("출석 체크")];
  buttons.push(near ? btnLink("재등록/연장", renewLink(m.phone)) : btnMsg("재등록/연장"));
  res.json(skill([{ itemCard: {
    head: { title: `${m.name} 회원님 이용현황` },
    itemList: [
      { title: "회원권", description: m.membership.type },
      { title: "만료일", description: m.membership.expire },
      { title: "남은 기간", description: `${dday}일 남음 (D-${dday})` },
      { title: "PT", description: pt },
      { title: "락커", description: m.locker ? "이용 중" : "미이용" },
    ],
    buttons,
  } }], MENU));
});

// ── ① 재등록/연장 스킬(봇테스트용) ──
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
  const s = streakOf(set);
  res.json(skill([{ itemCard: {
    head: { title: `${badge(s)} ${m.name}님 출석 현황` },
    itemList: [
      { title: "연속 출석", description: `${s}일` },
      { title: "이번 주", description: `${weekCount(set)}회 / 목표 3회` },
      { title: "이번 달", description: `${monthCount(set)}회` },
    ],
    buttons: [btnMsg("출석 체크")],
  } }], MENU));
});

app.post("/skill/reserve", (req, res) => {
  const p = req.body?.action?.params || {};
  const trainer = p.trainer || p.코치 || "상관없음";
  const date = p.date || p.sys_date || p.날짜;
  const time = p.time || p.sys_time || p.시간;
  if (!date || !time) return res.json(skill([text(`${trainer} 트레이너로 예약을 도와드릴게요.\n원하시는 날짜와 시간을 선택해 주세요.`)],
    [qr("김코치", "김코치 예약"), qr("이코치", "이코치 예약"), qr("상관없음", "상관없음 예약")]));
  res.json(skill([{ basicCard: {
    title: "✅ 예약 완료",
    description: `${date} ${time}\n${trainer} PT 예약이 완료됐어요!\n하루 전에 리마인드 보내드릴게요.`,
    buttons: [btnMsg("예약 취소"), btnMsg("일정 변경")],
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

// ── 매장 소개(브랜딩) 기능 ──
app.post("/skill/facility", (_req, res) => {
  res.json(skill([{ listCard: {
    header: { title: `🏋️ ${GYM} 시설 안내` },
    items: [
      { title: "헬스존", description: "최신 유산소·웨이트 머신 50대+" },
      { title: "GX룸", description: "스피닝·요가·필라테스 그룹수업" },
      { title: "샤워·사우나", description: "개인 샤워부스, 사우나, 수건 무료" },
      { title: "인바디존", description: "체성분 측정 상시 무료" },
      { title: "주차", description: "지하주차장 2시간 무료" },
    ],
    buttons: [btnMsg("체험 상담"), btnMsg("위치 안내")],
  } }], MENU));
});

app.post("/skill/event", (_req, res) => {
  res.json(skill([{ basicCard: {
    title: "🎉 이달의 이벤트",
    description: "· 신규 3개월 등록 시 PT 2회 무료 + 등록비 면제\n· 친구 추천 시 양쪽 회원권 2주 연장\n· 인바디 무료 체험 (7월 한정)",
    buttons: [btnMsg("체험 상담"), btnMsg("가격 안내")],
  } }], MENU));
});

app.post("/skill/trainer", (_req, res) => {
  res.json(skill([{ carousel: { type: "basicCard", items: [
    { title: "김코치", description: "웨이트·체형교정 전문 · 경력 10년\n\"자세부터 잡아드립니다\"", buttons: [btnMsg("김코치 예약")] },
    { title: "이코치", description: "다이어트·재활 전문 · 경력 7년\n\"무리 없이 꾸준하게\"", buttons: [btnMsg("이코치 예약")] },
    { title: "박코치", description: "필라테스·바디프로필 전문 · 경력 5년\n\"라인을 만드는 운동\"", buttons: [btnMsg("박코치 예약")] },
  ] } }], MENU));
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
    [qr("상담 신청", "상담 신청합니다"), qr("처음으로", "메뉴")]));
});

// ── ① 매일 스케줄러(인프로세스) ──
// 매일 SCAN_HOUR_KST 시각에 리워드·재등록 스캔 실행. 하루 1회만.
// 주의: Render 무료 인스턴스는 미사용 시 잠들어 인프로세스 타이머가 안 뜰 수 있음.
//       안정적 운영은 외부 cron(예: cron-job.org)이 매일 GET /admin/daily-scan 을 호출하도록 설정 권장.
let _lastScanDate = null;
function schedulerTick() {
  const nowKst = new Date(Date.now() + 9 * 3600000);
  const hh = nowKst.getUTCHours();
  const dateStr = nowKst.toISOString().slice(0, 10);
  if (hh === SCAN_HOUR_KST && _lastScanDate !== dateStr) {
    _lastScanDate = dateStr;
    const rewards = scanRewards();
    const renewals = scanRenewals();
    console.log(`[스케줄러 ${dateStr} ${String(hh).padStart(2, "0")}시 KST] 리워드 ${rewards.length}건 / 재등록 리마인드 ${renewals.length}건 (SEND_ENABLED=${SEND_ENABLED})`);
  }
}
setInterval(schedulerTick, 60 * 1000); // 1분마다 시각 체크

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`gym-skill-server listening on ${PORT} (SEND_ENABLED=${SEND_ENABLED}, SCAN_HOUR_KST=${SCAN_HOUR_KST})`));
