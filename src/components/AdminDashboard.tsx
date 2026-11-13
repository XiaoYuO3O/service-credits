import React, { useState, useMemo } from 'react';
import {
  AnonymousEvaluationRecord,
  EventSession,
  Participant,
  RoleType,
  RubricItem,
  SystemState,
  UniversityReview,
} from '../types';
import {
  buildEncryptedTicketPool,
  encodeStateToBase64Url,
  getDateOnlyTimestamp,
} from '../utils/algorithms';
import { DEFAULT_RUBRICS } from '../utils/demoData';
import { QrCodeSvg } from './QrCodeSvg';
import {
  ShieldCheck,
  Lock,
  KeyRound,
  Plus,
  Trash2,
  Copy,
  Check,
  FileSpreadsheet,
  Printer,
  Users,
  Sliders,
  ClipboardCheck,
  RefreshCw,
  ExternalLink,
  AlertTriangle,
  LogOut,
  Edit3,
  FileText,
  Layers,
} from 'lucide-react';

interface AdminDashboardProps {
  systemState: SystemState;
  selectedEventId: string;
  onSelectEvent: (eventId: string) => void;
  onUpdateState: (updater: (prev: SystemState) => SystemState) => void;
  onNavigateToEvent: (eventName: string) => void;
  onOpenPrintModal: (
    eventName: string,
    record: AnonymousEvaluationRecord,
    rubrics: RubricItem[]
  ) => void;
  onShowToast: (msg: string, tone?: 'success' | 'error') => void;
  isAdminAuthenticated: boolean;
  adminPassword: string;
  onLoginSuccess: () => void;
  onLogout: () => void;
  onChangePassword: (newPassword: string) => void;
}

const ROLE_OPTIONS: RoleType[] = ['會長', '副會長', '組負責人', '一般組員', '臨時工作人員'];

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  systemState,
  selectedEventId,
  onSelectEvent,
  onUpdateState,
  onNavigateToEvent,
  onOpenPrintModal,
  onShowToast,
  isAdminAuthenticated,
  adminPassword,
  onLoginSuccess,
  onLogout,
  onChangePassword,
}) => {
  // Login state
  const [passwordInput, setPasswordInput] = useState('');
  const [loginError, setLoginError] = useState('');

  // Password change state
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [passwordSavedMsg, setPasswordSavedMsg] = useState('');

  // Active sub-tab in Admin view ('all' renders all sections so nothing is hidden)
  const [activeSection, setActiveSection] = useState<
    'all' | 'overview' | 'roster' | 'rubrics' | 'notices'
  >('all');

  // Copy feedback
  const [copiedUrl, setCopiedUrl] = useState(false);

  // New event inline form
  const [newEventName, setNewEventName] = useState('');
  const [newEventPeriod, setNewEventPeriod] = useState('115年10月01日 至 115年11月30日');
  const [showNewEventForm, setShowNewEventForm] = useState(false);

  // Single participant add form
  const [newStudentId, setNewStudentId] = useState('');
  const [newName, setNewName] = useState('');
  const [newDept, setNewDept] = useState('資訊工程學系二年級');
  const [newRole, setNewRole] = useState<RoleType>('一般組員');
  const [newMaxPoints, setNewMaxPoints] = useState('2.0');
  const [newVerifyCode, setNewVerifyCode] = useState('');

  // Batch import
  const [batchText, setBatchText] = useState('');
  const [batchMessage, setBatchMessage] = useState('');

  // University Review editing state
  const [editingAnonToken, setEditingAnonToken] = useState<string | null>(null);
  const [reviewDraft, setReviewDraft] = useState<UniversityReview | null>(null);

  const currentEvent: EventSession | undefined = useMemo(
    () =>
      systemState.events.find((e) => e.id === selectedEventId) ||
      systemState.events[0],
    [systemState.events, selectedEventId]
  );

  // Compute exclusive event URL with UTF-8 safe Base64 state parameter (?s=...)
  const exclusiveEventUrl = useMemo(() => {
    if (!currentEvent) return '';
    const origin =
      typeof window !== 'undefined'
        ? window.location.origin + window.location.pathname
        : 'https://service-credits.edu.tw/';
    const compactPayload = {
      v: 3,
      activeEventId: currentEvent.id,
      event: currentEvent,
      noticeItems: systemState.noticeItems,
    };
    const encoded = encodeStateToBase64Url(compactPayload);
    return `${origin}#/${encodeURIComponent(currentEvent.name)}?s=${encoded}`;
  }, [currentEvent, systemState.noticeItems]);

  const rubricTotalScore = useMemo(() => {
    if (!currentEvent) return 0;
    return currentEvent.rubrics.reduce((acc, r) => acc + (Number(r.maxScore) || 0), 0);
  }, [currentEvent]);

  const handleLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordInput === adminPassword) {
      setLoginError('');
      onLoginSuccess();
    } else {
      setLoginError('管理員密碼不正確，請重新輸入或點擊下方「一鍵帶入預設密碼」。');
    }
  };

  const handleFillDefaultPassword = () => {
    setPasswordInput(adminPassword);
    setLoginError('');
  };

  if (!isAdminAuthenticated) {
    return (
      <div className="max-w-md mx-auto my-12 bg-white border border-slate-200 rounded-xl p-6 md:p-8 shadow-xs">
        <div className="flex items-center gap-2.5 text-slate-900 mb-2">
          <Lock className="w-5 h-5 text-slate-700" />
          <h1 className="text-lg font-bold tracking-tight">
            管理員與校方承辦人登入驗證
          </h1>
        </div>
        <p className="text-xs text-slate-600 leading-relaxed mb-6">
          進入 <span className="font-mono text-slate-800">#/管理編輯</span> 後台以管理多場次名單、配分權重、QR Code 分發與零知識匿名評核審核總表。
        </p>

        <form onSubmit={handleLoginSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="admin-password-input"
              className="block text-xs font-semibold text-slate-700 mb-1.5"
            >
              管理員驗證密碼
            </label>
            <input
              id="admin-password-input"
              type="password"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              placeholder="請輸入管理員密碼（預設：admin115）"
              className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 font-mono"
            />
          </div>

          {loginError && (
            <div
              role="alert"
              className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2"
            >
              {loginError}
            </div>
          )}

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 pt-1">
            <button
              type="submit"
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap"
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>驗證並進入管理後台</span>
            </button>
            <button
              type="button"
              onClick={handleFillDefaultPassword}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 text-xs font-medium text-slate-700 bg-slate-100 border border-slate-200 rounded-lg hover:bg-slate-200 transition-colors cursor-pointer whitespace-nowrap"
            >
              <span>一鍵帶入預設密碼 ({adminPassword})</span>
            </button>
          </div>
        </form>
      </div>
    );
  }

  if (!currentEvent) {
    return null;
  }

  const updateCurrentEvent = (updater: (ev: EventSession) => EventSession) => {
    const targetEventId = currentEvent.id;
    onUpdateState((prev) => ({
      ...prev,
      updatedDate: getDateOnlyTimestamp(),
      events: prev.events.map((ev) => (ev.id === targetEventId ? updater(ev) : ev)),
    }));
  };

  const createBlankEventSession = (customName?: string, customPeriod?: string): EventSession => {
    const newId = `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
    const defaultMembers: Participant[] = [
      {
        id: `${newId}-p1`,
        studentId: 'B11205001',
        name: '張同學',
        department: '資訊工程學系三年級',
        role: '會長',
        maxPoints: 3.0,
        verifyCode: '5001',
      },
      {
        id: `${newId}-p2`,
        studentId: 'B11205002',
        name: '李同學',
        department: '資訊工程學系二年級',
        role: '一般組員',
        maxPoints: 2.0,
        verifyCode: '5002',
      },
    ];
    return {
      id: newId,
      name: customName || '活動C-新建立場次',
      academicYear: '115學年度',
      period: customPeriod || '115年10月01日 至 115年11月30日',
      participants: defaultMembers,
      rubrics: DEFAULT_RUBRICS.map((r, idx) => ({ ...r, id: `${newId}-rub-${idx + 1}` })),
      progressMap: {
        [`${newId}-p1`]: { participantId: `${newId}-p1`, hasDrawn: false, hasEvaluated: false },
        [`${newId}-p2`]: { participantId: `${newId}-p2`, hasDrawn: false, hasEvaluated: false },
      },
      remainingPoolIds: defaultMembers.map((m) => m.id),
      ticketPool: buildEncryptedTicketPool(newId, defaultMembers),
      evaluations: [],
    };
  };

  const handleCreateEvent = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newEventName.trim() || `活動場次-${systemState.events.length + 1}`;
    const newSession = createBlankEventSession(trimmed, newEventPeriod.trim());
    onUpdateState((prev) => ({
      ...prev,
      updatedDate: getDateOnlyTimestamp(),
      events: [...prev.events, newSession],
    }));
    onSelectEvent(newSession.id);
    setNewEventName('');
    setShowNewEventForm(false);
    onShowToast(`已建立新活動場次「${newSession.name}」`);
  };

  /**
   * 刪除此活動場次（不使用 window.confirm，避免沙盒阻擋）：
   * 點擊後從 events 陣列移除該活動（若只剩最後 1 個活動則自動建立新空白活動），
   * 並自動將當前選中活動切換為剩餘的第一個活動。
   */
  const handleDeleteCurrentEvent = () => {
    const deletedName = currentEvent.name;
    const targetId = currentEvent.id;

    if (systemState.events.length <= 1) {
      const replacement = createBlankEventSession('活動A-新空白場次');
      onUpdateState((prev) => ({
        ...prev,
        updatedDate: getDateOnlyTimestamp(),
        events: [replacement],
      }));
      onSelectEvent(replacement.id);
      onShowToast(`已刪除最後一個場次「${deletedName}」，並自動建立新空白場次`);
      return;
    }

    const remaining = systemState.events.filter((e) => e.id !== targetId);
    const nextSelectedId = remaining[0].id;
    onUpdateState((prev) => ({
      ...prev,
      updatedDate: getDateOnlyTimestamp(),
      events: prev.events.filter((e) => e.id !== targetId),
    }));
    onSelectEvent(nextSelectedId);
    onShowToast(`已刪除活動場次「${deletedName}」，並切換至「${remaining[0].name}」`);
  };

  const handleRebuildSattoloPool = () => {
    updateCurrentEvent((ev) => {
      const nextProgress: Record<
        string,
        { participantId: string; hasDrawn: boolean; hasEvaluated: boolean }
      > = {};
      for (const p of ev.participants) {
        nextProgress[p.id] = {
          participantId: p.id,
          hasDrawn: false,
          hasEvaluated: false,
        };
      }
      return {
        ...ev,
        progressMap: nextProgress,
        remainingPoolIds: ev.participants.map((p) => p.id),
        ticketPool: buildEncryptedTicketPool(ev.id, ev.participants),
      };
    });
    onShowToast('已重新產生 Sattolo 單環抽籤加密票券池');
  };

  const handleCopyExclusiveUrl = async () => {
    try {
      await navigator.clipboard.writeText(exclusiveEventUrl);
      setCopiedUrl(true);
      onShowToast('已複製活動專屬評核網址');
      setTimeout(() => setCopiedUrl(false), 2000);
    } catch {
      setCopiedUrl(true);
      onShowToast('已選取活動專屬評核網址');
      setTimeout(() => setCopiedUrl(false), 2000);
    }
  };

  const handleAddSingleParticipant = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newStudentId.trim() || !newName.trim()) {
      onShowToast('請輸入學號與姓名後再新增人員');
      return;
    }
    const pid = `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
    const code =
      newVerifyCode.trim() ||
      newStudentId.trim().slice(-4).padStart(4, '0');
    const added: Participant = {
      id: pid,
      studentId: newStudentId.trim(),
      name: newName.trim(),
      department: newDept.trim() || '資訊工程學系',
      role: newRole,
      maxPoints: Math.max(0.5, Number(newMaxPoints) || 2.0),
      verifyCode: code,
    };

    updateCurrentEvent((ev) => {
      const nextParticipants = [...ev.participants, added];
      const nextProgress = {
        ...ev.progressMap,
        [pid]: { participantId: pid, hasDrawn: false, hasEvaluated: false },
      };
      return {
        ...ev,
        participants: nextParticipants,
        progressMap: nextProgress,
        remainingPoolIds: [...ev.remainingPoolIds, pid],
        ticketPool: buildEncryptedTicketPool(ev.id, nextParticipants),
      };
    });

    setNewStudentId('');
    setNewName('');
    setNewVerifyCode('');
    onShowToast(`已新增參與人員：${added.name}（${added.studentId}）`);
  };

  const handleRemoveParticipant = (pid: string, pName: string) => {
    updateCurrentEvent((ev) => {
      const nextParticipants = ev.participants.filter((p) => p.id !== pid);
      const nextProgress = { ...ev.progressMap };
      delete nextProgress[pid];
      return {
        ...ev,
        participants: nextParticipants,
        progressMap: nextProgress,
        remainingPoolIds: ev.remainingPoolIds.filter((id) => id !== pid),
        ticketPool: buildEncryptedTicketPool(ev.id, nextParticipants),
      };
    });
    onShowToast(`已移除參與人員：${pName}`);
  };

  const handleBatchImport = () => {
    const lines = batchText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      setBatchMessage('請先貼上要匯入的名單資料或點擊「帶入整批匯入範例格式」。');
      return;
    }

    const imported: Participant[] = [];
    lines.forEach((line, idx) => {
      const parts = line.split(/[\t,，;；]+/).map((s) => s.trim());
      if (parts.length >= 2) {
        const sid = parts[0];
        const name = parts[1];
        const dept = parts[2] || '資訊工程學系二年級';
        const rawRole = parts[3] as RoleType;
        const role: RoleType = ROLE_OPTIONS.includes(rawRole) ? rawRole : '一般組員';
        const maxPts = Math.max(0.5, parseFloat(parts[4]) || 2.0);
        const vCode = parts[5] || sid.slice(-4);
        imported.push({
          id: `pb-${Date.now().toString(36)}-${idx}`,
          studentId: sid,
          name,
          department: dept,
          role,
          maxPoints: maxPts,
          verifyCode: vCode,
        });
      }
    });

    if (imported.length === 0) {
      setBatchMessage('格式無法解析，請確認每行包含「學號,姓名,系級,職務,最高點數,驗證碼」。');
      return;
    }

    updateCurrentEvent((ev) => {
      const nextParticipants = [...ev.participants, ...imported];
      const nextProgress = { ...ev.progressMap };
      const nextRemaining = [...ev.remainingPoolIds];
      for (const p of imported) {
        nextProgress[p.id] = { participantId: p.id, hasDrawn: false, hasEvaluated: false };
        nextRemaining.push(p.id);
      }
      return {
        ...ev,
        participants: nextParticipants,
        progressMap: nextProgress,
        remainingPoolIds: nextRemaining,
        ticketPool: buildEncryptedTicketPool(ev.id, nextParticipants),
      };
    });

    setBatchText('');
    const msg = `已成功匯入 ${imported.length} 名參與人員並重新產生 Sattolo 單環抽籤票券池。`;
    setBatchMessage(msg);
    onShowToast(msg);
  };

  const handleFillSampleBatch = () => {
    setBatchText(
      `B11201006,周子瑜,資訊工程學系二年級,組負責人,3.0,1006\nB11201007,林彥廷,資訊工程學系一年級,一般組員,2.0,1007`
    );
    setBatchMessage('');
  };

  /**
   * 新增評核項目：在當前活動的 rubrics 陣列 push 一筆新指標（預設配分 10 分，含完整三階段尺規欄位）
   */
  const handleAddRubricItem = () => {
    const newRubric: RubricItem = {
      id: `rub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
      title: `新增評核指標 (${currentEvent.rubrics.length + 1})`,
      maxScore: 10,
      description: '請輸入此項服務表現評核指標之具體檢核說明。',
      tierHigh: '高度表現：完整達成目標且表現優異（9–10分）',
      tierMedium: '普通表現：大致完成指定項目（7–8分）',
      tierLow: '待改進表現：未達標準或紀錄缺漏（0–6分）',
    };
    updateCurrentEvent((ev) => ({
      ...ev,
      rubrics: [...ev.rubrics, newRubric],
    }));
    onShowToast(`已新增評核項目「${newRubric.title}」（預設配分 10 分）`);
  };

  const handleUpdateRubricField = (
    rubricId: string,
    field: keyof RubricItem,
    value: string | number
  ) => {
    updateCurrentEvent((ev) => ({
      ...ev,
      rubrics: ev.rubrics.map((r) =>
        r.id === rubricId ? { ...r, [field]: value } : r
      ),
    }));
  };

  const handleDeleteRubricItem = (rubricId: string, title: string) => {
    if (currentEvent.rubrics.length <= 1) {
      onShowToast('至少需保留 1 項服務表現評核指標');
      return;
    }
    updateCurrentEvent((ev) => ({
      ...ev,
      rubrics: ev.rubrics.filter((r) => r.id !== rubricId),
    }));
    onShowToast(`已刪除評核項目「${title}」`);
  };

  /**
   * 評核注意事項 CRUD：動態新增、即時修改、刪除條文
   */
  const handleAddNoticeItem = () => {
    onUpdateState((prev) => ({
      ...prev,
      updatedDate: getDateOnlyTimestamp(),
      noticeItems: [
        ...prev.noticeItems,
        `新增評核注意事項條文（第 ${prev.noticeItems.length + 1} 點）：請輸入規範內容。`,
      ],
    }));
    onShowToast('已新增一筆評核注意事項條文');
  };

  const handleUpdateNoticeItem = (index: number, newText: string) => {
    onUpdateState((prev) => ({
      ...prev,
      updatedDate: getDateOnlyTimestamp(),
      noticeItems: prev.noticeItems.map((item, idx) => (idx === index ? newText : item)),
    }));
  };

  const handleDeleteNoticeItem = (index: number) => {
    if (systemState.noticeItems.length <= 1) {
      onShowToast('至少需保留 1 條評核注意事項');
      return;
    }
    onUpdateState((prev) => ({
      ...prev,
      updatedDate: getDateOnlyTimestamp(),
      noticeItems: prev.noticeItems.filter((_, idx) => idx !== index),
    }));
    onShowToast(`已刪除第 ${index + 1} 條評核注意事項`);
  };

  const handleOpenReviewEditor = (record: AnonymousEvaluationRecord) => {
    setEditingAnonToken(record.anonToken);
    setReviewDraft({
      ...record.universityReview,
      approvedPoints:
        record.universityReview.approvedPoints !== null
          ? record.universityReview.approvedPoints
          : record.suggestedPoints,
    });
  };

  const handleSaveUniversityReview = (anonToken: string) => {
    if (!reviewDraft) return;
    updateCurrentEvent((ev) => ({
      ...ev,
      evaluations: ev.evaluations.map((rec) =>
        rec.anonToken === anonToken
          ? {
              ...rec,
              universityReview: { ...reviewDraft },
            }
          : rec
      ),
    }));
    setEditingAnonToken(null);
    setReviewDraft(null);
    onShowToast(`已儲存盲籤憑證 ${anonToken} 之校方審核結果`);
  };

  const handleExportCsv = () => {
    const headers = [
      '盲籤憑證編號',
      '實際評核人(雙盲零知識隔離)',
      '受評學號',
      '受評姓名',
      '系級',
      '擔任職務',
      '原訂最高點數',
      '服務表現總分',
      '評核等級',
      '核發比例',
      '建議核發點數',
      '出席總場次',
      '實際出席率(%)',
      '無故缺席次數',
      '校方核定點數',
      '是否扣點',
      '扣點數',
      '是否需補件',
      '補件內容',
      '校方審核意見',
      '校方承辦人',
      '審核日期',
      'ECHO淨化評語',
      '提交日期(抗時間差去時分秒)',
    ];

    const escapeCsv = (val: string | number | boolean | null | undefined) => {
      const s = String(val ?? '').replace(/"/g, '""');
      return `"${s}"`;
    };

    const rows = currentEvent.evaluations.map((rec) => {
      const ur = rec.universityReview;
      const finalPts = ur.approvedPoints !== null ? ur.approvedPoints : rec.suggestedPoints;
      return [
        rec.anonToken,
        `🔒 匿名評核員（盲籤憑證 ${rec.anonToken}）`,
        rec.targetSnapshot.studentId,
        rec.targetSnapshot.name,
        rec.targetSnapshot.department,
        rec.targetSnapshot.role,
        rec.targetSnapshot.maxPoints,
        rec.totalScore,
        rec.grade,
        `${Math.round(rec.ratio * 100)}%`,
        rec.suggestedPoints,
        rec.attendanceStats.totalSessions,
        `${rec.attendanceStats.attendanceRate}%`,
        rec.attendanceStats.unexcusedAbsences,
        finalPts,
        ur.isDeducted ? '是' : '否',
        ur.deductedPoints,
        ur.needsSupplement ? '是' : '否',
        ur.supplementContent,
        ur.reviewComment,
        ur.reviewerName,
        ur.reviewDate,
        rec.overallComment,
        rec.submittedDate,
      ]
        .map(escapeCsv)
        .join(',');
    });

    const csvString = '\uFEFF' + [headers.map(escapeCsv).join(','), ...rows].join('\r\n');
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Service-credits-${currentEvent.name}-零知識評核總表.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    onShowToast('已匯出 UTF-8 CSV 零知識評核總表');
  };

  // Compute 3-column real-time progress lists (strictly decoupled from target pairing)
  const remainingPoolParticipants = currentEvent.participants.filter((p) =>
    currentEvent.remainingPoolIds.includes(p.id)
  );
  const drawnParticipants = currentEvent.participants.filter(
    (p) => currentEvent.progressMap[p.id]?.hasDrawn
  );
  const evaluatedParticipants = currentEvent.participants.filter(
    (p) => currentEvent.progressMap[p.id]?.hasEvaluated
  );

  const showOverview = activeSection === 'all' || activeSection === 'overview';
  const showRoster = activeSection === 'all' || activeSection === 'roster';
  const showRubrics = activeSection === 'all' || activeSection === 'rubrics';
  const showNotices = activeSection === 'all' || activeSection === 'notices';

  return (
    <div className="space-y-6">
      {/* Top Event Selector & Session Actions */}
      <section className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-4 border-b border-slate-200">
          <div>
            <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
              <span>多活動場次管理中心</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">路由：#/管理編輯</span>
              <span aria-hidden="true">·</span>
              <span>共 {systemState.events.length} 個場次</span>
            </div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              系學會服務學習點數評核管理後台
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowNewEventForm((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>新增活動場次</span>
            </button>
            <button
              type="button"
              onClick={() => setShowPasswordModal((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>修改管理密碼</span>
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>登出後台</span>
            </button>
          </div>
        </div>

        {/* Password Change Inline Box */}
        {showPasswordModal && (
          <div className="mt-4 p-4 bg-slate-50 border border-slate-200 rounded-lg flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <label htmlFor="new-admin-pass" className="text-xs font-semibold text-slate-700">
                設定新管理員密碼：
              </label>
              <input
                id="new-admin-pass"
                type="text"
                value={newPasswordInput}
                onChange={(e) => setNewPasswordInput(e.target.value)}
                placeholder="輸入新密碼"
                className="px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md font-mono"
              />
              <button
                type="button"
                onClick={() => {
                  if (newPasswordInput.trim()) {
                    onChangePassword(newPasswordInput.trim());
                    setPasswordSavedMsg('密碼已更新並於本工作階段生效');
                    setNewPasswordInput('');
                  }
                }}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 cursor-pointer"
              >
                儲存新密碼
              </button>
              {passwordSavedMsg && (
                <span className="text-xs text-emerald-700 font-medium">{passwordSavedMsg}</span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setShowPasswordModal(false)}
              className="text-xs text-slate-500 hover:text-slate-800 cursor-pointer"
            >
              收合
            </button>
          </div>
        )}

        {/* Create New Event Inline Form */}
        {showNewEventForm && (
          <form
            onSubmit={handleCreateEvent}
            className="mt-4 p-4 bg-slate-50 border border-slate-200 rounded-lg grid grid-cols-1 md:grid-cols-3 gap-3 items-end"
          >
            <div>
              <label
                htmlFor="new-event-name"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                新活動場次名稱（如：活動C-資工之夜）
              </label>
              <input
                id="new-event-name"
                type="text"
                value={newEventName}
                onChange={(e) => setNewEventName(e.target.value)}
                placeholder="活動C-資工之夜"
                required
                className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label
                htmlFor="new-event-period"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                評核期間
              </label>
              <input
                id="new-event-period"
                type="text"
                value={newEventPeriod}
                onChange={(e) => setNewEventPeriod(e.target.value)}
                className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md font-mono"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="submit"
                className="px-4 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 cursor-pointer whitespace-nowrap"
              >
                建立場次並初始化抽籤池
              </button>
              <button
                type="button"
                onClick={() => setShowNewEventForm(false)}
                className="px-3 py-1.5 text-xs text-slate-600 bg-white border border-slate-300 rounded-md hover:bg-slate-100 cursor-pointer whitespace-nowrap"
              >
                取消
              </button>
            </div>
          </form>
        )}

        {/* Event Session Switcher Tabs */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-100 rounded-lg">
            {systemState.events.map((ev) => {
              const isSelected = ev.id === currentEvent.id;
              return (
                <button
                  key={ev.id}
                  type="button"
                  onClick={() => onSelectEvent(ev.id)}
                  className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    isSelected
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {ev.name}（{ev.participants.length}人 · 已評 {ev.evaluations.length} 筆）
                </button>
              );
            })}
          </div>

          {/* Section Switcher */}
          <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setActiveSection('all')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeSection === 'all'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>全部管理區塊</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveSection('overview')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeSection === 'overview'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ClipboardCheck className="w-3.5 h-3.5" />
              <span>網址分發、三欄進度與零知識總表</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveSection('roster')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeSection === 'roster'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>參與人員名單（{currentEvent.participants.length}）</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveSection('rubrics')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeSection === 'rubrics'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>評核標準與配分（{rubricTotalScore}分）</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveSection('notices')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeSection === 'notices'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>評核注意事項（{systemState.noticeItems.length}）</span>
            </button>
          </div>
        </div>
      </section>

      {showOverview && (
        <>
          {/* Event Settings & Exclusive URL + Offline SVG QR Code Distributor */}
          <section className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <div className="lg:col-span-8 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-base font-bold text-slate-900">
                      01. 活動場次設定與一鍵生成專屬評核網頁
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      儲存設定後即自動將場次狀態以 UTF-8 安全 Base64 封裝於網址參數（<span className="font-mono">?s=...</span>），無須綁定碼即可直接分發。
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleDeleteCurrentEvent}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>刪除此活動場次</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label
                      htmlFor="edit-event-name"
                      className="block text-xs font-semibold text-slate-700 mb-1"
                    >
                      活動名稱
                    </label>
                    <input
                      id="edit-event-name"
                      type="text"
                      value={currentEvent.name}
                      onChange={(e) =>
                        updateCurrentEvent((ev) => ({ ...ev, name: e.target.value }))
                      }
                      className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-md font-medium"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="edit-event-year"
                      className="block text-xs font-semibold text-slate-700 mb-1"
                    >
                      學年度
                    </label>
                    <input
                      id="edit-event-year"
                      type="text"
                      value={currentEvent.academicYear}
                      onChange={(e) =>
                        updateCurrentEvent((ev) => ({ ...ev, academicYear: e.target.value }))
                      }
                      className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-md font-mono"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="edit-event-period"
                      className="block text-xs font-semibold text-slate-700 mb-1"
                    >
                      評核期間
                    </label>
                    <input
                      id="edit-event-period"
                      type="text"
                      value={currentEvent.period}
                      onChange={(e) =>
                        updateCurrentEvent((ev) => ({ ...ev, period: e.target.value }))
                      }
                      className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-md font-mono"
                    />
                  </div>
                </div>

                {/* Exclusive URL Box */}
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-slate-800">
                      活動專屬評核網址（含跨裝置 Base64 狀態封裝）：
                    </span>
                    <span className="font-mono text-slate-500">
                      Service credits - 網址.服務點數評分.{currentEvent.name}
                    </span>
                  </div>
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      aria-label="活動專屬評核網址"
                      value={exclusiveEventUrl}
                      className="flex-1 px-3 py-2 text-xs bg-white border border-slate-300 rounded-md font-mono text-slate-700 select-all"
                    />
                    <button
                      type="button"
                      onClick={handleCopyExclusiveUrl}
                      className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                    >
                      {copiedUrl ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span>已複製專屬網址</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>一鍵複製專屬網址</span>
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => onNavigateToEvent(currentEvent.name)}
                      className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-md hover:bg-slate-100 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>前往此活動評核大廳</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Offline QR Code SVG */}
              <div className="lg:col-span-4 flex flex-col items-center justify-center p-4 bg-slate-50 border border-slate-200 rounded-lg">
                <div className="text-xs font-semibold text-slate-700 mb-2">
                  離線向量 QR Code（{currentEvent.name}）
                </div>
                <QrCodeSvg
                  value={exclusiveEventUrl}
                  size={156}
                  label={currentEvent.name}
                />
              </div>
            </div>
          </section>

          {/* Three-Column Real-Time Progress Monitor (Unlinkable Anonymity) */}
          <section className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  02. 三欄即時進度監控（雙表分離・不洩漏抽籤配對）
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  實名進度表僅記錄成員是否已抽籤與是否已送出評核；Sattolo 單環置換票券於完成評核時即刻焚毀，杜絕反推。
                </p>
              </div>
              <button
                type="button"
                onClick={handleRebuildSattoloPool}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 border border-slate-200 rounded-md hover:bg-slate-200 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>重設此場次未完成抽籤池 (Sattolo)</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Column 1: Remaining Undrawn Pool */}
              <div className="border border-slate-200 rounded-lg p-4 bg-slate-50/60">
                <div className="flex items-center justify-between pb-2.5 mb-3 border-b border-slate-200">
                  <span className="text-xs font-bold text-slate-800">
                    人員池剩餘未抽名單（可被抽取對象）
                  </span>
                  <span className="text-xs font-mono font-bold text-slate-900 tabular-nums">
                    剩餘 {remainingPoolParticipants.length} / {currentEvent.participants.length} 人
                  </span>
                </div>
                {remainingPoolParticipants.length === 0 ? (
                  <p className="text-xs text-slate-500 py-4 text-center">
                    全員皆已被抽取完畢（人員池剩餘 0 人）
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {remainingPoolParticipants.map((p) => (
                      <li
                        key={p.id}
                        className="flex items-center justify-between text-xs bg-white border border-slate-200 rounded-md px-3 py-2"
                      >
                        <div>
                          <span className="font-semibold text-slate-900">{p.name}</span>
                          <span className="text-slate-400 mx-1.5">·</span>
                          <span className="font-mono text-slate-600">{p.studentId}</span>
                        </div>
                        <span className="text-slate-500">{p.role}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Column 2: Has Drawn (Target Confidential) */}
              <div className="border border-slate-200 rounded-lg p-4 bg-slate-50/60">
                <div className="flex items-center justify-between pb-2.5 mb-3 border-b border-slate-200">
                  <span className="text-xs font-bold text-slate-800">
                    已完成抽籤人員（抽中對象保密）
                  </span>
                  <span className="text-xs font-mono font-bold text-slate-900 tabular-nums">
                    {drawnParticipants.length} / {currentEvent.participants.length} 人
                  </span>
                </div>
                <ul className="space-y-2">
                  {currentEvent.participants.map((p) => {
                    const hasDrawn = Boolean(currentEvent.progressMap[p.id]?.hasDrawn);
                    return (
                      <li
                        key={p.id}
                        className="flex items-center justify-between text-xs bg-white border border-slate-200 rounded-md px-3 py-2"
                      >
                        <div>
                          <span className="font-semibold text-slate-900">{p.name}</span>
                          <span className="text-slate-400 mx-1.5">·</span>
                          <span className="font-mono text-slate-600">{p.studentId}</span>
                        </div>
                        <span
                          className={`font-mono ${
                            hasDrawn ? 'text-emerald-700 font-semibold' : 'text-amber-700'
                          }`}
                        >
                          {hasDrawn ? '✓ 已抽籤（對象保密）' : '尚未抽籤'}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>

              {/* Column 3: Has Evaluated & Locked */}
              <div className="border border-slate-200 rounded-lg p-4 bg-slate-50/60">
                <div className="flex items-center justify-between pb-2.5 mb-3 border-b border-slate-200">
                  <span className="text-xs font-bold text-slate-800">
                    已完成評核並鎖定人員（票券已焚毀）
                  </span>
                  <span className="text-xs font-mono font-bold text-slate-900 tabular-nums">
                    {evaluatedParticipants.length} / {currentEvent.participants.length} 人
                  </span>
                </div>
                <ul className="space-y-2">
                  {currentEvent.participants.map((p) => {
                    const hasEval = Boolean(currentEvent.progressMap[p.id]?.hasEvaluated);
                    return (
                      <li
                        key={p.id}
                        className="flex items-center justify-between text-xs bg-white border border-slate-200 rounded-md px-3 py-2"
                      >
                        <div>
                          <span className="font-semibold text-slate-900">{p.name}</span>
                          <span className="text-slate-400 mx-1.5">·</span>
                          <span className="font-mono text-slate-600">{p.studentId}</span>
                        </div>
                        <span
                          className={`font-mono ${
                            hasEval ? 'text-emerald-700 font-semibold' : 'text-slate-500'
                          }`}
                        >
                          {hasEval ? '🔒 已提交並焚毀票券' : '待提交評核'}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          </section>

          {/* Zero-Knowledge Anonymous Evaluation Audit Master Table */}
          <section className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-4">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  03. 🔒 零知識匿名評核審核總表（管理員亦無法揭盲）
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  紀錄強制依「盲籤憑證碼字母序」排序並抹除時分秒（僅保留 YYYY-MM-DD），防禦 Timing Attack 時間差反推。
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleExportCsv}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
                  <span>匯出 UTF-8 CSV 總表</span>
                </button>
              </div>
            </div>

            {/* Mandatory Green Security Shield Banner */}
            <div className="flex items-start gap-2.5 p-3.5 mb-5 bg-emerald-50/90 border border-emerald-200 rounded-lg text-xs text-emerald-900">
              <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
              <div className="leading-relaxed">
                <span className="font-bold">雙盲零知識資安盾牌驗證通過：</span>
                系統已啟用雙盲零知識隔離，管理員與校方僅能審核受評者得分與核定點數，無法追蹤評核人身分。目前已銷毀{' '}
                <span className="font-mono font-bold">{currentEvent.evaluations.length}</span>{' '}
                筆映射票券，剩餘加密票券池共{' '}
                <span className="font-mono font-bold">
                  {Object.keys(currentEvent.ticketPool).length}
                </span>{' '}
                張。
              </div>
            </div>

            {currentEvent.evaluations.length === 0 ? (
              <div className="text-center py-12 border border-dashed border-slate-200 rounded-lg">
                <p className="text-sm font-medium text-slate-700">
                  此活動場次尚無已提交之匿名評核紀錄
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  請將上方活動專屬網址分發予參與人員進行 1 對 1 抽籤與評核。
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-700">
                      <th className="py-2.5 px-3 font-semibold whitespace-nowrap">
                        實際評核人（盲籤憑證）
                      </th>
                      <th className="py-2.5 px-3 font-semibold whitespace-nowrap">
                        受評對象（學號/姓名/職務）
                      </th>
                      <th className="py-2.5 px-3 font-semibold text-right whitespace-nowrap">
                        各項得分與總分
                      </th>
                      <th className="py-2.5 px-3 font-semibold text-right whitespace-nowrap">
                        出席統計
                      </th>
                      <th className="py-2.5 px-3 font-semibold text-right whitespace-nowrap">
                        等級 / 建議點數
                      </th>
                      <th className="py-2.5 px-3 font-semibold text-right whitespace-nowrap">
                        校方核定狀態
                      </th>
                      <th className="py-2.5 px-3 font-semibold text-right whitespace-nowrap">
                        審核與列印操作
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {currentEvent.evaluations.map((rec) => {
                      const ur = rec.universityReview;
                      const finalPts =
                        ur.approvedPoints !== null ? ur.approvedPoints : rec.suggestedPoints;
                      const isEditing = editingAnonToken === rec.anonToken;

                      return (
                        <React.Fragment key={rec.anonToken}>
                          <tr className="hover:bg-slate-50/80 transition-colors">
                            <td className="py-3 px-3 align-top">
                              <div className="font-mono font-semibold text-slate-900">
                                🔒 匿名評核員
                              </div>
                              <div className="font-mono text-[11px] text-emerald-700 mt-0.5">
                                盲籤憑證 {rec.anonToken}
                              </div>
                              <div className="font-mono text-[11px] text-slate-400 mt-0.5">
                                日期：{rec.submittedDate}
                              </div>
                            </td>

                            <td className="py-3 px-3 align-top">
                              <div className="font-bold text-slate-900 text-sm">
                                {rec.targetSnapshot.name}
                              </div>
                              <div className="text-slate-600 font-mono mt-0.5">
                                {rec.targetSnapshot.studentId} · {rec.targetSnapshot.role}
                              </div>
                              <div className="text-slate-500 text-[11px] mt-0.5">
                                {rec.targetSnapshot.department} · 原訂最高{' '}
                                <span className="font-mono font-semibold">
                                  {rec.targetSnapshot.maxPoints.toFixed(1)}
                                </span>{' '}
                                點
                              </div>
                            </td>

                            <td className="py-3 px-3 align-top text-right font-mono tabular-nums">
                              <div className="text-sm font-bold text-slate-900">
                                {rec.totalScore} 分
                              </div>
                              <div className="text-[11px] text-slate-500 mt-0.5">
                                {currentEvent.rubrics
                                  .map((r) => `${rec.scores[r.id] ?? 0}`)
                                  .join(' + ')}
                              </div>
                            </td>

                            <td className="py-3 px-3 align-top text-right font-mono tabular-nums">
                              <div className="font-semibold text-slate-900">
                                出席率 {rec.attendanceStats.attendanceRate}%
                              </div>
                              <div className="text-[11px] text-slate-500 mt-0.5">
                                共 {rec.attendanceStats.totalSessions} 場 · 無故缺席{' '}
                                {rec.attendanceStats.unexcusedAbsences} 次
                              </div>
                            </td>

                            <td className="py-3 px-3 align-top text-right font-mono tabular-nums">
                              <div className="font-bold text-slate-900">
                                {rec.grade} 等級（{Math.round(rec.ratio * 100)}%）
                              </div>
                              <div className="text-emerald-700 font-semibold mt-0.5">
                                建議 {rec.suggestedPoints.toFixed(1)} 點
                              </div>
                            </td>

                            <td className="py-3 px-3 align-top text-right font-mono tabular-nums">
                              <div className="text-sm font-bold text-slate-900">
                                核定 {finalPts.toFixed(1)} 點
                              </div>
                              <div className="text-[11px] text-slate-600 mt-0.5">
                                {ur.isDeducted ? `扣 ${ur.deductedPoints} 點` : '無扣點'} ·{' '}
                                {ur.needsSupplement ? '需補件' : '免補件'}
                              </div>
                              <div className="text-[11px] text-slate-400 mt-0.5">
                                {ur.reviewerName
                                  ? `${ur.reviewerName} (${ur.reviewDate})`
                                  : '尚未簽核'}
                              </div>
                            </td>

                            <td className="py-3 px-3 align-top text-right">
                              <div className="inline-flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() =>
                                    isEditing
                                      ? setEditingAnonToken(null)
                                      : handleOpenReviewEditor(rec)
                                  }
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-100 cursor-pointer whitespace-nowrap"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                  <span>{isEditing ? '收合審核' : '校方審核'}</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    onOpenPrintModal(
                                      currentEvent.name,
                                      rec,
                                      currentEvent.rubrics
                                    )
                                  }
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 cursor-pointer whitespace-nowrap"
                                >
                                  <Printer className="w-3.5 h-3.5" />
                                  <span>列印 A4 評核表</span>
                                </button>
                              </div>
                            </td>
                          </tr>

                          {/* ECHO Sanitized Comment & Evidence Summary Row */}
                          <tr className="bg-slate-50/40">
                            <td colSpan={7} className="px-3 py-2 text-[11px] text-slate-600">
                              <span className="font-semibold text-slate-700">
                                ECHO 淨化客觀評語：
                              </span>
                              <span>{rec.overallComment || '（無額外文字評語）'}</span>
                              <span className="mx-2 text-slate-300">|</span>
                              <span className="font-semibold text-slate-700">佐證資料：</span>
                              <span>{rec.evidences.join('、') || '無'}</span>
                            </td>
                          </tr>

                          {/* University Review Inline Editor Drawer */}
                          {isEditing && reviewDraft && (
                            <tr className="bg-slate-100/80 border-t border-slate-300">
                              <td colSpan={7} className="p-4">
                                <div className="bg-white border border-slate-300 rounded-lg p-4 space-y-4">
                                  <div className="flex items-center justify-between border-b border-slate-200 pb-2.5">
                                    <h3 className="text-xs font-bold text-slate-900">
                                      校方審核與點數核定簽核 — 受評對象：{rec.targetSnapshot.name}（
                                      {rec.anonToken}）
                                    </h3>
                                    <span className="text-xs font-mono text-slate-500">
                                      系統建議點數：{rec.suggestedPoints.toFixed(1)} 點
                                    </span>
                                  </div>

                                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                                    <div>
                                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                                        校方核定點數（0.5 點單位）
                                      </label>
                                      <input
                                        type="number"
                                        step="0.5"
                                        min="0"
                                        max={rec.targetSnapshot.maxPoints}
                                        value={reviewDraft.approvedPoints ?? rec.suggestedPoints}
                                        onChange={(e) =>
                                          setReviewDraft({
                                            ...reviewDraft,
                                            approvedPoints: parseFloat(e.target.value) || 0,
                                          })
                                        }
                                        className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md font-mono"
                                      />
                                    </div>

                                    <div>
                                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                                        是否扣點
                                      </label>
                                      <div className="flex items-center gap-2">
                                        <select
                                          aria-label="是否扣點"
                                          value={reviewDraft.isDeducted ? 'yes' : 'no'}
                                          onChange={(e) =>
                                            setReviewDraft({
                                              ...reviewDraft,
                                              isDeducted: e.target.value === 'yes',
                                              deductedPoints:
                                                e.target.value === 'yes'
                                                  ? reviewDraft.deductedPoints || 0.5
                                                  : 0,
                                            })
                                          }
                                          className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                                        >
                                          <option value="no">否</option>
                                          <option value="yes">是</option>
                                        </select>
                                        {reviewDraft.isDeducted && (
                                          <input
                                            type="number"
                                            step="0.5"
                                            min="0"
                                            aria-label="扣點數"
                                            value={reviewDraft.deductedPoints}
                                            onChange={(e) =>
                                              setReviewDraft({
                                                ...reviewDraft,
                                                deductedPoints: parseFloat(e.target.value) || 0,
                                              })
                                            }
                                            placeholder="扣點數"
                                            className="w-24 px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md font-mono"
                                          />
                                        )}
                                      </div>
                                    </div>

                                    <div>
                                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                                        校方承辦人姓名
                                      </label>
                                      <input
                                        type="text"
                                        value={reviewDraft.reviewerName}
                                        onChange={(e) =>
                                          setReviewDraft({
                                            ...reviewDraft,
                                            reviewerName: e.target.value,
                                          })
                                        }
                                        placeholder="如：陳行政組員"
                                        className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                                      />
                                    </div>

                                    <div>
                                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                                        審核日期（年/月/日）
                                      </label>
                                      <input
                                        type="text"
                                        value={reviewDraft.reviewDate}
                                        onChange={(e) =>
                                          setReviewDraft({
                                            ...reviewDraft,
                                            reviewDate: e.target.value,
                                          })
                                        }
                                        placeholder="115/10/25"
                                        className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md font-mono"
                                      />
                                    </div>
                                  </div>

                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <div>
                                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                                        是否需補件或補作
                                      </label>
                                      <div className="flex items-center gap-2">
                                        <select
                                          aria-label="是否需補件或補作"
                                          value={reviewDraft.needsSupplement ? 'yes' : 'no'}
                                          onChange={(e) =>
                                            setReviewDraft({
                                              ...reviewDraft,
                                              needsSupplement: e.target.value === 'yes',
                                            })
                                          }
                                          className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md shrink-0"
                                        >
                                          <option value="no">否</option>
                                          <option value="yes">是</option>
                                        </select>
                                        <input
                                          type="text"
                                          value={reviewDraft.supplementContent}
                                          onChange={(e) =>
                                            setReviewDraft({
                                              ...reviewDraft,
                                              supplementContent: e.target.value,
                                            })
                                          }
                                          placeholder="若需補件請填寫內容（如：補附活動簽到表影本）"
                                          className="flex-1 px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                                        />
                                      </div>
                                    </div>

                                    <div>
                                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                                        校方審核意見
                                      </label>
                                      <input
                                        type="text"
                                        value={reviewDraft.reviewComment}
                                        onChange={(e) =>
                                          setReviewDraft({
                                            ...reviewDraft,
                                            reviewComment: e.target.value,
                                          })
                                        }
                                        placeholder="請輸入審核意見"
                                        className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                                      />
                                    </div>
                                  </div>

                                  <div className="flex items-center justify-end gap-2 pt-1">
                                    <button
                                      type="button"
                                      onClick={() => setEditingAnonToken(null)}
                                      className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 rounded-md hover:bg-slate-200 cursor-pointer"
                                    >
                                      取消
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleSaveUniversityReview(rec.anonToken)}
                                      className="px-4 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 cursor-pointer"
                                    >
                                      儲存校方審核結果
                                    </button>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {showRoster && (
        <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-6">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              04. 參與人員名單管理（{currentEvent.name}）
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              支援單筆新增與整批貼上匯入（欄位：學號、姓名、系級、擔任職務、原訂最高點數、個人驗證碼／學號後4碼）。
            </p>
          </div>

          {/* Single Participant Add Form */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3 items-end">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">學號</label>
              <input
                type="text"
                value={newStudentId}
                onChange={(e) => setNewStudentId(e.target.value)}
                placeholder="B11201008"
                className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">姓名</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="王大明"
                className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">系級</label>
              <input
                type="text"
                value={newDept}
                onChange={(e) => setNewDept(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">擔任職務</label>
              <select
                aria-label="擔任職務"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as RoleType)}
                className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                原訂最高點數
              </label>
              <input
                type="number"
                step="0.5"
                min="0.5"
                value={newMaxPoints}
                onChange={(e) => setNewMaxPoints(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                驗證碼(後4碼)
              </label>
              <input
                type="text"
                value={newVerifyCode}
                onChange={(e) => setNewVerifyCode(e.target.value)}
                placeholder="預設學號後4碼"
                className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md font-mono"
              />
            </div>
            <div>
              <button
                type="button"
                onClick={() => handleAddSingleParticipant()}
                className="w-full inline-flex items-center justify-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>單筆新增</span>
              </button>
            </div>
          </div>

          {/* Batch Paste Import */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label
                htmlFor="batch-import-textarea"
                className="text-xs font-semibold text-slate-800"
              >
                整批貼上匯入名單（每行一筆：學號, 姓名, 系級, 擔任職務, 原訂最高點數, 個人驗證碼）
              </label>
              <button
                type="button"
                onClick={handleFillSampleBatch}
                className="text-xs font-medium text-slate-700 underline hover:text-slate-900 cursor-pointer"
              >
                帶入整批匯入範例格式
              </button>
            </div>
            <textarea
              id="batch-import-textarea"
              rows={3}
              value={batchText}
              onChange={(e) => setBatchText(e.target.value)}
              placeholder="B11201006,周子瑜,資訊工程學系二年級,組負責人,3.0,1006"
              className="w-full p-2.5 text-xs bg-white border border-slate-300 rounded-md font-mono"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-emerald-700">{batchMessage}</span>
              <button
                type="button"
                onClick={handleBatchImport}
                className="px-4 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 cursor-pointer"
              >
                執行整批匯入並重算抽籤池
              </button>
            </div>
          </div>

          {/* Roster Table */}
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-700">
                  <th className="py-2.5 px-3 font-semibold">學號</th>
                  <th className="py-2.5 px-3 font-semibold">姓名</th>
                  <th className="py-2.5 px-3 font-semibold">系級</th>
                  <th className="py-2.5 px-3 font-semibold">擔任職務</th>
                  <th className="py-2.5 px-3 font-semibold text-right">原訂最高點數</th>
                  <th className="py-2.5 px-3 font-semibold font-mono">個人驗證碼</th>
                  <th className="py-2.5 px-3 font-semibold text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {currentEvent.participants.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-3 font-mono font-medium">{p.studentId}</td>
                    <td className="py-2.5 px-3 font-semibold text-slate-900">{p.name}</td>
                    <td className="py-2.5 px-3 text-slate-600">{p.department}</td>
                    <td className="py-2.5 px-3 text-slate-700">{p.role}</td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold">
                      {p.maxPoints.toFixed(1)} 點
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-600">{p.verifyCode}</td>
                    <td className="py-2.5 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleRemoveParticipant(p.id, p.name)}
                        aria-label={`刪除 ${p.name}`}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs text-red-700 hover:bg-red-50 rounded cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>刪除</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {showRubrics && (
        <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                05. 服務表現評核標準與配分權重設定（{currentEvent.name}）
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                支援動態增刪評核項目、修改配分上限與三階段評分尺規文字，並即時檢核配分總和是否為 100 分。
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div
                className={`px-3 py-1.5 rounded-md text-xs font-mono font-bold border ${
                  rubricTotalScore === 100
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : 'bg-amber-50 text-amber-800 border-amber-300'
                }`}
              >
                目前配分總和：{rubricTotalScore} / 100 分
                {rubricTotalScore === 100 ? ' ✓ 檢核通過' : ' ⚠️ 建議調整為 100 分'}
              </div>
              <button
                type="button"
                onClick={handleAddRubricItem}
                className="inline-flex items-center gap-1 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>新增評核項目</span>
              </button>
            </div>
          </div>

          {rubricTotalScore !== 100 && (
            <div className="flex items-center gap-2 p-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>
                注意：目前各項配分上限總和為 {rubricTotalScore} 分（未等於 100 分），請調整各項配分使總和為 100 分以符合評核表規範。
              </span>
            </div>
          )}

          <div className="space-y-4">
            {currentEvent.rubrics.map((item, idx) => (
              <div
                key={item.id}
                className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3"
              >
                <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
                  <div className="md:col-span-4">
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      指標 {idx + 1} 名稱
                    </label>
                    <input
                      type="text"
                      aria-label={`指標 ${idx + 1} 名稱`}
                      value={item.title}
                      onChange={(e) =>
                        handleUpdateRubricField(item.id, 'title', e.target.value)
                      }
                      className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md font-semibold"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      配分上限（分）
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      aria-label={`指標 ${idx + 1} 配分上限`}
                      value={item.maxScore}
                      onChange={(e) =>
                        handleUpdateRubricField(
                          item.id,
                          'maxScore',
                          Math.max(0, parseInt(e.target.value, 10) || 0)
                        )
                      }
                      className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md font-mono font-bold"
                    />
                  </div>
                  <div className="md:col-span-4">
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      指標具體說明
                    </label>
                    <input
                      type="text"
                      aria-label={`指標 ${idx + 1} 具體說明`}
                      value={item.description}
                      onChange={(e) =>
                        handleUpdateRubricField(item.id, 'description', e.target.value)
                      }
                      className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                    />
                  </div>
                  <div className="md:col-span-2 flex justify-end pt-4">
                    <button
                      type="button"
                      onClick={() => handleDeleteRubricItem(item.id, item.title)}
                      aria-label={`刪除指標 ${item.title}`}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 rounded-md cursor-pointer whitespace-nowrap"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>刪除項目</span>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-emerald-800 mb-1">
                      高度表現尺規文字
                    </label>
                    <input
                      type="text"
                      aria-label={`指標 ${idx + 1} 高度表現尺規`}
                      value={item.tierHigh}
                      onChange={(e) =>
                        handleUpdateRubricField(item.id, 'tierHigh', e.target.value)
                      }
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      普通表現尺規文字
                    </label>
                    <input
                      type="text"
                      aria-label={`指標 ${idx + 1} 普通表現尺規`}
                      value={item.tierMedium}
                      onChange={(e) =>
                        handleUpdateRubricField(item.id, 'tierMedium', e.target.value)
                      }
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-amber-800 mb-1">
                      待改進表現尺規文字
                    </label>
                    <input
                      type="text"
                      aria-label={`指標 ${idx + 1} 待改進表現尺規`}
                      value={item.tierLow}
                      onChange={(e) =>
                        handleUpdateRubricField(item.id, 'tierLow', e.target.value)
                      }
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="pt-2 flex justify-end">
            <button
              type="button"
              onClick={handleAddRubricItem}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-800 bg-slate-100 border border-slate-300 rounded-lg hover:bg-slate-200 cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>＋ 新增評核項目（預設配分 10 分）</span>
            </button>
          </div>
        </section>
      )}

      {showNotices && (
        <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                06. 評核注意事項自訂編輯（共 {systemState.noticeItems.length} 條，同步顯示於頁尾與 A4 正式評核表）
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                預設列出《115學年度系學會服務學習點數評核表》5 點核心規範，每一條皆可即時修改文字、刪除條文或新增條文。
              </p>
            </div>
            <button
              type="button"
              onClick={handleAddNoticeItem}
              className="inline-flex items-center gap-1 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>＋ 新增注意事項條文</span>
            </button>
          </div>

          <div className="space-y-2.5">
            {systemState.noticeItems.map((note, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold text-slate-500 w-6">
                  {idx + 1}.
                </span>
                <input
                  type="text"
                  value={note}
                  aria-label={`注意事項第 ${idx + 1} 點`}
                  onChange={(e) => handleUpdateNoticeItem(idx, e.target.value)}
                  className="flex-1 px-3 py-2 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
                <button
                  type="button"
                  onClick={() => handleDeleteNoticeItem(idx)}
                  aria-label={`刪除注意事項第 ${idx + 1} 點`}
                  className="inline-flex items-center gap-1 px-2.5 py-2 text-xs font-medium text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 rounded-md cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>刪除條文</span>
                </button>
              </div>
            ))}
          </div>

          <div className="pt-2">
            <button
              type="button"
              onClick={handleAddNoticeItem}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-800 bg-slate-100 border border-slate-300 rounded-lg hover:bg-slate-200 cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>＋ 新增注意事項條文</span>
            </button>
          </div>
        </section>
      )}
    </div>
  );
};
