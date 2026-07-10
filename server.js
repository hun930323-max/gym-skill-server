// 헬스장 카카오 i 오픈빌더 스킬 서버 (단일 파일 · Render 배포용)
// 필요한 파일은 이 server.js 와 package.json 딱 2개뿐입니다.
const express = require("express");
const app = express();
app.use(express.json());

const GYM = "○○피트니스";

// ── 데모 회원 DB (실서비스에선 실제 회원 데이터로 교체) ──
const MEMBERS = {
  "01012345678": { name: "홍길동", membership: { type: "헬스 3개월", expire: "2026-07-25", dday: 15 }, pt: { remain: 3, trainer: "김코치" }, locker: true },
  "01099998888": { name: "김영희", membership: { type: "헬스+필라 6개월", expire: "2026-11-02", dday: 115 }, pt: { remain: 0, trainer: null }, locker: false },
};
const APPUSER_TO_PHONE = { "demo-appuser-1": "01012345678" };

const FAQ = {
  "가격": "○○피트니스 이용권 안내입니다 👇\n· 1개월 헬스 99,000원\n· 3개월 헬스 259,000원\n· PT 10회 550,000원\n· 헬스+필라 6개월 690,000원",
  "영업시간": "평일 06:00~24:00 / 주말·공휴일 08:00~22:00 운영합니다. 명절 당일은 휴무입니다.",
  "주차": "건물 지하 주차장 2시간 무료입니다 🚗 (초과 시 10분당 500원)",
  "위치": "서울시 강남구 ○○로 123, ○○빌딩 3층입니다. 2호선 △△역 3번 출구 도보 5분.",
  "샤워": "남녀 샤워실·수건·드라이어를 무료로 제공합니다. 운동복 대여는 1회 2,000원입니다.",
  "PT": "PT는 10회/20회/30회 단위로 등록 가능하며, 첫 상담은 무료입니다. 예약은 챗봇에서 바로 하실 수 있어요.",
};

// ── 스킬 응답 빌더 ──
const skill = (outputs, quickReplies) => {
  const template = { outputs };
  if (quickReplies && quickReplies.length) template.quickReplies = quickReplies;
  return { version: "2.0", template };
};
const text = (t) => ({ simpleText: { text: t } });
const qr = (label, messageText) => ({ label, action: "message", messageText: messageText || label });
const btnMsg = (label) => ({ action: "message", label, messageText: label });
const MENU = [qr("회원권 조회", "내 회원권 조회"), qr("PT 예약", "PT 예약할래"), qr("가격 안내", "가격 알려줘"), qr("상담원 연결", "상담원 연결")];

const normPhone = (s) => String(s || "").replace(/\D/g, "");
function findMember(body) {
  const props = body?.userRequest?.user?.properties || {};
  const id = props.appUserId;
  if (id && APPUSER_TO_PHONE[id]) { const p = APPUSER_TO_PHONE[id]; return { phone: p, ...MEMBERS[p] }; }
  const params = body?.action?.params || {};
  const phone = normPhone(params.phone || params.sys_phone_number || params.전화번호);
  if (phone && MEMBERS[phone]) return { phone, ...MEMBERS[phone] };
  return null;
}

app.get("/", (_req, res) => res.send("gym-skill-server OK"));

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
  if (!m) return res.json(skill([text("회원 정보를 먼저 연결해 주세요. 등록하신 전화번호를 입력하시면 조회해 드릴게요.")], [qr("내 정보 연결", "회원 연결")]));
  const pt = m.pt.remain > 0 ? `${m.pt.remain}회 남음 (${m.pt.trainer})` : "없음";
  res.json(skill([{ itemCard: {
    head: { title: `${m.name} 회원님 이용현황` },
    itemList: [
      { title: "회원권", description: m.membership.type },
      { title: "만료일", description: `${m.membership.expire} (D-${m.membership.dday})` },
      { title: "PT", description: pt },
      { title: "락커", description: m.locker ? "이용 중" : "미이용" },
    ],
    buttons: [btnMsg("PT 예약"), btnMsg("재등록/연장")],
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
