import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  AnonymousEvaluationRecord,
  EventSession,
  RubricItem,
  SystemState,
} from './types';
import { createInitialSystemState, DEFAULT_RUBRICS, DEFAULT_NOTICE_ITEMS } from './utils/demoData';
import { decodeStateFromBase64Url, encodeStateToBase64Url } from './utils/algorithms';
import { AdminDashboard } from './components/AdminDashboard';
import { EventEvaluationPortal } from './components/EventEvaluationPortal';
import { PrintSheetA4 } from './components/PrintSheetA4';
import { RefreshCw, Globe, RotateCcw, CheckCircle2, AlertCircle, X } from 'lucide-react';

export const STORAGE_KEY = 'service_credits_state_v3';
const LEGACY_KEYS = ['service_credits_state_v1', 'service_credits_state_v2'];
const ADMIN_AUTH_KEY = 'service_credits_admin_auth_v3';
const ADMIN_PASS_KEY = 'service_credits_admin_pass_v3';
const BROADCAST_CHANNEL_NAME = 'service_credits_sync_channel_v3';

export type ToastTone = 'success' | 'error';

interface RouteParsed {
  mode: 'admin' | 'event';
  eventName: string;
  base64State: string | null;
}

export function parseHashRoute(hashStr: string, defaultEventName: string): RouteParsed {
  const raw = hashStr.startsWith('#') ? hashStr.slice(1) : hashStr;
  if (!raw || raw === '/' || raw.startsWith('/管理編輯')) {
    const qIdx = raw.indexOf('?s=');
    return {
      mode: 'admin',
      eventName: defaultEventName,
      base64State: qIdx >= 0 ? raw.slice(qIdx + 3) : null,
    };
  }

  const [pathPart, queryPart] = raw.split('?');
  let decodedPath = pathPart.replace(/^\/+/, '').trim();
  try {
    decodedPath = decodeURIComponent(decodedPath).trim();
  } catch {
    // keep raw pathPart if malformed URI
  }

  let sParam: string | null = null;
  if (queryPart) {
    const params = new URLSearchParams(queryPart);
    sParam = params.get('s');
  }

  if (!decodedPath || decodedPath === '管理編輯') {
    return { mode: 'admin', eventName: defaultEventName, base64State: sParam };
  }

  return {
    mode: 'event',
    eventName: decodedPath,
    base64State: sParam,
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

function loadInitialState(): {
  state: SystemState;
  initialEventId: string;
  hydratedS: string | null;
} {
  // Clear legacy v1/v2 keys to prevent incompatible JSON structure interference
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
  let initialEventId = fallback.events[0]?.id || 'evt-115-a';
  let hydratedS: string | null = null;

  // 1. Load from v3 localStorage
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

  // 2. Only on initial mount: check if URL has a v3 ?s=... Base64 state
  if (typeof window !== 'undefined') {
    const parsedRoute = parseHashRoute(window.location.hash || '', initialEventId);
    if (parsedRoute.base64State) {
      hydratedS = parsedRoute.base64State;
      const decoded = decodeStateFromBase64Url<{
        v?: number;
        event?: EventSession;
        noticeItems?: string[];
      }>(parsedRoute.base64State);

      // Only accept v === 3 payloads so stale v1/v2 URLs never overwrite v3 state
      if (decoded && decoded.v === 3 && decoded.event && decoded.event.id) {
        const incomingEvent = normalizeEventSession(decoded.event);
        const exists = state.events.some((e) => e.id === incomingEvent.id);
        const mergedEvents = exists
          ? state.events.map((e) => (e.id === incomingEvent.id ? incomingEvent : e))
          : [...state.events, incomingEvent];
        state = {
          ...state,
          events: mergedEvents,
          noticeItems:
            Array.isArray(decoded.noticeItems) && decoded.noticeItems.length > 0
              ? decoded.noticeItems
              : state.noticeItems,
        };
        initialEventId = incomingEvent.id;
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
  const [selectedEventId, setSelectedEventId] = useState<string>(initialData.initialEventId);
  const lastHydratedSRef = useRef<string | null>(initialData.hydratedS);

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
            setSystemState({
              ...ev.data,
              events: ev.data.events.map(normalizeEventSession),
            });
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
            setSystemState({
              ...next,
              events: next.events.map(normalizeEventSession),
            });
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
   * 統一封裝之狀態更新函式 updateActivitiesState:
   * 純粹更新 systemState，並同步寫入 localStorage、BroadcastChannel 與 history.replaceState。
   */
  const updateActivitiesState = useCallback(
    (updater: (prev: SystemState) => SystemState) => {
      setSystemState((prev) => {
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

        // Silently synchronize URL via history.replaceState (without calling setState inside updater)
        if (typeof window !== 'undefined') {
          try {
            const currentHash = window.location.hash || '#/管理編輯';
            const parsed = parseHashRoute(
              currentHash,
              next.events[0]?.name || '活動A-迎新宿營'
            );
            if (parsed.mode === 'admin') {
              const cleanAdminHash = '#/管理編輯';
              if (window.location.hash !== cleanAdminHash) {
                window.history.replaceState(null, '', cleanAdminHash);
              }
            } else {
              const targetEv =
                next.events.find(
                  (e) => e.name === parsed.eventName || e.id === parsed.eventName
                ) || next.events[0];
              if (targetEv) {
                const payload = {
                  v: 3,
                  activeEventId: targetEv.id,
                  event: targetEv,
                  noticeItems: next.noticeItems,
                };
                const encoded = encodeStateToBase64Url(payload);
                lastHydratedSRef.current = encoded;
                const nextEventHash = `#/${encodeURIComponent(targetEv.name)}?s=${encoded}`;
                window.history.replaceState(null, '', nextEventHash);
              }
            }
          } catch {
            // Ignore history replaceState errors
          }
        }

        return next;
      });
    },
    []
  );

  // Listen to user-initiated hash changes ONLY
  useEffect(() => {
    const handleHashChange = () => {
      const currentHash = window.location.hash || '#/管理編輯';
      setHashRoute(currentHash);

      const parsed = parseHashRoute(currentHash, '活動A-迎新宿營');

      if (parsed.base64State && parsed.base64State !== lastHydratedSRef.current) {
        lastHydratedSRef.current = parsed.base64State;
        const decoded = decodeStateFromBase64Url<{
          v?: number;
          event?: EventSession;
          noticeItems?: string[];
        }>(parsed.base64State);

        if (decoded && decoded.v === 3 && decoded.event && decoded.event.id) {
          const incomingEvent = normalizeEventSession(decoded.event);
          setSystemState((prev) => {
            const exists = prev.events.some((e) => e.id === incomingEvent.id);
            const nextEvents = exists
              ? prev.events.map((e) => (e.id === incomingEvent.id ? incomingEvent : e))
              : [...prev.events, incomingEvent];
            const nextState: SystemState = {
              ...prev,
              events: nextEvents,
              noticeItems:
                Array.isArray(decoded.noticeItems) && decoded.noticeItems.length > 0
                  ? decoded.noticeItems
                  : prev.noticeItems,
            };
            try {
              localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
            } catch {
              // Ignore
            }
            return nextState;
          });
          setSelectedEventId(incomingEvent.id);
        }
      } else if (parsed.mode === 'event') {
        setSystemState((prev) => {
          const matched = prev.events.find(
            (e) => e.name === parsed.eventName || e.id === parsed.eventName
          );
          if (matched) {
            setSelectedEventId(matched.id);
          }
          return prev;
        });
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
    lastHydratedSRef.current = null;
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
              key={activeEventForPortal.id}
              event={activeEventForPortal}
              noticeItems={systemState.noticeItems}
              onUpdateState={updateActivitiesState}
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
