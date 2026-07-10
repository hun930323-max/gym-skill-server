// 헬스장 카카오 i 오픈빌더 스킬 서버 (단일 파일 · Render 배포용)
// 필요한 파일은 이 server.js 와 package.json 딱 2개뿐입니다.
const express = require("express");
const crypto = require("crypto");
const app = express();
app.use(express.json());

const GYM = "○○피트니스";

// ── 데모 회원 DB (실서비스에선 실제 회원 데이터로 교체) ──
const MEMBERS = {
  "01012345678": { name: "홍길동", membership: { type: "헬스 3개월", expire: "2026-07-25" }, pt: { remain: 3, trainer: "김코치" }, locker: true },
  "01099998888": { name: "김영희", membership: { type: "헬스+필라 6개월", expire: "2026-11-02" }, pt: { remain: 0, trainer: null }, locker: false },
};
const APPUSER_TO_PHONE = { "demo-appuser-1": "01012345678" };

// ── 헬스장별 비밀키(회전 코드용). 실서비스: 온보딩 때 매장마다 발급 ──
const GYM_SECRETS = { "demo": "demo-secret-key-2026" };
const WINDOW = 30000; // 코드 유효 구간(ms)
function codeFor(gym, win) {
  const secret = GYM_SECRETS[gym] || "default-secret";
  const h = crypto.createHmac("sha256", secret).update(String(win)).digest("hex");
  return String(parseInt(h.slice(0, 8), 16) % 1000000).padStart(6, "0");
}
function validCode(gym, code) {
  code = String(code).padStart(6, "0");
  const win = Math.floor(Date.now() / WINDOW);
  return [win - 1, win, win + 1].some((w) => codeFor(gym, w) === code); // 시계오차 ±1구간 허용
}

const FAQ = {
  "가격": "○○피트니스 이용권 안내입니다 👇\n· 1개월 헬스 99,000원\n· 3개월 헬스 259,000원\n· PT 10회 550,000원\n· 헬스+필라 6개월 690,000원",
  "영업시간": "평일 06:00~24:00 / 주말·공휴일 08:00~22:00 운영합니다. 명절 당일은 휴무입니다.",
  "주차": "건물 지하 주차장 2시간 무료입니다 🚗 (초과 시 10분당 500원)",
  "위치": "서울시 강남구 ○○로 123, ○○빌딩 3층입니다. 2호선 △△역 3번 출구 도보 5분.",
  "샤워": "남녀 샤워실·수건·드라이어를 무료로 제공합니다. 운동복 대여는 1회 2,000원입니다.",
  "PT": "PT는 10회/20회/30회 단위로 등록 가능하며, 첫 상담은 무료입니다. 예약은 챗봇에서 바로 하실 수 있어요.",
};

// ── 날짜 유틸(한국시간) ──
function kstDate(daysAgo = 0) {
  return new Date(Date.now() + 9 * 3600000 - daysAgo * 86400000).toISOString().slice(0, 10);
}
const dayIdx = (s) => Math.floor(Date.parse(s + "T00:00:00+09:00") / 86400000);
function ddayOf(expire) {
  return Math.max(0, Math.ceil((new Date(expire + "T23:59:59+09:00") - new Date()) / 86400000));
}

// ── 출석 로그 (실서비스: 출입통제/CRM/QR체크인으로 적재) ──
const ATT = {};
ATT["01012345678"] = new Set([kstDate(1), kstDate(2), kstDate(3)]);
ATT["01099998888"] = new Set([kstDate(3), kstDate(8), kstDate(12)]);
function streakOf(set) {
  if (!set || !set.size) return 0;
  const idx = [...set].map(dayIdx).sort((a, b) => b - a);
  const today = dayIdx(kstDate(0));
  if (idx[0] !== today && idx[0] !== today - 1) return 0;
  let s = 1, prev = idx[0];
  for (let i = 1; i < idx.length; i++) {
    if (idx[i] === prev - 1) { s++; prev = idx[i]; } else if (idx[i] < prev - 1) break;
  }
  return s;
}
const monthCount = (set) => set ? [...set].filter((d) => d.slice(0, 7) === kstDate(0).slice(0, 7)).length : 0;
const weekCount = (set) => set ? [...set].map(dayIdx).filter((i) => i > dayIdx(kstDate(0)) - 7).length : 0;
const badge = (s) => (s >= 7 ? "🏆" : s >= 3 ? "🔥" : "👍");

// ── 스킬 응답 빌더 ──
const skill = (outputs, quickReplies) => {
  const template = { outputs };
  if (quickReplies && quickReplies.length) template.quickReplies = quickReplies;
  return { version: "2.0", template };
};
const text = (t) => ({ simpleText: { text: t } });
const qr = (label, messageText) => ({ label, action: "message", messageText: messageText || label });
const btnMsg = (label) => ({ action: "message", label, messageText: label });
const MENU = [qr("회원권 조회", "내 회원권 조회"), qr("출석 체크", "출석"), qr("가격 안내", "가격 알려줘"), qr("상담원 연결", "상담원 연결")];

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
// 발화/파라미터에서 6자리 체크인 코드 추출(전화번호와 구분)
function extractCode(body) {
  const params = body?.action?.params || {};
  if (params.code) return String(params.code).replace(/\D/g, "");
  const utter = body?.userRequest?.utterance || "";
  const groups = (utter.replace(/01\d{8,9}/g, " ").match(/\d{6}/g)) || [];
  return groups[0] || null;
}

app.get("/", (_req, res) => res.send("gym-skill-server OK"));

// ── 매장 태블릿 키오스크: 회전 QR + 큰 숫자 표시 ──
app.get("/kiosk/code", (req, res) => {
  const gym = req.query.gym || "demo";
  res.json({ code: codeFor(gym, Math.floor(Date.now() / WINDOW)), expiresIn: Math.ceil((WINDOW - (Date.now() % WINDOW)) / 1000) });
});
app.get("/kiosk", (req, res) => {
  const gym = req.query.gym || "demo";
  res.set("Content-Type", "text/html; charset=utf-8").send(`<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>출석 체크인</title>
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

app.post("/skill/welcome", (req, res) => {
  const m = findMember(req.body);
  if (m) return res.json(skill([text(`${m.name} 회원님, 안녕하세요! ${GYM}입니다 💪\n무엇을 도와드릴까요?`)], MENU));
  res.json(skill([text(`안녕하세요! ${GYM}입니다 💪\n맞춤 안내를 위해 회원 정보를 먼저 연결해 주세요.`)],
    [qr("내 정보 연결", "회원 연결"), qr("가격 안내", "가격 알려줘"), qr("상담원 연결", "상담원 연결")]));
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
  res.json(skill([{ itemCard: {
    head: { title: `${m.name} 회원님 이용현황` },
    itemList: [
      { title: "회원권", description: m.membership.type },
      { title: "만료일", description: m.membership.expire },
      { title: "남은 기간", description: `${dday}일 남음 (D-${dday})` },
      { title: "PT", description: pt },
      { title: "락커", description: m.locker ? "이용 중" : "미이용" },
    ],
    buttons: [btnMsg("출석 체크"), btnMsg("재등록/연장")],
  } }], MENU));
});

// 출석 체크(회전 QR/코드 검증) — 매장 태블릿의 현재 코드만 통과
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

// 출석 현황 조회(기록 안 함)
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

app.post("/skill/fallback", (_req, res) => {
  res.json(skill([text("담당자가 정확히 안내드릴게요.\n상담 가능 시간(평일 10~20시)에 순차적으로 답변드립니다.\n성함과 연락처를 남겨주시겠어요?")],
    [qr("상담 신청", "상담 신청합니다"), qr("처음으로", "메뉴")]));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`gym-skill-server listening on ${PORT}`));
