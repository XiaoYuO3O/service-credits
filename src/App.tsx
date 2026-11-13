import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  AnonymousEvaluationRecord,
  EventSession,
  RubricItem,
  SystemState,
} from './types';
import { createInitialSystemState, DEFAULT_RUBRICS, DEFAULT_NOTICE_ITEMS } from './utils/demoData';
import {
  decodeStateFromBase64Url,
  sortEvaluationsByAnonToken,
} from './utils/algorithms';
import { AdminDashboard } from './components/AdminDashboard';
import { EventEvaluationPortal } from './components/EventEvaluationPortal';
import { PrintSheetA4 } from './components/PrintSheetA4';
import { RefreshCw, Globe, RotateCcw, CheckCircle2, AlertCircle, X } from 'lucide-react';

export const STORAGE_KEY = 'service_credits_state_v3';
const LEGACY_KEYS = ['service_credits_state_v1', 'service_credits_state_v2'];
const CONSUMED_S_STORAGE_KEY = 'service_credits_consumed_s_v3';
const ADMIN_AUTH_KEY = 'service_credits_admin_auth_v3';
const ADMIN_PASS_KEY = 'service_credits_admin_pass_v3';
const BROADCAST_CHANNEL_NAME = 'service_credits_sync_channel_v3';

export type ToastTone = 'success' | 'error';

export interface RouteParsed {
  mode: 'admin' | 'event';
  eventName: string;
  base64State: string | null;
}

function extractSParamFromQuery(queryPart: string): string | null {
  if (!queryPart) return null;
  const cleanQuery = queryPart.startsWith('?') ? queryPart.slice(1) : queryPart;
  const match = cleanQuery.match(/(?:^|&)s=([^&#]*)/);
  if (match && match[1]) {
    try {
      return decodeURIComponent(match[1]).trim();
    } catch {
      return match[1].trim();
    }
  }
  const params = new URLSearchParams(cleanQuery);
  return params.get('s');
}

/**
 * 1. 修復 ?s= 參數在 Hash 路由前後的解析與更新衝突：
 * - 支援 .../#/活動名稱?s=Base64（?s= 位於 # 之後）與 .../?s=Base64#/活動名稱（?s= 位於 # 之前）
 * - 提取活動路由名稱時，必定先以 .split('?')[0] 剝離後面的 ?s=... 查詢字串再做 decodeURIComponent
 */
export function parseHashRoute(
  hashStr: string,
  defaultEventName: string,
  searchStr: string = typeof window !== 'undefined' ? window.location.search : ''
): RouteParsed {
  let rawHash = hashStr.startsWith('#') ? hashStr.slice(1) : hashStr;

  // 若整個 hash 被多層 percent-encode（含 %3F），先安全解碼一次
  if (!rawHash.includes('?') && /%3[fF]/.test(rawHash)) {
    try {
      rawHash = decodeURIComponent(rawHash);
    } catch {
      // keep rawHash
    }
  }

  // 先用 .split('?')[0] 去除後面的 ?s=... 查詢字串
  const [rawPathPart, hashQueryPart = ''] = rawHash.split('?');
  let decodedPath = rawPathPart.replace(/^\/+/, '').trim();
  try {
    decodedPath = decodeURIComponent(decodedPath).trim();
  } catch {
    // keep rawPathPart if malformed URI
  }
  // 再次確保 decodeURIComponent 後不會殘留任何 ?s=... 字串
  decodedPath = decodedPath.split('?')[0].replace(/^\/+/, '').trim();

  const sFromHash = extractSParamFromQuery(hashQueryPart);
  const sFromSearch = extractSParamFromQuery(searchStr);
  const base64State = sFromHash || sFromSearch || null;

  if (
    !decodedPath ||
    decodedPath === '/' ||
    decodedPath === '管理編輯' ||
    decodedPath.startsWith('管理編輯')
  ) {
    return {
      mode: 'admin',
      eventName: defaultEventName,
      base64State,
    };
  }

  return {
    mode: 'event',
    eventName: decodedPath,
    base64State,
  };
}

/**
 * 防呆正規化函式：確保任何載入的 EventSession 欄位皆完整合法，防止舊版髒資料造成 TypeError
 */
function normalizeEventSession(ev: EventSession): EventSession {
  const participants = Array.isArray(ev.participants) ? ev.participants : [];
  const rubrics =
    Array.isArray(ev.rubrics) && ev.rubrics.length > 0
      ? ev.rubrics.map((r, i) => ({
          id: r.id || `rub-${i + 1}`,
          title: r.title || `評核指標 ${i + 1}`,
          maxScore: Number.isFinite(Number(r.maxScore)) ? Number(r.maxScore) : 10,
          description: r.description || '',
          tierHigh: r.tierHigh || '',
          tierMedium: r.tierMedium || '',
          tierLow: r.tierLow || '',
        }))
      : DEFAULT_RUBRICS.map((r) => ({ ...r }));

  const progressMap: EventSession['progressMap'] = {};
  for (const p of participants) {
    const existing = ev.progressMap?.[p.id];
    progressMap[p.id] = {
      participantId: p.id,
      hasDrawn: Boolean(existing?.hasDrawn),
      hasEvaluated: Boolean(existing?.hasEvaluated),
    };
  }

  const remainingPoolIds = Array.isArray(ev.remainingPoolIds)
    ? ev.remainingPoolIds.filter((id) => participants.some((p) => p.id === id))
    : participants.map((p) => p.id);

  const ticketPool =
    ev.ticketPool && typeof ev.ticketPool === 'object' ? { ...ev.ticketPool } : {};

  const evaluations = Array.isArray(ev.evaluations) ? ev.evaluations : [];

  return {
    id: ev.id || `evt-${Date.now()}`,
    name: ev.name || '活動A-迎新宿營',
    academicYear: ev.academicYear || '115學年度',
    period: ev.period || '115年09月01日 至 115年10月20日',
    participants,
    rubrics,
    progressMap,
    remainingPoolIds,
    ticketPool,
    evaluations,
  };
}

/**
 * 合併（Upsert）單一活動至既有活動物件，同時保留本地已提交之匿名評核紀錄與進度，防止舊 ?s= 快照覆蓋已提交結果
 */
function mergeEventPreservingLocalSubmissions(
  existingEv: EventSession,
  incomingEv: EventSession
): EventSession {
  const normalizedIncoming = normalizeEventSession(incomingEv);
  const normalizedExisting = normalizeEventSession(existingEv);

  // Union evaluations by anonToken so locally submitted evaluations are never lost
  const evalMap = new Map<string, AnonymousEvaluationRecord>();
  for (const rec of normalizedIncoming.evaluations) {
    if (rec && rec.anonToken) evalMap.set(rec.anonToken, rec);
  }
  for (const rec of normalizedExisting.evaluations) {
    if (rec && rec.anonToken) evalMap.set(rec.anonToken, rec);
  }
  const mergedEvaluations = sortEvaluationsByAnonToken(Array.from(evalMap.values()));

  // Merge progressMap: preserve hasDrawn / hasEvaluated if already true locally
  const mergedProgressMap: EventSession['progressMap'] = {};
  for (const p of normalizedIncoming.participants) {
    const incProg = normalizedIncoming.progressMap[p.id];
    const exProg = normalizedExisting.progressMap[p.id];
    mergedProgressMap[p.id] = {
      participantId: p.id,
      hasDrawn: Boolean(incProg?.hasDrawn || exProg?.hasDrawn),
      hasEvaluated: Boolean(incProg?.hasEvaluated || exProg?.hasEvaluated),
    };
  }

  const evaluatedTargetIds = new Set(mergedEvaluations.map((e) => e.targetId));
  const mergedRemainingPool = normalizedIncoming.remainingPoolIds.filter(
    (id) =>
      !evaluatedTargetIds.has(id) &&
      (normalizedExisting.remainingPoolIds.includes(id) ||
        normalizedExisting.evaluations.length === 0)
  );

  return {
    ...normalizedIncoming,
    id: normalizedExisting.id || normalizedIncoming.id,
    progressMap: mergedProgressMap,
    remainingPoolIds: mergedRemainingPool,
    evaluations: mergedEvaluations,
  };
}

/**
 * 3. 確保從 ?s= 解碼載入的活動能 100% 匹配並更新（Upsert）至 events 陣列：
 * 支援單一活動封裝（decoded.event 或直接 EventSession）與完整狀態封裝（decoded.events）
 */
function upsertDecodedPayloadIntoState(
  prevState: SystemState,
  decoded: unknown
): { nextState: SystemState; matchedEvent: EventSession | null } {
  if (!decoded || typeof decoded !== 'object') {
    return { nextState: prevState, matchedEvent: null };
  }

  const obj = decoded as {
    v?: number;
    activeEventId?: string;
    event?: EventSession;
    events?: EventSession[];
    noticeItems?: string[];
    id?: string;
    name?: string;
    participants?: unknown[];
  };

  let incomingEvents: EventSession[] = [];
  if (obj.event && typeof obj.event === 'object') {
    incomingEvents = [normalizeEventSession(obj.event)];
  } else if (Array.isArray(obj.events) && obj.events.length > 0) {
    incomingEvents = obj.events.map(normalizeEventSession);
  } else if (obj.id && obj.name && Array.isArray(obj.participants)) {
    incomingEvents = [normalizeEventSession(obj as unknown as EventSession)];
  }

  if (incomingEvents.length === 0) {
    return { nextState: prevState, matchedEvent: null };
  }

  let nextEvents = [...prevState.events];
  let primaryMatched: EventSession | null = null;

  for (const inc of incomingEvents) {
    const idx = nextEvents.findIndex(
      (e) => e.id === inc.id || e.name === inc.name
    );
    if (idx >= 0) {
      const merged = mergeEventPreservingLocalSubmissions(nextEvents[idx], inc);
      nextEvents[idx] = merged;
      if (!primaryMatched) primaryMatched = merged;
    } else {
      nextEvents.push(inc);
      if (!primaryMatched) primaryMatched = inc;
    }
  }

  const nextNoticeItems =
    Array.isArray(obj.noticeItems) && obj.noticeItems.length > 0
      ? obj.noticeItems
      : prevState.noticeItems;

  return {
    nextState: {
      ...prevState,
      events: nextEvents,
      noticeItems: nextNoticeItems,
    },
    matchedEvent: primaryMatched,
  };
}

function hasAlreadyConsumedSParam(sParam: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = sessionStorage.getItem(CONSUMED_S_STORAGE_KEY);
    if (!raw) return false;
    const list = JSON.parse(raw) as string[];
    return Array.isArray(list) && list.includes(sParam);
  } catch {
    return false;
  }
}

function markSParamConsumedInSession(sParam: string): void {
  if (typeof window === 'undefined' || !sParam) return;
  try {
    const raw = sessionStorage.getItem(CONSUMED_S_STORAGE_KEY);
    const list: string[] = raw ? JSON.parse(raw) : [];
    const safeList = Array.isArray(list) ? list : [];
    if (!safeList.includes(sParam)) {
      safeList.push(sParam);
      sessionStorage.setItem(CONSUMED_S_STORAGE_KEY, JSON.stringify(safeList));
    }
  } catch {
    // Ignore storage errors
  }
}

function loadInitialState(): {
  state: SystemState;
  initialEventId: string;
  hydratedS: string | null;
} {
  if (typeof window !== 'undefined') {
    try {
      for (const oldKey of LEGACY_KEYS) {
        localStorage.removeItem(oldKey);
      }
    } catch {
      // Ignore storage access errors
    }
  }

  const fallback = createInitialSystemState();
  let state: SystemState = fallback;
  let initialEventId = fallback.events[0]?.id || 'evt-a';
  let hydratedS: string | null = null;

  // 1. Load from v3 localStorage first
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as SystemState;
      if (parsed && Array.isArray(parsed.events) && parsed.events.length > 0) {
        state = {
          events: parsed.events.map(normalizeEventSession),
          noticeItems:
            Array.isArray(parsed.noticeItems) && parsed.noticeItems.length > 0
              ? parsed.noticeItems
              : [...DEFAULT_NOTICE_ITEMS],
          updatedDate: parsed.updatedDate || fallback.updatedDate,
        };
        initialEventId = state.events[0].id;
      }
    }
  } catch {
    state = fallback;
  }

  // 2. Check if URL has ?s=... parameter (either before # or after #)
  if (typeof window !== 'undefined') {
    const parsedRoute = parseHashRoute(
      window.location.hash || '',
      state.events[0]?.name || '活動A-迎新宿營',
      window.location.search || ''
    );

    if (parsedRoute.base64State) {
      hydratedS = parsedRoute.base64State;
      const alreadyConsumed = hasAlreadyConsumedSParam(parsedRoute.base64State);
      const decoded = decodeStateFromBase64Url<unknown>(parsedRoute.base64State);
      if (decoded) {
        const { nextState, matchedEvent } = upsertDecodedPayloadIntoState(
          state,
          decoded
        );
        if (!alreadyConsumed) {
          state = nextState;
          markSParamConsumedInSession(parsedRoute.base64State);
        } else {
          // Even if already consumed, ensure the event exists in state.events while preserving all local submissions
          state = nextState;
        }
        if (matchedEvent) {
          initialEventId = matchedEvent.id;
        }
      }
    }

    if (parsedRoute.mode === 'event') {
      const matched = state.events.find(
        (e) => e.name === parsedRoute.eventName || e.id === parsedRoute.eventName
      );
      if (matched) {
        initialEventId = matched.id;
      }
    }
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore
  }

  return { state, initialEventId, hydratedS };
}

export default function App() {
  const initialData = useMemo(() => loadInitialState(), []);
  const [systemState, setSystemState] = useState<SystemState>(initialData.state);
  const systemStateRef = useRef<SystemState>(initialData.state);
  const [selectedEventId, setSelectedEventId] = useState<string>(initialData.initialEventId);

  // 2. 全域鎖定旗標：每個 ?s= 最多只允許在進入頁面時被解析匯入 1 次；一旦抽籤或提交，永遠鎖定以本地 State 與 localStorage 為唯一真實來源
  const consumedUrlParamRef = useRef<string | null>(initialData.hydratedS);
  const hasConsumedUrlPayloadRef = useRef<boolean>(Boolean(initialData.hydratedS));

  useEffect(() => {
    systemStateRef.current = systemState;
  }, [systemState]);

  // Keep URL clean on initial mount if ?s= was present so refreshing never re-triggers stale ?s=
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const currentHash = window.location.hash || '';
    const currentSearch = window.location.search || '';
    if (currentHash.includes('?s=') || currentSearch.includes('s=')) {
      const parsed = parseHashRoute(
        currentHash,
        systemStateRef.current.events[0]?.name || '活動A-迎新宿營',
        currentSearch
      );
      const cleanHash =
        parsed.mode === 'admin'
          ? '#/管理編輯'
          : `#/${encodeURIComponent(parsed.eventName)}`;
      try {
        window.history.replaceState(null, '', `${window.location.pathname}${cleanHash}`);
        setHashRoute(cleanHash);
      } catch {
        // Ignore history errors
      }
    }
  }, []);

  // Toast notification state (supports 'success' green and 'error' red tones)
  const [toastState, setToastState] = useState<{
    message: string;
    tone: ToastTone;
  } | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const showToast = useCallback((message: string, tone: ToastTone = 'success') => {
    setToastState({ message, tone });
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastState(null);
    }, 4000);
  }, []);

  // Admin auth state (persisted in sessionStorage for current session)
  const [adminPassword, setAdminPassword] = useState<string>(() => {
    try {
      return sessionStorage.getItem(ADMIN_PASS_KEY) || 'admin115';
    } catch {
      return 'admin115';
    }
  });

  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(ADMIN_AUTH_KEY) === 'true';
    } catch {
      return false;
    }
  });

  // Current hash route state
  const [hashRoute, setHashRoute] = useState<string>(() =>
    typeof window !== 'undefined' ? window.location.hash || '#/管理編輯' : '#/管理編輯'
  );

  // Print Modal state
  const [printTarget, setPrintTarget] = useState<{
    eventName: string;
    record: AnonymousEvaluationRecord;
    rubrics: RubricItem[];
  } | null>(null);

  // BroadcastChannel & Storage synchronization across tabs
  useEffect(() => {
    let channel: BroadcastChannel | null = null;
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
        channel.onmessage = (ev) => {
          if (ev.data && Array.isArray(ev.data.events)) {
            const normalized: SystemState = {
              ...ev.data,
              events: ev.data.events.map(normalizeEventSession),
            };
            systemStateRef.current = normalized;
            setSystemState(normalized);
          }
        };
      }
    } catch {
      // Ignore BroadcastChannel unsupported errors
    }

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        try {
          const next = JSON.parse(e.newValue) as SystemState;
          if (next && Array.isArray(next.events)) {
            const normalized: SystemState = {
              ...next,
              events: next.events.map(normalizeEventSession),
            };
            systemStateRef.current = normalized;
            setSystemState(normalized);
          }
        } catch {
          // Ignore malformed storage
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      if (channel) channel.close();
    };
  }, []);

  /**
   * 鎖定 URL 快照旗標並清除網址上的 ?s=... 查詢字串（絕不觸發 hashchange）
   */
  const lockUrlPayloadAndCleanAddress = useCallback(() => {
    hasConsumedUrlPayloadRef.current = true;
    if (typeof window !== 'undefined') {
      try {
        const parsed = parseHashRoute(
          window.location.hash || '#/管理編輯',
          systemStateRef.current.events[0]?.name || '活動A-迎新宿營',
          window.location.search || ''
        );
        const cleanHash =
          parsed.mode === 'admin'
            ? '#/管理編輯'
            : `#/${encodeURIComponent(parsed.eventName)}`;
        window.history.replaceState(null, '', `${window.location.pathname}${cleanHash}`);
      } catch {
        // Ignore
      }
    }
  }, []);

  /**
   * 統一封裝之狀態更新函式 updateActivitiesState:
   * 同步更新 React State、寫入 localStorage、透過 BroadcastChannel 廣播，
   * 並以 window.history.replaceState 移除網址上的 ?s=... 查詢字串（保持 Hash 主體不變且絕不觸發 hashchange 重載）
   */
  const updateActivitiesState = useCallback(
    (updater: (prev: SystemState) => SystemState) => {
      hasConsumedUrlPayloadRef.current = true;

      const prev = systemStateRef.current;
      const rawNext = updater(prev);
      const next: SystemState = {
        ...rawNext,
        events: Array.isArray(rawNext.events)
          ? rawNext.events.map(normalizeEventSession)
          : prev.events,
        noticeItems:
          Array.isArray(rawNext.noticeItems) && rawNext.noticeItems.length > 0
            ? rawNext.noticeItems
            : prev.noticeItems,
      };

      systemStateRef.current = next;
      setSystemState(next);

      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        if (typeof BroadcastChannel !== 'undefined') {
          const bc = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
          bc.postMessage(next);
          bc.close();
        }
      } catch {
        // Ignore storage quota errors
      }

      if (typeof window !== 'undefined') {
        try {
          const currentHash = window.location.hash || '#/管理編輯';
          const parsed = parseHashRoute(
            currentHash,
            next.events[0]?.name || '活動A-迎新宿營',
            window.location.search || ''
          );
          if (parsed.mode === 'admin') {
            const cleanAdminUrl = `${window.location.pathname}#/管理編輯`;
            window.history.replaceState(null, '', cleanAdminUrl);
          } else {
            const targetEv =
              next.events.find(
                (e) => e.name === parsed.eventName || e.id === parsed.eventName
              ) || next.events[0];
            const cleanEventName = targetEv ? targetEv.name : parsed.eventName;
            const cleanEventHash = `#/${encodeURIComponent(cleanEventName)}`;
            window.history.replaceState(
              null,
              '',
              `${window.location.pathname}${cleanEventHash}`
            );
          }
        } catch {
          // Ignore history replaceState errors
        }
      }
    },
    []
  );

  // Listen to user-initiated hash changes ONLY
  useEffect(() => {
    const handleHashChange = () => {
      const currentHash = window.location.hash || '#/管理編輯';
      const currentSearch = window.location.search || '';
      const parsed = parseHashRoute(
        currentHash,
        systemStateRef.current.events[0]?.name || '活動A-迎新宿營',
        currentSearch
      );

      // Only consume a brand-new ?s= payload once on navigation into an event URL
      if (
        parsed.base64State &&
        parsed.base64State !== consumedUrlParamRef.current
      ) {
        consumedUrlParamRef.current = parsed.base64State;
        hasConsumedUrlPayloadRef.current = true;
        markSParamConsumedInSession(parsed.base64State);

        const decoded = decodeStateFromBase64Url<unknown>(parsed.base64State);
        if (decoded) {
          const { nextState, matchedEvent } = upsertDecodedPayloadIntoState(
            systemStateRef.current,
            decoded
          );
          systemStateRef.current = nextState;
          setSystemState(nextState);
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
          } catch {
            // Ignore
          }
          if (matchedEvent) {
            setSelectedEventId(matchedEvent.id);
          }
        }

        // Immediately strip ?s=... from the address bar via replaceState so it never overwrites future submissions
        const cleanHash =
          parsed.mode === 'admin'
            ? '#/管理編輯'
            : `#/${encodeURIComponent(parsed.eventName)}`;
        try {
          window.history.replaceState(null, '', `${window.location.pathname}${cleanHash}`);
        } catch {
          // Ignore
        }
        setHashRoute(cleanHash);
        return;
      }

      const cleanHash =
        parsed.mode === 'admin'
          ? '#/管理編輯'
          : `#/${encodeURIComponent(parsed.eventName)}`;

      if (currentHash.includes('?s=') || currentSearch.includes('s=')) {
        try {
          window.history.replaceState(null, '', `${window.location.pathname}${cleanHash}`);
        } catch {
          // Ignore
        }
      }

      setHashRoute(cleanHash);

      if (parsed.mode === 'event') {
        const matched = systemStateRef.current.events.find(
          (e) => e.name === parsed.eventName || e.id === parsed.eventName
        );
        if (matched) {
          setSelectedEventId(matched.id);
        }
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Ensure selectedEventId always points to an existing event
  useEffect(() => {
    if (
      systemState.events.length > 0 &&
      !systemState.events.some((e) => e.id === selectedEventId)
    ) {
      setSelectedEventId(systemState.events[0].id);
    }
  }, [systemState.events, selectedEventId]);

  const parsedRoute = useMemo(
    () =>
      parseHashRoute(
        hashRoute,
        systemState.events[0]?.name || '活動A-迎新宿營'
      ),
    [hashRoute, systemState.events]
  );

  const activeEventForPortal: EventSession = useMemo(() => {
    if (parsedRoute.mode === 'event') {
      const matched = systemState.events.find(
        (e) => e.name === parsedRoute.eventName || e.id === parsedRoute.eventName
      );
      if (matched) return matched;
    }
    return (
      systemState.events.find((e) => e.id === selectedEventId) ||
      systemState.events[0]
    );
  }, [parsedRoute, systemState.events, selectedEventId]);

  const navigateToHash = useCallback((targetHash: string) => {
    if (typeof window !== 'undefined') {
      window.location.hash = targetHash;
    }
    setHashRoute(targetHash);
  }, []);

  const handleResetDemoData = () => {
    const fresh = createInitialSystemState();
    consumedUrlParamRef.current = null;
    hasConsumedUrlPayloadRef.current = false;
    if (typeof window !== 'undefined') {
      try {
        sessionStorage.removeItem(CONSUMED_S_STORAGE_KEY);
        for (const ev of fresh.events) {
          sessionStorage.removeItem(`service_credits_last_receipt_v3_${ev.name}`);
        }
      } catch {
        // Ignore
      }
    }
    updateActivitiesState(() => fresh);
    setSelectedEventId(fresh.events[0].id);
    showToast('已重置為預設展示資料（活動A-迎新宿營、活動B-期末系大）', 'success');
  };

  // Logical URL Indicator text required by specification
  const logicalUrlIndicator =
    parsedRoute.mode === 'admin'
      ? '網址.服務點數評分.管理編輯'
      : `Service credits - 網址.服務點數評分.${activeEventForPortal?.name || '活動A-迎新宿營'}`;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Global Non-Blocking Toast Notification Bar */}
      {toastState && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-5 right-5 z-50 flex items-center gap-2.5 px-4 py-3 text-xs font-semibold text-white rounded-lg shadow-lg border no-print ${
            toastState.tone === 'error'
              ? 'bg-red-700 border-red-600'
              : 'bg-emerald-800 border-emerald-700'
          }`}
        >
          {toastState.tone === 'error' ? (
            <AlertCircle className="w-4 h-4 text-red-200 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-300 shrink-0" />
          )}
          <span>{toastState.message}</span>
          <button
            type="button"
            onClick={() => setToastState(null)}
            aria-label="關閉通知"
            className="p-0.5 text-white/80 hover:text-white cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main Application Shell (Hidden during A4 @media print when PrintSheetA4 is open) */}
      <div className={printTarget ? 'no-print' : ''}>
        {/* Top Bar Contract: 1-row, 3-zone header */}
        <header className="flex items-center justify-between gap-8 px-6 py-3.5 bg-white border-b border-slate-200">
          {/* Zone 1: Brand title, one line */}
          <a
            href="#/管理編輯"
            onClick={(e) => {
              e.preventDefault();
              navigateToHash('#/管理編輯');
            }}
            className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            Service credits
          </a>

          {/* Zone 2: Concise single-line navigation links */}
          <nav
            aria-label="主導覽列"
            className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600"
          >
            <a
              href="#/管理編輯"
              onClick={(e) => {
                e.preventDefault();
                navigateToHash('#/管理編輯');
              }}
              className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 ${
                parsedRoute.mode === 'admin'
                  ? 'text-slate-900 font-semibold underline underline-offset-4'
                  : ''
              }`}
            >
              管理編輯後台
            </a>
            {systemState.events.slice(0, 4).map((ev) => {
              const isCurrentEvent =
                parsedRoute.mode === 'event' && activeEventForPortal?.id === ev.id;
              return (
                <a
                  key={ev.id}
                  href={`#/${encodeURIComponent(ev.name)}`}
                  onClick={(e) => {
                    e.preventDefault();
                    setSelectedEventId(ev.id);
                    navigateToHash(`#/${encodeURIComponent(ev.name)}`);
                  }}
                  className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 ${
                    isCurrentEvent
                      ? 'text-slate-900 font-semibold underline underline-offset-4'
                      : ''
                  }`}
                >
                  {ev.name}
                </a>
              );
            })}
          </nav>

          {/* Zone 3: 1 primary action */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => {
                if (parsedRoute.mode === 'admin') {
                  navigateToHash(`#/${encodeURIComponent(activeEventForPortal.name)}`);
                } else {
                  navigateToHash('#/管理編輯');
                }
              }}
              className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {parsedRoute.mode === 'admin' ? '進入活動評核大廳' : '返回管理編輯後台'}
            </button>
          </div>
        </header>

        {/* Below-Header Toolbar: 🔄 快速切換視角工具列 & 邏輯網址指示器 */}
        <div className="bg-slate-100 border-b border-slate-200 px-6 py-2.5">
          <div className="max-w-7xl mx-auto flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2.5">
            {/* Quick Perspective Switcher */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700 whitespace-nowrap shrink-0">
                <RefreshCw className="w-3.5 h-3.5 text-slate-600" />
                <span>🔄 快速切換視角工具列：</span>
              </span>

              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => navigateToHash('#/管理編輯')}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    parsedRoute.mode === 'admin'
                      ? 'bg-slate-900 text-white font-semibold shadow-2xs'
                      : 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  管理員主網頁（#/管理編輯）
                </button>

                {systemState.events.map((ev) => {
                  const isActive =
                    parsedRoute.mode === 'event' && activeEventForPortal?.id === ev.id;
                  return (
                    <button
                      key={ev.id}
                      type="button"
                      onClick={() => {
                        setSelectedEventId(ev.id);
                        navigateToHash(`#/${encodeURIComponent(ev.name)}`);
                      }}
                      className={`px-3 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                        isActive
                          ? 'bg-slate-900 text-white font-semibold shadow-2xs'
                          : 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      活動專屬網頁（#/{ev.name}）
                    </button>
                  );
                })}

                <button
                  type="button"
                  onClick={handleResetDemoData}
                  title="還原預設展示資料（活動A與活動B）"
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-slate-600 bg-white border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>重置展示資料</span>
                </button>
              </div>
            </div>

            {/* Logical URL Indicator */}
            <div className="flex items-center gap-2 text-xs font-mono bg-white border border-slate-300 rounded-md px-3 py-1 text-slate-800 shrink-0">
              <Globe className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <span className="text-slate-500">邏輯網址：</span>
              <span className="font-semibold" data-testid="logical-url-indicator">
                {logicalUrlIndicator}
              </span>
            </div>
          </div>
        </div>

        {/* Main Content Viewport */}
        <main className="max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 flex-1">
          {parsedRoute.mode === 'admin' ? (
            <AdminDashboard
              systemState={systemState}
              selectedEventId={selectedEventId}
              onSelectEvent={setSelectedEventId}
              onUpdateState={updateActivitiesState}
              onNavigateToEvent={(evName) =>
                navigateToHash(`#/${encodeURIComponent(evName)}`)
              }
              onOpenPrintModal={(eventName, record, rubrics) =>
                setPrintTarget({ eventName, record, rubrics })
              }
              onShowToast={showToast}
              isAdminAuthenticated={isAdminAuthenticated}
              adminPassword={adminPassword}
              onLoginSuccess={() => {
                setIsAdminAuthenticated(true);
                try {
                  sessionStorage.setItem(ADMIN_AUTH_KEY, 'true');
                } catch {
                  // Ignore
                }
                showToast('已驗證管理員身分並進入管理後台', 'success');
              }}
              onLogout={() => {
                setIsAdminAuthenticated(false);
                try {
                  sessionStorage.removeItem(ADMIN_AUTH_KEY);
                } catch {
                  // Ignore
                }
                showToast('已登出管理後台', 'success');
              }}
              onChangePassword={(newPass) => {
                setAdminPassword(newPass);
                try {
                  sessionStorage.setItem(ADMIN_PASS_KEY, newPass);
                } catch {
                  // Ignore
                }
                showToast('管理員密碼已更新', 'success');
              }}
            />
          ) : (
            <EventEvaluationPortal
              event={activeEventForPortal}
              noticeItems={systemState.noticeItems}
              onUpdateState={updateActivitiesState}
              onLockUrlPayload={lockUrlPayloadAndCleanAddress}
              onShowToast={showToast}
              onNavigateToAdmin={() => navigateToHash('#/管理編輯')}
            />
          )}
        </main>
      </div>

      {/* A4 Formal Document Print Modal / Print View */}
      {printTarget && (
        <PrintSheetA4
          eventName={printTarget.eventName}
          record={printTarget.record}
          rubrics={printTarget.rubrics}
          noticeItems={systemState.noticeItems}
          onClose={() => setPrintTarget(null)}
        />
      )}
    </div>
  );
}

