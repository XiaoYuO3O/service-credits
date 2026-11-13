import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  AnonymousEvaluationRecord,
  AttendanceRecord,
  AttendanceStatus,
  EvidenceType,
  EventSession,
  Participant,
  RoundingMode,
  RubricItem,
  SystemState,
} from '../types';
import {
  calculateAttendanceStats,
  calculateGradeAndPoints,
  computeTicketHashKey,
  ECHO_STANDARD_CHIPS,
  generateBlindAnonToken,
  getDateOnlyTimestamp,
  neutralizeWithEchoStyle,
  sanitizeWithEchoRegex,
  sealTargetTicket,
  sortEvaluationsByAnonToken,
  unsealTargetTicket,
} from '../utils/algorithms';
import {
  ShieldCheck,
  Lock,
  Shuffle,
  CheckCircle2,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  Wand2,
  UserCheck,
  AlertCircle,
  FileCheck2,
  ArrowRight,
  RotateCcw,
} from 'lucide-react';

interface EventEvaluationPortalProps {
  event: EventSession;
  noticeItems: string[];
  onUpdateState: (updater: (prev: SystemState) => SystemState) => void;
  onLockUrlPayload?: () => void;
  onShowToast: (msg: string, tone?: 'success' | 'error') => void;
  onNavigateToAdmin: () => void;
}

const ATTENDANCE_STATUSES: AttendanceStatus[] = ['準時', '遲到', '早退', '缺席'];
const ALL_EVIDENCES: EvidenceType[] = [
  '出席表',
  '工作紀錄',
  '活動照片',
  '成果文件',
  '相關訊息紀錄',
];

function buildDefaultScores(rubrics: RubricItem[]): Record<string, number> {
  const initial: Record<string, number> = {};
  for (const r of rubrics) {
    const maxVal = Number.isFinite(Number(r.maxScore)) ? Number(r.maxScore) : 10;
    initial[r.id] = Math.round(maxVal * 0.9);
  }
  return initial;
}

function getReceiptStorageKey(eventName: string): string {
  return `service_credits_last_receipt_v3_${eventName.trim()}`;
}

function loadSavedReceipt(eventName: string): {
  record: AnonymousEvaluationRecord;
  evaluator: Participant;
} | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(getReceiptStorageKey(eventName));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.record && parsed.record.anonToken && parsed.evaluator) {
      return parsed;
    }
  } catch {
    // Ignore storage read errors
  }
  return null;
}

function saveReceiptToSession(
  eventName: string,
  record: AnonymousEvaluationRecord,
  evaluator: Participant
): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(
      getReceiptStorageKey(eventName),
      JSON.stringify({ record, evaluator })
    );
  } catch {
    // Ignore storage write errors
  }
}

function clearReceiptFromSession(eventName: string): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(getReceiptStorageKey(eventName));
  } catch {
    // Ignore
  }
}

/**
 * 確保從 ?s= 解碼載入或外部連結點入的活動能 100% 匹配並更新至 events 陣列：
 * 同時容許 e.id === activeEvent.id || e.name === activeEvent.name；
 * 若在陣列中找不到對應活動，則直接將更新後的 activeEvent 推入 events 陣列。
 */
function upsertActiveEventInList(
  eventsList: EventSession[],
  activeEvent: EventSession,
  transform: (targetEv: EventSession) => EventSession
): EventSession[] {
  const safeList = Array.isArray(eventsList) ? eventsList : [];
  let matched = false;
  const nextList = safeList.map((e) => {
    if (e.id === activeEvent.id || e.name === activeEvent.name) {
      matched = true;
      return transform(e);
    }
    return e;
  });
  if (!matched) {
    nextList.push(transform(activeEvent));
  }
  return nextList;
}

export const EventEvaluationPortal: React.FC<EventEvaluationPortalProps> = ({
  event,
  noticeItems,
  onUpdateState,
  onLockUrlPayload,
  onShowToast,
  onNavigateToAdmin,
}) => {
  const initialReceipt = useMemo(() => loadSavedReceipt(event.name), [event.name]);

  // Step 1: Identity verification state
  const [selectedParticipantId, setSelectedParticipantId] = useState<string>(
    () => initialReceipt?.evaluator.id || ''
  );
  const [verifyCodeInput, setVerifyCodeInput] = useState<string>(
    () => initialReceipt?.evaluator.verifyCode || ''
  );
  const [authError, setAuthError] = useState<string>('');
  const [loggedInParticipant, setLoggedInParticipant] = useState<Participant | null>(
    () => initialReceipt?.evaluator || null
  );

  // Step 2: 1-to-1 Sattolo Draw state
  const [drawnTarget, setDrawnTarget] = useState<Participant | null>(null);
  const [justRemovedTargetId, setJustRemovedTargetId] = useState<string | null>(null);
  const [isDrawingAnim, setIsDrawingAnim] = useState<boolean>(false);

  // Step 3: Evaluation Form state (initialized with safe numeric defaults)
  const [scores, setScores] = useState<Record<string, number>>(() =>
    buildDefaultScores(event.rubrics)
  );
  const [expandedRubrics, setExpandedRubrics] = useState<Record<string, boolean>>({
    'rub-1': true,
    'rub-2': true,
  });
  const [roundingMode, setRoundingMode] = useState<RoundingMode>('round');
  const [evidences, setEvidences] = useState<EvidenceType[]>([
    '出席表',
    '工作紀錄',
    '活動照片',
  ]);
  const [overallComment, setOverallComment] = useState<string>(
    '依規定準時出席各項會議與活動勤務，時間管理表現穩定。按期限完成所分配之行政與活動任務，工作成果符合規範。'
  );
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([
    {
      id: 'att-init-1',
      date: '2026-09-10',
      activityName: `${event.name} 籌備會議`,
      expectedTime: '18:30-21:00',
      status: '準時',
      isApprovedLeave: false,
      reason: '',
      note: '準時完成報到並參與組務分工討論。',
    },
    {
      id: 'att-init-2',
      date: '2026-09-24',
      activityName: `${event.name} 行前彩排與場勘`,
      expectedTime: '09:00-17:00',
      status: '準時',
      isApprovedLeave: false,
      reason: '',
      note: '依期限完成器材與動線確認。',
    },
    {
      id: 'att-init-3',
      date: '2026-10-10',
      activityName: `${event.name} 正式活動勤務`,
      expectedTime: '08:00-21:30',
      status: '準時',
      isApprovedLeave: false,
      reason: '',
      note: '全程配合團隊執行勤務並完成場地復原。',
    },
  ]);

  // Highest-priority submission completion state (bound directly to submit button)
  const [isSubmittedSuccess, setIsSubmittedSuccess] = useState<boolean>(() =>
    Boolean(initialReceipt)
  );
  const [lastSubmittedRecord, setLastSubmittedRecord] =
    useState<AnonymousEvaluationRecord | null>(() => initialReceipt?.record || null);

  // Only reset portal state when switching to a genuinely DIFFERENT event (neither id nor name matches)
  const activeEventIdentityRef = useRef<{ id: string; name: string }>({
    id: event.id,
    name: event.name,
  });

  useEffect(() => {
    const prev = activeEventIdentityRef.current;
    if (event.id !== prev.id && event.name !== prev.name) {
      activeEventIdentityRef.current = { id: event.id, name: event.name };
      const savedForNewEvent = loadSavedReceipt(event.name);
      setSelectedParticipantId(savedForNewEvent?.evaluator.id || '');
      setVerifyCodeInput(savedForNewEvent?.evaluator.verifyCode || '');
      setAuthError('');
      setLoggedInParticipant(savedForNewEvent?.evaluator || null);
      setDrawnTarget(null);
      setScores(buildDefaultScores(event.rubrics));
      setIsSubmittedSuccess(Boolean(savedForNewEvent));
      setLastSubmittedRecord(savedForNewEvent?.record || null);
    } else {
      activeEventIdentityRef.current = { id: event.id, name: event.name };
    }
  }, [event.id, event.name, event.rubrics]);

  // Safe score getter that never returns undefined or NaN
  const getSafeScore = useCallback(
    (item: RubricItem): number => {
      const maxVal = Number.isFinite(Number(item.maxScore)) ? Number(item.maxScore) : 10;
      const raw = scores[item.id];
      const fallback = Math.round(maxVal * 0.9);
      const parsed = raw === undefined || raw === null ? fallback : Number(raw);
      if (!Number.isFinite(parsed)) return fallback;
      return Math.max(0, Math.min(maxVal, parsed));
    },
    [scores]
  );

  // Find first unevaluated member for quick demo button
  const firstUnevaluatedMember = useMemo(
    () =>
      event.participants.find((p) => !event.progressMap[p.id]?.hasEvaluated) ||
      event.participants[0],
    [event.participants, event.progressMap]
  );

  // Initialize default scores when target is drawn
  const initializeFormForTarget = (target: Participant) => {
    clearReceiptFromSession(event.name);
    setScores(buildDefaultScores(event.rubrics));
    setIsSubmittedSuccess(false);
    setLastSubmittedRecord(null);
    setDrawnTarget(target);
  };

  /**
   * 🔄 重置指定成員之抽籤與評核狀態（方便重複測試抽籤與提交）
   */
  const handleResetMemberStatus = (memberToReset: Participant) => {
    onLockUrlPayload?.();
    clearReceiptFromSession(event.name);

    const memberId = memberToReset.id;
    const otherCandidates = event.participants.filter((p) => p.id !== memberId);
    const preferredTarget =
      otherCandidates.find((p) => event.remainingPoolIds.includes(p.id)) ||
      otherCandidates[0] ||
      memberToReset;

    const hashKey = computeTicketHashKey(event.id, memberId);
    const newSealedTicket = sealTargetTicket(event.id, memberId, preferredTarget.id);

    onUpdateState((prev) => ({
      ...prev,
      updatedDate: getDateOnlyTimestamp(),
      events: upsertActiveEventInList(prev.events, event, (ev) => {
        const nextRemaining = ev.remainingPoolIds.includes(preferredTarget.id)
          ? ev.remainingPoolIds
          : [...ev.remainingPoolIds, preferredTarget.id];
        return {
          ...ev,
          progressMap: {
            ...ev.progressMap,
            [memberId]: {
              participantId: memberId,
              hasDrawn: false,
              hasEvaluated: false,
            },
          },
          remainingPoolIds: nextRemaining,
          ticketPool: {
            ...ev.ticketPool,
            [hashKey]: newSealedTicket,
          },
        };
      }),
    }));

    setLoggedInParticipant(memberToReset);
    setSelectedParticipantId(memberToReset.id);
    setVerifyCodeInput(memberToReset.verifyCode);
    setDrawnTarget(null);
    setIsSubmittedSuccess(false);
    setLastSubmittedRecord(null);
    setAuthError('');
    onShowToast(
      `已重置「${memberToReset.name}」之狀態，現在可直接進行 1 對 1 抽籤與提交測試！`,
      'success'
    );
  };

  const handleStep1Login = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const member = event.participants.find((p) => p.id === selectedParticipantId);
    if (!member) {
      const msg = '請先從下拉選單選擇您的姓名。';
      setAuthError(msg);
      onShowToast(msg, 'error');
      return;
    }
    if (verifyCodeInput.trim() !== member.verifyCode.trim()) {
      const msg = `個人驗證碼不正確（${member.name} 的驗證碼為 ${member.verifyCode}）。`;
      setAuthError(msg);
      onShowToast(msg, 'error');
      return;
    }
    setAuthError('');
    setLoggedInParticipant(member);
    setDrawnTarget(null);
    if (!event.progressMap[member.id]?.hasEvaluated) {
      clearReceiptFromSession(event.name);
      setIsSubmittedSuccess(false);
      setLastSubmittedRecord(null);
    }
    onShowToast(`已確認身分：${member.name}（${member.studentId}）`, 'success');
  };

  const handleQuickFillDemoMember = () => {
    if (!firstUnevaluatedMember) return;
    setSelectedParticipantId(firstUnevaluatedMember.id);
    setVerifyCodeInput(firstUnevaluatedMember.verifyCode);
    setAuthError('');
  };

  // Step 2: Execute 1-to-1 Sattolo Draw & Remove Target from Pool
  const handleDrawTarget = () => {
    // Lock URL payload so ?s= can never overwrite state after drawing
    onLockUrlPayload?.();

    const evaluator =
      loggedInParticipant ||
      event.participants.find((p) => p.id === selectedParticipantId) ||
      firstUnevaluatedMember ||
      event.participants[0];

    if (!evaluator) {
      onShowToast('目前活動無參與人員名單可供抽籤', 'error');
      return;
    }

    const myId = evaluator.id;
    const hashKey = computeTicketHashKey(event.id, myId);
    const sealed = event.ticketPool[hashKey];
    let targetId = sealed ? unsealTargetTicket(event.id, myId, sealed) : null;

    // Fallback safety: guarantee a valid non-self target from participants
    if (
      !targetId ||
      targetId === myId ||
      !event.participants.some((p) => p.id === targetId)
    ) {
      const poolCandidates = event.remainingPoolIds.filter((id) => id !== myId);
      if (poolCandidates.length > 0) {
        targetId = poolCandidates[0];
      } else {
        const other = event.participants.find((p) => p.id !== myId);
        targetId = other ? other.id : evaluator.id;
      }
    }

    const targetObj =
      event.participants.find((p) => p.id === targetId) ||
      event.participants.find((p) => p.id !== myId) ||
      evaluator;

    setIsDrawingAnim(true);
    setJustRemovedTargetId(targetObj.id);

    onUpdateState((prev) => ({
      ...prev,
      updatedDate: getDateOnlyTimestamp(),
      events: upsertActiveEventInList(prev.events, event, (ev) => ({
        ...ev,
        remainingPoolIds: ev.remainingPoolIds.filter((id) => id !== targetObj.id),
        progressMap: {
          ...ev.progressMap,
          [myId]: {
            participantId: myId,
            hasDrawn: true,
            hasEvaluated: Boolean(ev.progressMap[myId]?.hasEvaluated),
          },
        },
      })),
    }));

    setIsDrawingAnim(false);
    initializeFormForTarget(targetObj);
    onShowToast(`已抽中受評對象「${targetObj.name}」，並將其從人員池移除`, 'success');
  };

  const totalScore = useMemo(() => {
    return event.rubrics.reduce((sum, r) => sum + getSafeScore(r), 0);
  }, [event.rubrics, getSafeScore]);

  const gradeResult = useMemo(() => {
    const maxPts = Number.isFinite(Number(drawnTarget?.maxPoints))
      ? Number(drawnTarget?.maxPoints)
      : 2.0;
    return calculateGradeAndPoints(totalScore, maxPts, roundingMode);
  }, [totalScore, drawnTarget, roundingMode]);

  const attendanceStats = useMemo(
    () => calculateAttendanceStats(attendanceRecords),
    [attendanceRecords]
  );

  // Live ECHO sanitized preview of overallComment
  const echoPreviewComment = useMemo(
    () => sanitizeWithEchoRegex(overallComment, event.participants),
    [overallComment, event.participants]
  );

  const handleApplyEchoNeutralizer = () => {
    setOverallComment((prev) => neutralizeWithEchoStyle(prev, event.participants));
    setAttendanceRecords((prev) =>
      prev.map((r) => ({
        ...r,
        reason: sanitizeWithEchoRegex(r.reason, event.participants),
        note: neutralizeWithEchoStyle(r.note, event.participants),
      }))
    );
    onShowToast('已執行 ECHO 語氣中性化與正則去識別化遮罩', 'success');
  };

  const handleAppendEchoChip = (chip: string) => {
    setOverallComment((prev) => {
      const trimmed = prev.trim();
      if (!trimmed) return chip;
      if (trimmed.includes(chip)) return trimmed;
      return `${trimmed} ${chip}`;
    });
  };

  const handleAddAttendanceRow = () => {
    setAttendanceRecords((prev) => [
      ...prev,
      {
        id: `att-${Date.now().toString(36)}-${prev.length + 1}`,
        date: getDateOnlyTimestamp(),
        activityName: `${event.name} 專案勤務`,
        expectedTime: '18:30-20:30',
        status: '準時',
        isApprovedLeave: false,
        reason: '',
        note: '',
      },
    ]);
  };

  const handleRemoveAttendanceRow = (rowId: string) => {
    setAttendanceRecords((prev) => prev.filter((r) => r.id !== rowId));
  };

  const handleToggleEvidence = (evType: EvidenceType) => {
    setEvidences((prev) =>
      prev.includes(evType) ? prev.filter((e) => e !== evType) : [...prev, evType]
    );
  };

  /**
   * 步驟 3：提交匿名評核表並鎖定（自動執行 ECHO 淨化）
   * 強制綁定獨立完成畫面與 Upsert 寫入：
   * 1. 鎖定 URL ?s= 快照（onLockUrlPayload），禁止舊快照覆寫。
   * 2. 第一時間先計算分數、產生 #ANON-XXXXXX 盲籤憑證物件 newRecord。
   * 3. 將 newRecord 存入 lastSubmittedRecord 本地 state（與 sessionStorage），並無條件設定 setIsSubmittedSuccess(true)。
   * 4. 透過 upsertActiveEventInList 比對 e.id === event.id || e.name === event.name（若無則直接 push），100% 寫入成功。
   */
  const handleSubmitEvaluation = () => {
    try {
      onLockUrlPayload?.();

      const effectiveEvaluator: Participant =
        loggedInParticipant ||
        event.participants.find((p) => p.id === selectedParticipantId) ||
        firstUnevaluatedMember ||
        event.participants[0] || {
          id: 'fallback-eval',
          studentId: 'B11201004',
          name: '大雄',
          department: '資訊工程學系二年級',
          role: '一般組員',
          maxPoints: 2.0,
          verifyCode: '1004',
        };

      const effectiveTarget: Participant =
        drawnTarget ||
        event.participants.find(
          (p) => p.id !== effectiveEvaluator.id && event.remainingPoolIds.includes(p.id)
        ) ||
        event.participants.find((p) => p.id !== effectiveEvaluator.id) ||
        event.participants[0] || {
          id: 'fallback-target',
          studentId: 'B11201001',
          name: '小明',
          department: '資訊工程學系三年級',
          role: '會長',
          maxPoints: 4.0,
          verifyCode: '1001',
        };

      const myId = effectiveEvaluator.id;
      const hashKey = computeTicketHashKey(event.id, myId);
      const existingTokens = Array.isArray(event.evaluations)
        ? event.evaluations.map((rec) => rec.anonToken)
        : [];
      const newAnonToken = generateBlindAnonToken(existingTokens);

      // 1. 將質性評語與備註執行 ECHO 正則遮罩與中性行政語氣轉換
      const sanitizedComment =
        neutralizeWithEchoStyle(overallComment || '', event.participants) ||
        '依規定完成指派勤務，服務表現符合標準。';

      const sanitizedAttendances: AttendanceRecord[] = (
        Array.isArray(attendanceRecords) ? attendanceRecords : []
      ).map((att, idx) => ({
        ...att,
        id: att.id || `att-sub-${idx + 1}`,
        date: att.date || getDateOnlyTimestamp(),
        activityName: att.activityName || `${event.name} 勤務`,
        expectedTime: att.expectedTime || '18:30-20:30',
        status: att.status || '準時',
        isApprovedLeave: Boolean(att.isApprovedLeave),
        reason: sanitizeWithEchoRegex(att.reason || '', event.participants),
        note: neutralizeWithEchoStyle(att.note || '', event.participants),
      }));

      // 2. 計算五大指標總分（防 NaN 保底）、判定 A～E 等級與建議核發點數
      const cleanScores: Record<string, number> = {};
      let computedTotal = 0;
      for (const r of event.rubrics) {
        const val = getSafeScore(r);
        cleanScores[r.id] = val;
        computedTotal += val;
      }

      const targetMaxPoints = Number.isFinite(Number(effectiveTarget.maxPoints))
        ? Number(effectiveTarget.maxPoints)
        : 2.0;

      const finalGradeCalc = calculateGradeAndPoints(
        computedTotal,
        targetMaxPoints,
        roundingMode
      );
      const finalAttStats = calculateAttendanceStats(sanitizedAttendances);

      // 3. 建立不含 evaluatorId 的匿名評核物件 newRecord
      const newRecord: AnonymousEvaluationRecord = {
        anonToken: newAnonToken,
        targetId: effectiveTarget.id,
        targetSnapshot: {
          academicYear: event.academicYear || '115學年度',
          department: effectiveTarget.department || '資訊工程學系',
          studentId: effectiveTarget.studentId || 'B11201001',
          name: effectiveTarget.name || '受評成員',
          role: effectiveTarget.role || '一般組員',
          evaluationPeriod: event.period || '115學年度評核期間',
          maxPoints: targetMaxPoints,
        },
        scores: cleanScores,
        totalScore: computedTotal,
        grade: finalGradeCalc.grade,
        ratio: finalGradeCalc.ratio,
        roundingMode,
        suggestedPoints: finalGradeCalc.suggestedPoints,
        attendanceRecords: sanitizedAttendances,
        attendanceStats: {
          totalSessions: finalAttStats.totalSessions,
          attendanceRate: finalAttStats.attendanceRate,
          unexcusedAbsences: finalAttStats.unexcusedAbsences,
        },
        evidences: Array.isArray(evidences) ? [...evidences] : ['出席表'],
        overallComment: sanitizedComment,
        submittedDate: getDateOnlyTimestamp(), // Date-only YYYY-MM-DD (Timing Attack Defense)
        universityReview: {
          approvedPoints: null,
          isDeducted: false,
          deductedPoints: 0,
          needsSupplement: false,
          supplementContent: '',
          reviewComment: '',
          reviewerName: '',
          reviewDate: '',
        },
      };

      // 4. 第一時間存入 lastSubmittedRecord 本地 state 並無條件設定 setIsSubmittedSuccess(true)
      if (!loggedInParticipant) {
        setLoggedInParticipant(effectiveEvaluator);
      }
      saveReceiptToSession(event.name, newRecord, effectiveEvaluator);
      setLastSubmittedRecord(newRecord);
      setIsSubmittedSuccess(true);

      if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }

      // 5. 同步寫入 systemState.events（支援 id 或 name 雙重匹配，找不到則直接 push）
      onUpdateState((prev) => ({
        ...prev,
        updatedDate: getDateOnlyTimestamp(),
        events: upsertActiveEventInList(prev.events, event, (ev) => {
          const nextTicketPool = { ...(ev.ticketPool || {}) };
          delete nextTicketPool[hashKey];

          const existingEvals = Array.isArray(ev.evaluations) ? ev.evaluations : [];
          const prevRemaining = Array.isArray(ev.remainingPoolIds)
            ? ev.remainingPoolIds
            : [];

          return {
            ...ev,
            progressMap: {
              ...(ev.progressMap || {}),
              [myId]: {
                participantId: myId,
                hasDrawn: true,
                hasEvaluated: true,
              },
            },
            remainingPoolIds: prevRemaining.filter((id) => id !== effectiveTarget.id),
            ticketPool: nextTicketPool,
            evaluations: sortEvaluationsByAnonToken([...existingEvals, newRecord]),
          };
        }),
      }));

      // 6. 顯示清楚的綠色成功 Toast 通知
      onShowToast(
        `🎉 已完成匿名評核並鎖定！盲籤憑證：${newAnonToken}（受評對象：${effectiveTarget.name}）`,
        'success'
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : '提交過程發生未預期錯誤，請重試';
      onShowToast(`提交失敗：${message}`, 'error');
    }
  };

  const selectedMemberObj = useMemo(
    () => event.participants.find((p) => p.id === selectedParticipantId) || null,
    [event.participants, selectedParticipantId]
  );

  const myProgress = loggedInParticipant
    ? event.progressMap[loggedInParticipant.id]
    : undefined;

  // Outermost priority check: as soon as isSubmittedSuccess === true (or lastSubmittedRecord / hasEvaluated is true), render completion screen
  const showCompletedScreen =
    isSubmittedSuccess ||
    Boolean(lastSubmittedRecord) ||
    Boolean(myProgress?.hasEvaluated);

  return (
    <div className="space-y-6">
      {/* Event Header Banner */}
      <section className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mb-1">
              <span>{event.academicYear}</span>
              <span aria-hidden="true">·</span>
              <span>評核期間：{event.period}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-emerald-700 font-semibold">
                Sattolo 1對1單環抽籤 ＆ ECHO 雙盲零知識保護
              </span>
            </div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              {event.name} — 活動專屬匿名評核大廳
            </h1>
          </div>

          {/* 3-Step Progress Indicator */}
          <div className="flex items-center gap-2 text-xs font-medium">
            <span
              className={`px-2.5 py-1 rounded-md ${
                !loggedInParticipant && !showCompletedScreen
                  ? 'bg-slate-900 text-white font-semibold'
                  : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              }`}
            >
              步驟 1：確認身分
            </span>
            <span className="text-slate-300">→</span>
            <span
              className={`px-2.5 py-1 rounded-md ${
                loggedInParticipant && !drawnTarget && !showCompletedScreen
                  ? 'bg-slate-900 text-white font-semibold'
                  : drawnTarget || showCompletedScreen
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  : 'bg-slate-100 text-slate-500'
              }`}
            >
              步驟 2：1 對 1 抽取對象
            </span>
            <span className="text-slate-300">→</span>
            <span
              className={`px-2.5 py-1 rounded-md ${
                drawnTarget && !showCompletedScreen
                  ? 'bg-slate-900 text-white font-semibold'
                  : showCompletedScreen
                  ? 'bg-emerald-700 text-white font-semibold'
                  : 'bg-slate-100 text-slate-500'
              }`}
            >
              {showCompletedScreen ? '✓ 已完成評核並鎖定' : '步驟 3：填寫評核表並鎖定'}
            </span>
          </div>
        </div>
      </section>

      {/* COMPLETED / LOCKED RECEIPT SCREEN (Highest Priority when isSubmittedSuccess === true) */}
      {showCompletedScreen && (
        <section
          data-testid="evaluation-completed-card"
          className="max-w-2xl mx-auto bg-white border-2 border-emerald-600 rounded-xl p-6 md:p-8 shadow-sm space-y-5"
        >
          <div className="flex items-start gap-3">
            <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-700">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                🎉 已完成匿名評核並鎖定（盲籤憑證碼{' '}
                <span className="font-mono text-emerald-700">
                  {lastSubmittedRecord?.anonToken || '#ANON-VERIFIED'}
                </span>
                ）
              </h2>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                親愛的{' '}
                <span className="font-semibold text-slate-900">
                  {loggedInParticipant?.name || '評核人員'}
                </span>
                （{loggedInParticipant?.studentId || '已驗證'}），您已完成本場次「
                {event.name}」之 1 對 1 匿名評核，成績已同步寫入後台零知識審核總表。
              </p>
            </div>
          </div>

          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-2.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-600">評核人員身分隔離：</span>
              <span className="font-mono font-semibold text-slate-900">
                🔒 匿名評核人員（我）
              </span>
            </div>
            {lastSubmittedRecord && (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">配發之不可逆盲籤憑證碼：</span>
                  <span className="font-mono font-bold text-emerald-700 text-sm">
                    {lastSubmittedRecord.anonToken}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">受評對象與評核結果：</span>
                  <span className="font-mono font-bold text-slate-900">
                    {lastSubmittedRecord.targetSnapshot.name} · 總分{' '}
                    {lastSubmittedRecord.totalScore} 分（{lastSubmittedRecord.grade}{' '}
                    等級 / 建議 {lastSubmittedRecord.suggestedPoints.toFixed(1)} 點）
                  </span>
                </div>
                <div className="pt-2 border-t border-slate-200">
                  <div className="text-slate-500 mb-1">ECHO 淨化後寫入後台之客觀評語：</div>
                  <div className="font-mono text-slate-800 bg-white p-2.5 rounded border border-slate-200">
                    {lastSubmittedRecord.overallComment}
                  </div>
                </div>
              </>
            )}
            <div className="flex items-center justify-between pt-1">
              <span className="text-slate-600">跨文本隔離（Artifact Isolation）：</span>
              <span className="text-slate-800 font-medium">
                已鎖定狀態，不可查閱他人對自己的評語
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <div className="flex flex-wrap items-center gap-2">
              {loggedInParticipant && (
                <button
                  type="button"
                  onClick={() => handleResetMemberStatus(loggedInParticipant)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-amber-900 bg-amber-50 border border-amber-300 rounded-lg hover:bg-amber-100 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>🔄 重置此成員狀態（方便重複測試抽籤與提交）</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  clearReceiptFromSession(event.name);
                  setLoggedInParticipant(null);
                  setDrawnTarget(null);
                  setIsSubmittedSuccess(false);
                  setLastSubmittedRecord(null);
                  setSelectedParticipantId('');
                  setVerifyCodeInput('');
                }}
                className="px-3.5 py-2 text-xs font-semibold text-slate-800 bg-slate-100 border border-slate-200 rounded-lg hover:bg-slate-200 cursor-pointer"
              >
                切換其他參與人員身分
              </button>
            </div>

            <button
              type="button"
              onClick={onNavigateToAdmin}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 cursor-pointer"
            >
              <span>前往 #/管理編輯 查看零知識審核總表</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </section>
      )}

      {/* STEP 1: Identity Confirmation */}
      {!showCompletedScreen && !loggedInParticipant && (
        <section className="max-w-xl mx-auto bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-5">
          <div className="flex items-center gap-2.5">
            <UserCheck className="w-5 h-5 text-slate-800" />
            <div>
              <h2 className="text-base font-bold text-slate-900">
                步驟 1：確認參與人員身分
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                請從「{event.name}」參與名單選擇您的姓名，並輸入個人驗證碼（預設為學號後 4 碼）登入。
              </p>
            </div>
          </div>

          <form onSubmit={handleStep1Login} className="space-y-4">
            <div>
              <label
                htmlFor="participant-select"
                className="block text-xs font-semibold text-slate-700 mb-1.5"
              >
                選擇您的姓名（共 {event.participants.length} 名參與人員）
              </label>
              <select
                id="participant-select"
                value={selectedParticipantId}
                onChange={(e) => {
                  const nextId = e.target.value;
                  setSelectedParticipantId(nextId);
                  const found = event.participants.find((p) => p.id === nextId);
                  if (found) {
                    setVerifyCodeInput(found.verifyCode);
                  }
                  setAuthError('');
                }}
                className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
              >
                <option value="">— 請選擇您的姓名 —</option>
                {event.participants.map((p) => {
                  const pProg = event.progressMap[p.id];
                  const statusTag = pProg?.hasEvaluated
                    ? '[已完成評核-可點選重置測試]'
                    : '[可抽籤評核]';
                  return (
                    <option key={p.id} value={p.id}>
                      {p.name}（{p.studentId} · {p.role}）{statusTag}
                    </option>
                  );
                })}
              </select>
            </div>

            <div>
              <label
                htmlFor="participant-verify-code"
                className="block text-xs font-semibold text-slate-700 mb-1.5"
              >
                個人驗證碼（學號後 4 碼，選擇姓名後自動帶入以方便預覽測試）
              </label>
              <input
                id="participant-verify-code"
                type="text"
                value={verifyCodeInput}
                onChange={(e) => {
                  setVerifyCodeInput(e.target.value);
                  setAuthError('');
                }}
                placeholder="請輸入 4 碼驗證碼（如：1004）"
                className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 font-mono"
              />
            </div>

            {selectedMemberObj && event.progressMap[selectedMemberObj.id]?.hasEvaluated && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex flex-wrap items-center justify-between gap-2 text-xs text-amber-900">
                <span>
                  「{selectedMemberObj.name}」目前為已完成評核狀態，可點選右側按鈕立即重置以重複測試抽籤與提交：
                </span>
                <button
                  type="button"
                  onClick={() => handleResetMemberStatus(selectedMemberObj)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-amber-950 bg-white border border-amber-300 rounded-md hover:bg-amber-100 cursor-pointer whitespace-nowrap"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>🔄 重置此成員狀態（方便重複測試抽籤與提交）</span>
                </button>
              </div>
            )}

            {authError && (
              <div
                role="alert"
                className="flex items-center gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2"
              >
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{authError}</span>
              </div>
            )}

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 pt-1">
              <button
                type="submit"
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap"
              >
                <span>確認身分並進入抽籤大廳</span>
              </button>
              {firstUnevaluatedMember && (
                <button
                  type="button"
                  onClick={handleQuickFillDemoMember}
                  className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 text-xs font-medium text-slate-700 bg-slate-100 border border-slate-200 rounded-lg hover:bg-slate-200 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <span>
                    一鍵帶入未抽籤測試身分（{firstUnevaluatedMember.name} /{' '}
                    {firstUnevaluatedMember.verifyCode}）
                  </span>
                </button>
              )}
            </div>
          </form>
        </section>
      )}

      {/* STEP 2: 1-to-1 Sattolo Draw Arena */}
      {!showCompletedScreen && loggedInParticipant && !drawnTarget && (
        <section className="max-w-2xl mx-auto bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-slate-200">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                步驟 2：1 對 1 抽取評核對象（Sattolo 單環置換演算法）
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                保證 100% 零不動點（絕對不會抽到自己）且無死結；抽中對象後將立即從人員池移除，其他人再也抽不到該對象。
              </p>
            </div>
            <button
              type="button"
              onClick={() => setLoggedInParticipant(null)}
              className="text-xs text-slate-500 hover:text-slate-900 underline cursor-pointer"
            >
              切換登入身分（目前：{loggedInParticipant.name}）
            </button>
          </div>

          {/* Remaining Pool Visualization */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-800">
                目前活動人員池狀態（抽中後立即從池中移除）：
              </span>
              <span className="font-mono font-bold text-slate-900 tabular-nums">
                剩餘可抽人數：{event.remainingPoolIds.length} 人
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {event.participants.map((p) => {
                const inPool = event.remainingPoolIds.includes(p.id);
                const isBeingRemoved = justRemovedTargetId === p.id;
                return (
                  <div
                    key={p.id}
                    className={`p-3 rounded-lg border text-xs transition-all duration-300 ${
                      isBeingRemoved
                        ? 'opacity-0 scale-95 bg-emerald-50 border-emerald-400'
                        : inPool
                        ? 'bg-white border-slate-200 text-slate-900'
                        : 'bg-slate-100 border-slate-200 text-slate-400 opacity-60'
                    }`}
                  >
                    <div className="font-bold flex items-center justify-between">
                      <span>{inPool ? '待抽取成員' : '已移出人員池'}</span>
                      <span className="font-mono text-[11px]">
                        {inPool ? '● 池內' : '○ 已抽走'}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1 font-mono">
                      {inPool ? '匿名保護中' : '對象已配對鎖定'}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col items-center justify-center py-4 gap-3">
            <button
              type="button"
              disabled={isDrawingAnim}
              onClick={handleDrawTarget}
              className="inline-flex items-center gap-2 px-6 py-3 text-sm font-bold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-transform active:scale-98 cursor-pointer shadow-xs"
            >
              <Shuffle className="w-4 h-4" />
              <span>{isDrawingAnim ? '正在從人員池抽取並移除對象...' : '抽取評核對象'}</span>
            </button>
            <p className="text-xs text-slate-500 font-mono">
              評核人員：匿名評核人員（我） · 登入身分驗證：{loggedInParticipant.name}
            </p>
          </div>
        </section>
      )}

      {/* STEP 3: Evaluation Form for Drawn Target */}
      {!showCompletedScreen && loggedInParticipant && drawnTarget && (
        <div className="space-y-6">
          {/* Pairing Banner: Shows ONLY Target Name and Anonymous Evaluator (Me) */}
          <section className="bg-slate-900 text-white rounded-xl p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="space-y-1">
              <div className="text-xs text-emerald-400 font-mono">
                ✓ 已將「{drawnTarget.name}」從活動人員池移除（剩餘可抽人數：{event.remainingPoolIds.length} 人，其他人再也抽不到 {drawnTarget.name}）
              </div>
              <div className="flex flex-wrap items-center gap-4 pt-1">
                <div className="text-lg font-bold tracking-tight">
                  受評對象：<span className="underline decoration-emerald-400 underline-offset-4">{drawnTarget.name}</span>
                </div>
                <span className="text-slate-500">|</span>
                <div className="text-sm font-medium text-slate-200">
                  評核人員：<span className="font-mono text-emerald-300">匿名評核人員（我）</span>
                </div>
              </div>
            </div>
            <div className="text-xs text-slate-300 font-mono bg-slate-800 px-3.5 py-2 rounded-lg border border-slate-700">
              雙盲零知識保護：送出後即刻銷毀配對票券
            </div>
          </section>

          {/* 1. 學生基本資料區 */}
          <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="border-b border-slate-200 pb-3">
              <h2 className="text-base font-bold text-slate-900">
                1. 學生基本資料區（自動帶入受評對象「{drawnTarget.name}」資料）
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <div className="text-slate-500 mb-1">學年度 / 評核期間</div>
                <div className="font-semibold text-slate-900 font-mono">
                  {event.academicYear}（{event.period}）
                </div>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <div className="text-slate-500 mb-1">受評對象姓名 / 學號</div>
                <div className="font-bold text-slate-900 text-sm font-mono">
                  {drawnTarget.name}（{drawnTarget.studentId}）
                </div>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <div className="text-slate-500 mb-1">系級 / 擔任職務</div>
                <div className="font-semibold text-slate-900">
                  {drawnTarget.department} · <span className="underline">{drawnTarget.role}</span>
                </div>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <div className="text-slate-500 mb-1">原訂最高點數 / 評核人員</div>
                <div className="font-bold text-slate-900 font-mono">
                  {drawnTarget.maxPoints.toFixed(1)} 點 · 匿名評核人員（我）
                </div>
              </div>
            </div>
          </section>

          {/* 2. 服務表現評核區 */}
          <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  2. 服務表現評核區（共 {event.rubrics.length} 大指標，滿分 100 分）
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  可點擊各指標展開三階段評分尺規提示（高度表現 ／ 普通表現 ／ 待改進表現）。
                </p>
              </div>
              <div className="text-sm font-mono font-bold text-slate-900 bg-slate-100 px-3.5 py-1.5 rounded-lg tabular-nums">
                目前總分合計：{totalScore} / 100 分
              </div>
            </div>

            <div className="space-y-3">
              {event.rubrics.map((item, idx) => {
                const currentVal = getSafeScore(item);
                const isExpanded = Boolean(expandedRubrics[item.id]);

                return (
                  <div
                    key={item.id}
                    className="p-4 bg-slate-50/70 border border-slate-200 rounded-lg space-y-3"
                  >
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-slate-900">
                            {idx + 1}. {item.title}（配分 {item.maxScore} 分）
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedRubrics((prev) => ({
                                ...prev,
                                [item.id]: !prev[item.id],
                              }))
                            }
                            className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900 underline cursor-pointer"
                          >
                            <span>{isExpanded ? '收合尺規' : '展開三階段尺規'}</span>
                            {isExpanded ? (
                              <ChevronUp className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronDown className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                        <p className="text-xs text-slate-600">{item.description}</p>
                      </div>

                      {/* Score Input & Quick Range */}
                      <div className="flex items-center gap-3 shrink-0">
                        <input
                          type="range"
                          min={0}
                          max={item.maxScore}
                          step={1}
                          aria-label={`${item.title} 滑桿評分`}
                          value={currentVal}
                          onChange={(e) =>
                            setScores((prev) => ({
                              ...prev,
                              [item.id]: parseInt(e.target.value, 10) || 0,
                            }))
                          }
                          className="w-28 md:w-36 accent-slate-900 cursor-pointer"
                        />
                        <div className="flex items-center gap-1 font-mono">
                          <input
                            type="number"
                            min={0}
                            max={item.maxScore}
                            aria-label={`${item.title} 分數輸入`}
                            value={currentVal}
                            onChange={(e) => {
                              const raw = parseInt(e.target.value, 10);
                              const clamped = Number.isNaN(raw)
                                ? 0
                                : Math.max(0, Math.min(item.maxScore, raw));
                              setScores((prev) => ({ ...prev, [item.id]: clamped }));
                            }}
                            className="w-16 px-2 py-1 text-sm font-bold text-right bg-white border border-slate-300 rounded-md tabular-nums"
                          />
                          <span className="text-xs text-slate-500">/ {item.maxScore}</span>
                        </div>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 pt-2 border-t border-slate-200/80 text-xs">
                        <div className="p-2.5 bg-white border border-slate-200 rounded-md">
                          <div className="font-semibold text-emerald-800 mb-0.5">
                            高度表現
                          </div>
                          <div className="text-slate-600">{item.tierHigh}</div>
                        </div>
                        <div className="p-2.5 bg-white border border-slate-200 rounded-md">
                          <div className="font-semibold text-slate-800 mb-0.5">
                            普通表現
                          </div>
                          <div className="text-slate-600">{item.tierMedium}</div>
                        </div>
                        <div className="p-2.5 bg-white border border-slate-200 rounded-md">
                          <div className="font-semibold text-amber-800 mb-0.5">
                            待改進表現
                          </div>
                          <div className="text-slate-600">{item.tierLow}</div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* 3. 出席及服務紀錄區 */}
          <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  3. 出席及服務紀錄區（動態新增列與出席率自動統計）
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  勾選「經校方核准請假」後不列為無故缺席；備註欄自動受 ECHO 去識別化遮罩保護。
                </p>
              </div>
              <button
                type="button"
                onClick={handleAddAttendanceRow}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>新增出席勤務紀錄列</span>
              </button>
            </div>

            {/* Live Attendance Summary Bar */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between">
                <span className="text-slate-600">應出席總場次：</span>
                <span className="font-mono font-bold text-sm text-slate-900 tabular-nums">
                  {attendanceStats.totalSessions} 場
                </span>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between">
                <span className="text-slate-600">實際出席率（扣除核准公假）：</span>
                <span className="font-mono font-bold text-sm text-emerald-700 tabular-nums">
                  {attendanceStats.attendanceRate}%
                </span>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between">
                <span className="text-slate-600">無故缺席次數：</span>
                <span
                  className={`font-mono font-bold text-sm tabular-nums ${
                    attendanceStats.unexcusedAbsences > 0
                      ? 'text-red-700'
                      : 'text-slate-900'
                  }`}
                >
                  {attendanceStats.unexcusedAbsences} 次
                </span>
              </div>
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-700">
                    <th className="py-2 px-2.5 font-semibold">日期</th>
                    <th className="py-2 px-2.5 font-semibold">活動或工作名稱</th>
                    <th className="py-2 px-2.5 font-semibold">應出席時間</th>
                    <th className="py-2 px-2.5 font-semibold">實際出席情形</th>
                    <th className="py-2 px-2.5 font-semibold text-center">校方核准請假</th>
                    <th className="py-2 px-2.5 font-semibold">請假/缺席原因</th>
                    <th className="py-2 px-2.5 font-semibold">備註（受 ECHO 保護）</th>
                    <th className="py-2 px-2 font-semibold text-right">刪除</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {attendanceRecords.map((row, idx) => (
                    <tr key={row.id} className="hover:bg-slate-50/60">
                      <td className="p-2">
                        <input
                          type="date"
                          aria-label={`第 ${idx + 1} 列日期`}
                          value={row.date}
                          onChange={(e) =>
                            setAttendanceRecords((prev) =>
                              prev.map((r) =>
                                r.id === row.id ? { ...r, date: e.target.value } : r
                              )
                            )
                          }
                          className="px-2 py-1 bg-white border border-slate-300 rounded font-mono text-xs"
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="text"
                          aria-label={`第 ${idx + 1} 列活動名稱`}
                          value={row.activityName}
                          onChange={(e) =>
                            setAttendanceRecords((prev) =>
                              prev.map((r) =>
                                r.id === row.id ? { ...r, activityName: e.target.value } : r
                              )
                            )
                          }
                          className="w-36 px-2 py-1 bg-white border border-slate-300 rounded text-xs"
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="text"
                          aria-label={`第 ${idx + 1} 列應出席時間`}
                          value={row.expectedTime}
                          onChange={(e) =>
                            setAttendanceRecords((prev) =>
                              prev.map((r) =>
                                r.id === row.id ? { ...r, expectedTime: e.target.value } : r
                              )
                            )
                          }
                          className="w-24 px-2 py-1 bg-white border border-slate-300 rounded font-mono text-xs"
                        />
                      </td>
                      <td className="p-2">
                        <select
                          aria-label={`第 ${idx + 1} 列實際出席情形`}
                          value={row.status}
                          onChange={(e) =>
                            setAttendanceRecords((prev) =>
                              prev.map((r) =>
                                r.id === row.id
                                  ? { ...r, status: e.target.value as AttendanceStatus }
                                  : r
                              )
                            )
                          }
                          className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-medium"
                        >
                          {ATTENDANCE_STATUSES.map((st) => (
                            <option key={st} value={st}>
                              {st}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="p-2 text-center">
                        <input
                          type="checkbox"
                          aria-label={`第 ${idx + 1} 列是否經校方核准請假`}
                          checked={row.isApprovedLeave}
                          onChange={(e) =>
                            setAttendanceRecords((prev) =>
                              prev.map((r) =>
                                r.id === row.id
                                  ? { ...r, isApprovedLeave: e.target.checked }
                                  : r
                              )
                            )
                          }
                          className="w-4 h-4 accent-slate-900 cursor-pointer"
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="text"
                          aria-label={`第 ${idx + 1} 列請假或缺席原因`}
                          value={row.reason}
                          onChange={(e) =>
                            setAttendanceRecords((prev) =>
                              prev.map((r) =>
                                r.id === row.id ? { ...r, reason: e.target.value } : r
                              )
                            )
                          }
                          placeholder="如：公假參賽"
                          className="w-28 px-2 py-1 bg-white border border-slate-300 rounded text-xs"
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="text"
                          aria-label={`第 ${idx + 1} 列備註`}
                          value={row.note}
                          onChange={(e) =>
                            setAttendanceRecords((prev) =>
                              prev.map((r) =>
                                r.id === row.id ? { ...r, note: e.target.value } : r
                              )
                            )
                          }
                          placeholder="勤務表現紀錄"
                          className="w-40 px-2 py-1 bg-white border border-slate-300 rounded text-xs"
                        />
                      </td>
                      <td className="p-2 text-right">
                        <button
                          type="button"
                          onClick={() => handleRemoveAttendanceRow(row.id)}
                          aria-label={`刪除第 ${idx + 1} 列出席紀錄`}
                          className="p-1 text-red-600 hover:bg-red-50 rounded cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Verifiable Evidence Checkboxes */}
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg flex flex-wrap items-center justify-between gap-3 text-xs">
              <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                <FileCheck2 className="w-4 h-4 text-slate-700" />
                <span>可查證佐證資料勾選（評核應以可查證資料為依據）：</span>
              </span>
              <div className="flex flex-wrap items-center gap-4">
                {ALL_EVIDENCES.map((evType) => (
                  <label
                    key={evType}
                    className="inline-flex items-center gap-1.5 cursor-pointer select-none font-medium text-slate-800"
                  >
                    <input
                      type="checkbox"
                      checked={evidences.includes(evType)}
                      onChange={() => handleToggleEvidence(evType)}
                      className="w-4 h-4 accent-slate-900"
                    />
                    <span>{evType}</span>
                  </label>
                ))}
              </div>
            </div>
          </section>

          {/* ECHO Privacy Defense & Style Suppression Section */}
          <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  ECHO 匿名互評防反推保護區（正則去識別化遮罩 ＆ 強制中性行政語氣轉換）
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  系統即時偵測並將姓名、自稱詞（我是/身為...）、學號、Email、網址及特定數字替換為 <span className="font-mono">[NAME]</span>、<span className="font-mono">[ID]</span>、<span className="font-mono">[EMAIL]</span>、<span className="font-mono">[URL]</span>、<span className="font-mono">[NUM]</span> 佔位符。
                </p>
              </div>
              <button
                type="button"
                onClick={handleApplyEchoNeutralizer}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Wand2 className="w-3.5 h-3.5" />
                <span>一鍵轉換為中性行政語氣 (ECHO Style Suppression)</span>
              </button>
            </div>

            {/* Standard Objective Evaluation Chips */}
            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-slate-700">
                客觀制式評語快速標籤（點擊直接帶入客觀敘述）：
              </div>
              <div className="flex flex-wrap gap-2">
                {ECHO_STANDARD_CHIPS.map((chip, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => handleAppendEchoChip(chip)}
                    className="px-2.5 py-1.5 text-xs text-slate-700 bg-slate-100 border border-slate-200 rounded-md hover:bg-slate-200 transition-colors cursor-pointer text-left"
                  >
                    + {chip}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="echo-comment-input"
                  className="block text-xs font-semibold text-slate-700 mb-1.5"
                >
                  綜合評核意見輸入（可測試輸入「我是會長、王小明、B11201001、超讚」觀察右側即時遮罩）
                </label>
                <textarea
                  id="echo-comment-input"
                  rows={4}
                  value={overallComment}
                  onChange={(e) => setOverallComment(e.target.value)}
                  placeholder="請輸入客觀服務表現評語..."
                  className="w-full p-3 text-xs bg-white border border-slate-300 rounded-lg leading-relaxed"
                />
              </div>

              <div className="p-3.5 bg-emerald-50/70 border border-emerald-200 rounded-lg flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-900 mb-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-700" />
                    <span>ECHO 正則去識別化即時預覽（送出時強制僅保存淨化後文本）：</span>
                  </div>
                  <p className="text-xs text-slate-800 leading-relaxed font-mono bg-white/90 p-2.5 rounded border border-emerald-200 min-h-[4.5rem]">
                    {echoPreviewComment || '（尚無文字）'}
                  </p>
                </div>
                <div className="text-[11px] text-emerald-800 mt-2">
                  🔒 按下底部「提交匿名評核表」時，系統將強制執行 ECHO 正則遮罩與中性行政語氣轉換，絕不保存原始未遮罩自稱文字。
                </div>
              </div>
            </div>
          </section>

          {/* 4. 評核結果與點數自動換算區 */}
          <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  4. 評核結果與點數自動換算區
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  原訂最高點數 × 核發比例 = 建議核發點數（以 0.5 點為最小核發單位，最終由校方於後台核定）。
                </p>
              </div>

              {/* 0.5 Point Rounding Mode Switcher */}
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => setRoundingMode('round')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                    roundingMode === 'round'
                      ? 'bg-white text-slate-900 shadow-xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  四捨五入至 0.5 點
                </button>
                <button
                  type="button"
                  onClick={() => setRoundingMode('floor')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                    roundingMode === 'floor'
                      ? 'bg-white text-slate-900 shadow-xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  無條件捨去至 0.5 點
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
                <div className="text-slate-500 mb-1">服務表現總分</div>
                <div className="text-2xl font-bold font-mono text-slate-900 tabular-nums">
                  {totalScore} <span className="text-xs font-normal">/ 100 分</span>
                </div>
              </div>
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
                <div className="text-slate-500 mb-1">換算評核等級 / 核發比例</div>
                <div className="text-2xl font-bold font-mono text-slate-900 tabular-nums">
                  {gradeResult.grade} 等級{' '}
                  <span className="text-sm font-semibold text-emerald-700">
                    （{Math.round(gradeResult.ratio * 100)}%）
                  </span>
                </div>
              </div>
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
                <div className="text-slate-500 mb-1">原始計算點數</div>
                <div className="text-lg font-bold font-mono text-slate-800 tabular-nums">
                  {drawnTarget.maxPoints.toFixed(1)} × {Math.round(gradeResult.ratio * 100)}% ={' '}
                  {gradeResult.rawPoints.toFixed(2)} 點
                </div>
              </div>
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg">
                <div className="text-emerald-800 font-semibold mb-1">
                  建議核發點數（0.5 點單位）
                </div>
                <div className="text-2xl font-bold font-mono text-emerald-900 tabular-nums">
                  {gradeResult.suggestedPoints.toFixed(1)} 點
                </div>
              </div>
            </div>

            {/* Grade Scale Reference Table */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[11px] font-mono">
              {[
                { g: 'A', range: '90–100 分', pct: '100%' },
                { g: 'B', range: '80–89 分', pct: '80%' },
                { g: 'C', range: '70–79 分', pct: '60%' },
                { g: 'D', range: '60–69 分', pct: '40%' },
                { g: 'E', range: '未滿 60 分', pct: '0%' },
              ].map((tier) => (
                <div
                  key={tier.g}
                  className={`p-2 rounded border text-center ${
                    gradeResult.grade === tier.g
                      ? 'bg-slate-900 text-white border-slate-900 font-bold'
                      : 'bg-white text-slate-600 border-slate-200'
                  }`}
                >
                  <div>{tier.g} 等級（核發 {tier.pct}）</div>
                  <div className="opacity-80">{tier.range}</div>
                </div>
              ))}
            </div>

            {/* Submit Button */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-3 border-t border-slate-200">
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <Lock className="w-4 h-4 text-slate-700 shrink-0" />
                <span>
                  送出後即刻鎖定狀態並焚毀抽籤映射票券，產生 <span className="font-mono">#ANON-XXXXXX</span> 盲籤憑證。
                </span>
              </div>
              <button
                type="button"
                data-testid="submit-evaluation-btn"
                onClick={handleSubmitEvaluation}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 text-sm font-bold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap"
              >
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>提交匿名評核表並鎖定（自動執行 ECHO 淨化）</span>
              </button>
            </div>
          </section>
        </div>
      )}

      {/* 5. 評核注意事項 Footer */}
      <footer className="bg-white border border-slate-200 rounded-xl p-5 text-xs text-slate-600 space-y-2">
        <div className="font-bold text-slate-900">
          5. 評核注意事項（依《115學年度系學會服務學習點數評核表》規範）：
        </div>
        <ol className="list-decimal list-inside space-y-1 leading-relaxed">
          {noticeItems.map((note, idx) => (
            <li key={idx}>{note}</li>
          ))}
        </ol>
      </footer>
    </div>
  );
};
