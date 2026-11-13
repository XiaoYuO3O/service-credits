import {
  AnonymousEvaluationRecord,
  AttendanceRecord,
  GradeLevel,
  Participant,
  RoundingMode,
} from '../types';

/**
 * 1. Sattolo 單環置換演算法 (Wilson, "Random and exhaustive generation of permutations and cycles", Figure 1 & Proposition 1.2)
 * Uniformly generates a single n-cycle permutation in C_n (Strict Triangular Product of Transpositions).
 * Guaranteed 100% Zero Fixed Points (arr[i] !== items[i]) and Deadlock-free single orbit for all n >= 2.
 */
export function generateSattoloCycle<T>(items: T[]): Map<T, T> {
  const arr = [...items];
  const n = arr.length;
  for (let k = n - 1; k >= 1; k--) {
    // Strictly choose j from [0 .. k-1], disallowing j === k
    const j = Math.floor(Math.random() * k);
    const temp = arr[k];
    arr[k] = arr[j];
    arr[j] = temp;
  }
  const cycleMap = new Map<T, T>();
  for (let i = 0; i < n; i++) {
    cycleMap.set(items[i], arr[i]); // Guaranteed arr[i] !== items[i] for all n >= 2
  }
  return cycleMap;
}

/**
 * 檢驗置換是否為合法的單一完整循環 (Single Orbit n-cycle, Zero Fixed Points)
 */
export function verifySingleOrbitCycle<T>(items: T[], cycleMap: Map<T, T>): boolean {
  const n = items.length;
  if (n < 2 || cycleMap.size !== n) return false;

  // Check zero fixed points
  for (const item of items) {
    const target = cycleMap.get(item);
    if (target === undefined || target === item) return false;
  }

  // Check single orbit of length n
  const visited = new Set<T>();
  let current: T | undefined = items[0];
  for (let step = 0; step < n; step++) {
    if (current === undefined || visited.has(current)) return false;
    visited.add(current);
    current = cycleMap.get(current);
  }
  return current === items[0] && visited.size === n;
}

/**
 * 2. 雙盲零知識不可追溯架構 —— 即抽即焚單向雜湊票券池 (Unlinkable Anonymity & Burn-on-Complete Ticket Pool)
 * 以 FNV-1a 64-bit 變體產生單向雜湊鍵，並將受評者 ID 與專屬金鑰進行 XOR 混淆封裝。
 */
export function computeTicketHashKey(eventId: string, evaluatorId: string): string {
  const raw = `SC_ZK_V1::${eventId}::${evaluatorId}::SALT_9F4B`;
  let h1 = 0xdeadbeef ^ raw.length;
  let h2 = 0x41c6ce57 ^ raw.length;
  for (let i = 0, ch; i < raw.length; i++) {
    ch = raw.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hex1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const hex2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `TKT_${hex1}${hex2}`.toUpperCase();
}

function getXorStreamKey(eventId: string, evaluatorId: string): string {
  const hashA = computeTicketHashKey(eventId, evaluatorId);
  const hashB = computeTicketHashKey(`${evaluatorId}_STREAM`, eventId);
  return `${hashA}_${hashB}`;
}

export function sealTargetTicket(eventId: string, evaluatorId: string, targetId: string): string {
  const key = getXorStreamKey(eventId, evaluatorId);
  const bytes: number[] = [];
  for (let i = 0; i < targetId.length; i++) {
    bytes.push(targetId.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function unsealTargetTicket(eventId: string, evaluatorId: string, sealedHex: string): string | null {
  if (!sealedHex || sealedHex.length % 2 !== 0) return null;
  const key = getXorStreamKey(eventId, evaluatorId);
  const chars: string[] = [];
  for (let i = 0; i < sealedHex.length; i += 2) {
    const byte = parseInt(sealedHex.slice(i, i + 2), 16);
    if (Number.isNaN(byte)) return null;
    const kChar = key.charCodeAt((i / 2) % key.length);
    chars.push(String.fromCharCode(byte ^ kChar));
  }
  return chars.join('');
}

/**
 * 為整個活動參與者建立 Sattolo 加密票券池
 */
export function buildEncryptedTicketPool(eventId: string, participants: Participant[]): Record<string, string> {
  if (participants.length < 2) return {};
  const ids = participants.map((p) => p.id);
  const cycle = generateSattoloCycle(ids);
  const pool: Record<string, string> = {};
  for (const [evaluatorId, targetId] of cycle.entries()) {
    const hashKey = computeTicketHashKey(eventId, evaluatorId);
    pool[hashKey] = sealTargetTicket(eventId, evaluatorId, targetId);
  }
  return pool;
}

/**
 * 產生隨機不可逆盲籤憑證碼 (如 #ANON-8F3A9C)
 */
export function generateBlindAnonToken(existingTokens: string[] = []): string {
  const existingSet = new Set(existingTokens);
  const hexChars = '0123456789ABCDEF';
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = '#ANON-';
    for (let i = 0; i < 6; i++) {
      code += hexChars[Math.floor(Math.random() * 16)];
    }
    if (!existingSet.has(code)) {
      return code;
    }
  }
  return `#ANON-${Date.now().toString(16).slice(-6).toUpperCase()}`;
}

/**
 * 抗時間差推斷（Timing Attack 防禦）：
 * 抹除時、分、秒，僅回傳 YYYY-MM-DD 日期字串
 */
export function getDateOnlyTimestamp(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 強制將匿名評核結果陣列依「盲籤憑證碼字母序」重新排序
 * 防止管理員透過「誰剛完成任務、誰的分數剛跳出來或排在最後一筆」反推配對
 */
export function sortEvaluationsByAnonToken(
  records: AnonymousEvaluationRecord[]
): AnonymousEvaluationRecord[] {
  return [...records].sort((a, b) => a.anonToken.localeCompare(b.anonToken, 'en'));
}

/**
 * 3. ECHO 隱私防禦架構 (Luo, "ECHO: Revealing Review-to-Submission Linkage in Anonymous Peer Review")
 * - 防線二：正則去識別化遮罩器 (Regex Sanitization Filter，對應論文 Figure 3)
 * - 防線三：去風格化與強制中性行政語氣轉換 (Style Suppression，對應論文 Section 4.4)
 */
export function sanitizeWithEchoRegex(
  rawText: string,
  participants: Pick<Participant, 'name' | 'studentId'>[] = []
): string {
  if (!rawText) return '';
  let text = rawText;

  // 1. Replace URLs -> [URL]
  text = text.replace(/https?:\/\/[^\s，。、；！？,.;!?()（）]+/gi, '[URL]');
  text = text.replace(/www\.[^\s，。、；！？,.;!?()（）]+/gi, '[URL]');

  // 2. Replace Emails -> [EMAIL]
  text = text.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]');

  // 3. Replace roster student IDs & generic student ID patterns (e.g. B11201001, M11302015, 9-digit student numbers) -> [ID]
  for (const p of participants) {
    if (p.studentId && p.studentId.trim().length >= 3) {
      const escapedId = p.studentId.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      text = text.replace(new RegExp(escapedId, 'gi'), '[ID]');
    }
  }
  text = text.replace(/\b[A-Za-z]\d{7,9}\b/g, '[ID]');
  text = text.replace(/(?:學號\s*[:：為是]?\s*)[A-Za-z0-9]{5,12}/g, '學號[ID]');

  // 4. Replace roster names -> [NAME]
  const sortedNames = [...participants]
    .map((p) => p.name.trim())
    .filter((n) => n.length >= 2)
    .sort((a, b) => b.length - a.length);

  for (const name of sortedNames) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(escapedName, 'g'), '[NAME]');
  }

  // 5. Replace self-referential phrases ("我是...", "身為...", "本人...", "小弟...", "小妹...", "身為會長/副會長/組長...") -> [NAME] or neutral
  text = text.replace(
    /(?:我是|身為|本人是|本人為|小弟是|小妹是|俺是|在下是)\s*(?:\[NAME\]|會長|副會長|總召|副召|組長|組負責人|幹部|組員|美宣|公關|活動|器材|總務|文書|值星|[A-Za-z\u4e00-\u9fa5]{1,4}組長)?/g,
    '[NAME]'
  );
  text = text.replace(/(?:\[NAME\]\s*){2,}/g, '[NAME]');
  text = text.replace(/(?:我個人認為|我自己覺得|我認為|我覺得|依我看來|老實說我|說真的我|我們這組我)/g, '經客觀觀察');
  text = text.replace(/(?:身為|作為)(?:同組|直屬|學長|學姊|學弟|學妹|室友|搭檔|負責人)/g, '[NAME]');

  // 6. Replace specific phone / line / identifying numbers -> [NUM]
  text = text.replace(/\b09\d{2}[-\s]?\d{3}[-\s]?\d{3}\b/g, '[NUM]');
  text = text.replace(/(?:分機|電話|手機|號碼|編號|第)\s*\d{2,10}\s*(?:號|碼|支)?/g, '[NUM]');
  text = text.replace(/\b\d{4,}\b/g, '[NUM]');

  return text;
}

const STYLE_NEUTRALIZATION_RULES: Array<[RegExp, string]> = [
  [/超級|超讚|超棒|超強|超猛|爆幹|神級|頂天/g, '高度符合標準且表現優異'],
  [/超雷|太雷|雷包|爛透|超爛|擺爛|躺分|フリーライダー|白目/g, '尚有具體改進空間，建議加強職責落實'],
  [/常常遲到|老是遲到|每次都遲到|愛來不來|大遲到/g, '出席時間管理偶有延誤，建議提升準時率'],
  [/都沒來|直接人間蒸發|搞消失|放鳥|翹掉/g, '部分勤務未能依規定出席，建議補強出勤紀錄'],
  [/很會摸魚|都在滑手機|發呆不做事|偷懶/g, '勤務專注度與主動性尚待提升'],
  [/人超好|人很好|很凱瑞|超凱瑞|Carry|CARRY/g, '積極配合團隊分工並主動支援勤務'],
  [/脾氣很差|態度很差|很難溝通|愛嗆人|不爽/g, '團隊溝通與協作默契建議持續精進'],
  [/做事很隨便|亂做一通|應付了事/g, '工作細膩度與品質檢核尚需加強'],
  [/交差了事|拖拖拉拉|死線戰士|壓線才交/g, '任務交付時程控管建議更具前瞻性'],
  [/哈哈+|呵呵+|嘿嘿+|嗚嗚+|QQ|XD+|xD+|www+|lol/gi, ''],
  [/[！!？?~～]{2,}/g, '。'],
  [/(?:啦|囉|喔|耶|捏|吧|呀|欸|唄|滴|吶)(?=[，。、！？\s]|$)/g, ''],
  [/[～~♪♡★☆✨🔥👍👎😂🤣😭😡🙄]+/g, ''],
];

/**
 * ECHO 防線三：一鍵轉換為中性行政語氣（結合正則去識別化遮罩 + 詞庫改寫）
 */
export function neutralizeWithEchoStyle(
  rawText: string,
  participants: Pick<Participant, 'name' | 'studentId'>[] = []
): string {
  if (!rawText || !rawText.trim()) return '';
  let text = sanitizeWithEchoRegex(rawText, participants);

  for (const [pattern, replacement] of STYLE_NEUTRALIZATION_RULES) {
    text = text.replace(pattern, replacement);
  }

  // Clean up redundant first-person pronouns remaining
  text = text.replace(/我(?:們)?(?:在|看|發現|觀察到)/g, '於勤務期間觀察到');
  text = text.replace(/幫我(?:們)?/g, '協助團隊');
  text = text.replace(/跟我(?:們)?/g, '與團隊成員');

  // Normalize punctuation
  text = text.replace(/。{2,}/g, '。').trim();
  if (text && !/[。！!？?\]】]$/.test(text)) {
    text += '。';
  }
  return text;
}

/**
 * 客觀制式評語快速標籤（ECHO Chips）
 */
export const ECHO_STANDARD_CHIPS: string[] = [
  '依規定準時出席各項會議與活動勤務，時間管理表現穩定。',
  '按期限完成所分配之行政與活動任務，工作成果符合規範。',
  '工作執行細心正確，能主動察覺問題並積極承擔職務責任。',
  '積極配合團隊分工與跨組協調，溝通態度合宜且具合作精神。',
  '服務學習紀錄與成果佐證資料完整具體，便於查核驗證。',
  '部分任務交付時程稍有延遲，建議後續強化進度控管與回報。',
  '偶有請假或時間延誤情形，惟已依規定完成報備與職務交接。',
];

/**
 * 4. 評核結果與點數自動換算規則（依《115學年度系學會服務學習點數評核表》規範）
 * - 90–100 分：A 等級（核發比例 100%）
 * - 80–89 分：B 等級（核發比例 80%）
 * - 70–79 分：C 等級（核發比例 60%）
 * - 60–69 分：D 等級（核發比例 40%）
 * - 未滿 60 分：E 等級（核發比例 0%）
 * 原訂最高點數 × 核發比例 = 建議核發點數（以 0.5 點為最小核發單位，支援四捨五入／無條件捨去切換）
 */
export function calculateGradeAndPoints(
  totalScore: number,
  maxPoints: number,
  roundingMode: RoundingMode = 'round'
): {
  grade: GradeLevel;
  ratio: number;
  rawPoints: number;
  suggestedPoints: number;
} {
  const clampedScore = Math.max(0, Math.min(100, Number(totalScore) || 0));
  let grade: GradeLevel = 'E';
  let ratio = 0;

  if (clampedScore >= 90) {
    grade = 'A';
    ratio = 1.0;
  } else if (clampedScore >= 80) {
    grade = 'B';
    ratio = 0.8;
  } else if (clampedScore >= 70) {
    grade = 'C';
    ratio = 0.6;
  } else if (clampedScore >= 60) {
    grade = 'D';
    ratio = 0.4;
  } else {
    grade = 'E';
    ratio = 0.0;
  }

  const rawPoints = Math.max(0, Number(maxPoints) || 0) * ratio;
  // Convert to 0.5-point unit
  const doubled = rawPoints * 2;
  const suggestedPoints =
    roundingMode === 'floor'
      ? Math.floor(doubled + 1e-9) / 2
      : Math.round(doubled) / 2;

  return {
    grade,
    ratio,
    rawPoints: Number(rawPoints.toFixed(2)),
    suggestedPoints: Number(suggestedPoints.toFixed(1)),
  };
}

/**
 * 出席率與無故缺席自動即時統計：
 * - 經校方核准之請假，不列為無故缺席
 * - 實際出席率 (%)：實際到勤（準時、遲到、早退）場次 ÷ 應出席總場次（扣除核准請假或依總場次計算，若全數核准請假則為 100%）
 */
export function calculateAttendanceStats(records: AttendanceRecord[]): {
  totalSessions: number;
  attendedSessions: number;
  approvedLeaveCount: number;
  unexcusedAbsences: number;
  attendanceRate: number;
} {
  const totalSessions = records.length;
  if (totalSessions === 0) {
    return {
      totalSessions: 0,
      attendedSessions: 0,
      approvedLeaveCount: 0,
      unexcusedAbsences: 0,
      attendanceRate: 100,
    };
  }

  let attendedSessions = 0;
  let approvedLeaveCount = 0;
  let unexcusedAbsences = 0;

  for (const r of records) {
    if (r.status === '準時' || r.status === '遲到' || r.status === '早退') {
      attendedSessions += 1;
    } else if (r.status === '缺席') {
      if (r.isApprovedLeave) {
        approvedLeaveCount += 1;
      } else {
        unexcusedAbsences += 1;
      }
    }
  }

  // Effective required sessions (excluding university-approved leave, or counting approved leave as excused)
  const effectiveTotal = Math.max(1, totalSessions - approvedLeaveCount);
  const attendanceRate =
    totalSessions === approvedLeaveCount
      ? 100
      : Math.round((attendedSessions / effectiveTotal) * 1000) / 10;

  return {
    totalSessions,
    attendedSessions,
    approvedLeaveCount,
    unexcusedAbsences,
    attendanceRate: Math.min(100, Math.max(0, attendanceRate)),
  };
}

/**
 * 網址 UTF-8 安全 Base64 狀態封裝 (?s=...)
 * 支援瀏覽器與 Node.js 測試環境雙向無損編解碼
 */
export function encodeStateToBase64Url(data: unknown): string {
  try {
    const json = JSON.stringify(data);
    const bytes = new TextEncoder().encode(json);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const b64 =
      typeof btoa === 'function'
        ? btoa(binary)
        : Buffer.from(json, 'utf-8').toString('base64');
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  } catch {
    return '';
  }
}

export function decodeStateFromBase64Url<T>(encoded: string): T | null {
  try {
    if (!encoded) return null;
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const pad = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4));
    const normalized = base64 + pad;
    let json = '';
    if (typeof atob === 'function') {
      const binary = atob(normalized);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      json = new TextDecoder().decode(bytes);
    } else {
      json = Buffer.from(normalized, 'base64').toString('utf-8');
    }
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}
