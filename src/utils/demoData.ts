import {
  AnonymousEvaluationRecord,
  EventSession,
  Participant,
  RubricItem,
  SystemState,
} from '../types';
import {
  computeTicketHashKey,
  sealTargetTicket,
  sortEvaluationsByAnonToken,
} from './algorithms';

export const DEFAULT_RUBRICS: RubricItem[] = [
  {
    id: 'rub-1',
    title: '出席及時間管理',
    maxScore: 30,
    description: '依規定出席會議、活動及勤務，準時完成報到與離場程序。',
    tierHigh: '出席率達90%以上，無無故缺席（27–30分）',
    tierMedium: '出席率達70%以上，偶有遲到或請假（21–26分）',
    tierLow: '出席率未達70%，或有無故缺席（0–20分）',
  },
  {
    id: 'rub-2',
    title: '任務完成度',
    maxScore: 30,
    description: '依期限完成分配工作，工作內容符合要求。',
    tierHigh: '完整且準時完成所有任務（27–30分）',
    tierMedium: '完成大部分任務，少數需修正（21–26分）',
    tierLow: '多項任務未完成（0–20分）',
  },
  {
    id: 'rub-3',
    title: '工作品質及責任',
    maxScore: 20,
    description: '工作正確、細心，能主動處理問題並承擔職責。',
    tierHigh: '工作正確完整，主動負責（18–20分）',
    tierMedium: '工作大致完成，需少量協助（14–17分）',
    tierLow: '疏漏較多或未完成工作（0–13分）',
  },
  {
    id: 'rub-4',
    title: '團隊合作及溝通',
    maxScore: 10,
    description: '配合團隊分工，溝通態度適當，能協助完成任務。',
    tierHigh: '積極合作並協助團隊（9–10分）',
    tierMedium: '能配合團隊完成工作（7–8分）',
    tierLow: '多次無法配合工作安排（0–6分）',
  },
  {
    id: 'rub-5',
    title: '紀錄及服務成果',
    maxScore: 10,
    description: '服務紀錄完整，能提出工作成果或相關證明。',
    tierHigh: '紀錄完整且成果具體（9–10分）',
    tierMedium: '紀錄大致完整（7–8分）',
    tierLow: '缺少重要紀錄，難以查證（0–6分）',
  },
];

export const DEFAULT_NOTICE_ITEMS: string[] = [
  '系學會負責提供名冊、出席紀錄、工作分配及服務成果資料。',
  '點數之最終評分、核定、扣點及登錄，均由校方負責。',
  '經校方核准之請假，不列為無故缺席。',
  '評核應以可查證資料為依據，包括出席表、工作紀錄、活動照片、成果文件及相關訊息紀錄。',
  '學生如對評核結果有疑義，應依學校申訴程序提出申訴。',
];

function createEventADemo(): EventSession {
  const eventId = 'evt-115-a';
  const participants: Participant[] = [
    {
      id: 'pa-1',
      studentId: 'B11201001',
      name: '小明',
      department: '資訊工程學系三年級',
      role: '會長',
      maxPoints: 4.0,
      verifyCode: '1001',
    },
    {
      id: 'pa-2',
      studentId: 'B11201002',
      name: '小華',
      department: '資訊工程學系三年級',
      role: '副會長',
      maxPoints: 3.5,
      verifyCode: '1002',
    },
    {
      id: 'pa-3',
      studentId: 'B11201003',
      name: '小美',
      department: '資訊工程學系二年級',
      role: '組負責人',
      maxPoints: 3.0,
      verifyCode: '1003',
    },
    {
      id: 'pa-4',
      studentId: 'B11201004',
      name: '大雄',
      department: '資訊工程學系二年級',
      role: '一般組員',
      maxPoints: 2.0,
      verifyCode: '1004',
    },
    {
      id: 'pa-5',
      studentId: 'B11201005',
      name: '阿強',
      department: '資訊工程學系一年級',
      role: '臨時工作人員',
      maxPoints: 1.5,
      verifyCode: '1005',
    },
  ];

  // Sattolo Single-Orbit 5-Cycle for Event A:
  // pa-1 (小明) -> pa-2 (小華) [Completed & Ticket Burned]
  // pa-2 (小華) -> pa-3 (小美) [Completed & Ticket Burned]
  // pa-3 (小美) -> pa-5 (阿強) [Completed & Ticket Burned]
  // pa-5 (阿強) -> pa-4 (大雄) [Pending Draw]
  // pa-4 (大雄) -> pa-1 (小明) [Pending Draw]
  // Note: pa-1, pa-2, pa-3 have already drawn & evaluated; pa-4 (大雄) and pa-5 (阿強) have NOT drawn yet!
  // Remaining undrawn targets in pool: pa-1 (小明) and pa-4 (大雄)
  const ticketPool: Record<string, string> = {
    [computeTicketHashKey(eventId, 'pa-4')]: sealTargetTicket(eventId, 'pa-4', 'pa-1'),
    [computeTicketHashKey(eventId, 'pa-5')]: sealTargetTicket(eventId, 'pa-5', 'pa-4'),
  };

  const evaluations: AnonymousEvaluationRecord[] = sortEvaluationsByAnonToken([
    {
      anonToken: '#ANON-2B7E41',
      targetId: 'pa-2',
      targetSnapshot: {
        academicYear: '115學年度',
        department: '資訊工程學系三年級',
        studentId: 'B11201002',
        name: '小華',
        role: '副會長',
        evaluationPeriod: '115年09月01日 至 115年10月20日',
        maxPoints: 3.5,
      },
      scores: {
        'rub-1': 29,
        'rub-2': 28,
        'rub-3': 19,
        'rub-4': 9,
        'rub-5': 9,
      },
      totalScore: 94,
      grade: 'A',
      ratio: 1.0,
      roundingMode: 'round',
      suggestedPoints: 3.5,
      attendanceRecords: [
        {
          id: 'att-a2-1',
          date: '2026-09-10',
          activityName: '迎新宿營第一次籌備大會',
          expectedTime: '18:30-21:00',
          status: '準時',
          isApprovedLeave: false,
          reason: '',
          note: '準時到場並完成各組進度盤點。',
        },
        {
          id: 'att-a2-2',
          date: '2026-09-24',
          activityName: '營期場地勘查與安全演練',
          expectedTime: '09:00-17:00',
          status: '準時',
          isApprovedLeave: false,
          reason: '',
          note: '全程參與並完成雨備動線規劃紀錄。',
        },
        {
          id: 'att-a2-3',
          date: '2026-10-10',
          activityName: '迎新宿營正式營期勤務',
          expectedTime: '07:30-22:00',
          status: '準時',
          isApprovedLeave: false,
          reason: '',
          note: '擔任營期副總召，緊急應變與跨組調度表現穩定。',
        },
      ],
      attendanceStats: {
        totalSessions: 3,
        attendanceRate: 100,
        unexcusedAbsences: 0,
      },
      evidences: ['出席表', '工作紀錄', '活動照片', '成果文件'],
      overallComment:
        '依規定準時出席各項會議與活動勤務，時間管理表現穩定。按期限完成所分配之行政與活動任務，工作成果符合規範。',
      submittedDate: '2026-10-21',
      universityReview: {
        approvedPoints: 3.5,
        isDeducted: false,
        deductedPoints: 0,
        needsSupplement: false,
        supplementContent: '',
        reviewComment: '佐證資料齊備，表現優異，予以照數核定。',
        reviewerName: '陳行政組員',
        reviewDate: '115/10/25',
      },
    },
    {
      anonToken: '#ANON-6C9A18',
      targetId: 'pa-3',
      targetSnapshot: {
        academicYear: '115學年度',
        department: '資訊工程學系二年級',
        studentId: 'B11201003',
        name: '小美',
        role: '組負責人',
        evaluationPeriod: '115年09月01日 至 115年10月20日',
        maxPoints: 3.0,
      },
      scores: {
        'rub-1': 26,
        'rub-2': 25,
        'rub-3': 17,
        'rub-4': 9,
        'rub-5': 8,
      },
      totalScore: 85,
      grade: 'B',
      ratio: 0.8,
      roundingMode: 'round',
      suggestedPoints: 2.5,
      attendanceRecords: [
        {
          id: 'att-a3-1',
          date: '2026-09-10',
          activityName: '迎新宿營第一次籌備大會',
          expectedTime: '18:30-21:00',
          status: '準時',
          isApprovedLeave: false,
          reason: '',
          note: '提出活動組企劃初稿。',
        },
        {
          id: 'att-a3-2',
          date: '2026-09-24',
          activityName: '營期場地勘查與安全演練',
          expectedTime: '09:00-17:00',
          status: '遲到',
          isApprovedLeave: false,
          reason: '客運班次延誤約15分鐘',
          note: '已於群組提前報備並補齊場勘紀錄。',
        },
        {
          id: 'att-a3-3',
          date: '2026-10-10',
          activityName: '迎新宿營正式營期勤務',
          expectedTime: '07:30-22:00',
          status: '準時',
          isApprovedLeave: false,
          reason: '',
          note: '帶領大地遊戲與晚會流程順暢。',
        },
      ],
      attendanceStats: {
        totalSessions: 3,
        attendanceRate: 100,
        unexcusedAbsences: 0,
      },
      evidences: ['出席表', '活動照片', '成果文件', '相關訊息紀錄'],
      overallComment:
        '積極配合團隊分工與跨組協調，溝通態度合宜且具合作精神。偶有請假或時間延誤情形，惟已依規定完成報備與職務交接。',
      submittedDate: '2026-10-21',
      universityReview: {
        approvedPoints: 2.5,
        isDeducted: false,
        deductedPoints: 0,
        needsSupplement: false,
        supplementContent: '',
        reviewComment: '依 B 等級 80% 比例計算（2.4 點四捨五入至 0.5 點單位核發 2.5 點）。',
        reviewerName: '陳行政組員',
        reviewDate: '115/10/25',
      },
    },
    {
      anonToken: '#ANON-9D4F02',
      targetId: 'pa-5',
      targetSnapshot: {
        academicYear: '115學年度',
        department: '資訊工程學系一年級',
        studentId: 'B11201005',
        name: '阿強',
        role: '臨時工作人員',
        evaluationPeriod: '115年09月01日 至 115年10月20日',
        maxPoints: 1.5,
      },
      scores: {
        'rub-1': 22,
        'rub-2': 22,
        'rub-3': 15,
        'rub-4': 8,
        'rub-5': 7,
      },
      totalScore: 74,
      grade: 'C',
      ratio: 0.6,
      roundingMode: 'round',
      suggestedPoints: 1.0,
      attendanceRecords: [
        {
          id: 'att-a5-1',
          date: '2026-09-10',
          activityName: '迎新宿營第一次籌備大會',
          expectedTime: '18:30-21:00',
          status: '準時',
          isApprovedLeave: false,
          reason: '',
          note: '協助器材清點造冊。',
        },
        {
          id: 'att-a5-2',
          date: '2026-09-24',
          activityName: '營期場地勘查與安全演練',
          expectedTime: '09:00-17:00',
          status: '缺席',
          isApprovedLeave: true,
          reason: '代表校隊參加大專盃賽事（已附公假單）',
          note: '經校方核准請假，不列計無故缺席。',
        },
        {
          id: 'att-a5-3',
          date: '2026-10-10',
          activityName: '迎新宿營正式營期勤務',
          expectedTime: '07:30-22:00',
          status: '準時',
          isApprovedLeave: false,
          reason: '',
          note: '負責營期音響與燈光架設支援。',
        },
      ],
      attendanceStats: {
        totalSessions: 3,
        attendanceRate: 100,
        unexcusedAbsences: 0,
      },
      evidences: ['出席表', '工作紀錄', '活動照片'],
      overallComment:
        '按期限完成所分配之行政與活動任務，工作成果符合規範。部分成果書面紀錄較簡略，建議補齊器材歸還簽收單影本。',
      submittedDate: '2026-10-21',
      universityReview: {
        approvedPoints: 1.0,
        isDeducted: false,
        deductedPoints: 0,
        needsSupplement: true,
        supplementContent: '請補附器材室歸還簽收紀錄照片',
        reviewComment: '核准公假不扣分，待補齊器材歸還紀錄後予以登錄 1.0 點。',
        reviewerName: '陳行政組員',
        reviewDate: '115/10/25',
      },
    },
  ]);

  return {
    id: eventId,
    name: '活動A-迎新宿營',
    academicYear: '115學年度',
    period: '115年09月01日 至 115年10月20日',
    participants,
    rubrics: DEFAULT_RUBRICS.map((r) => ({ ...r })),
    progressMap: {
      'pa-1': { participantId: 'pa-1', hasDrawn: true, hasEvaluated: true },
      'pa-2': { participantId: 'pa-2', hasDrawn: true, hasEvaluated: true },
      'pa-3': { participantId: 'pa-3', hasDrawn: true, hasEvaluated: true },
      'pa-4': { participantId: 'pa-4', hasDrawn: false, hasEvaluated: false },
      'pa-5': { participantId: 'pa-5', hasDrawn: false, hasEvaluated: false },
    },
    remainingPoolIds: ['pa-1', 'pa-4'],
    ticketPool,
    evaluations,
  };
}

function createEventBDemo(): EventSession {
  const eventId = 'evt-115-b';
  const participants: Participant[] = [
    {
      id: 'pb-1',
      studentId: 'B11202011',
      name: '陳冠宇',
      department: '資訊工程學系三年級',
      role: '會長',
      maxPoints: 3.0,
      verifyCode: '2011',
    },
    {
      id: 'pb-2',
      studentId: 'B11202012',
      name: '林佳穎',
      department: '資訊工程學系二年級',
      role: '組負責人',
      maxPoints: 2.5,
      verifyCode: '2012',
    },
    {
      id: 'pb-3',
      studentId: 'B11202013',
      name: '張哲維',
      department: '資訊工程學系二年級',
      role: '一般組員',
      maxPoints: 2.0,
      verifyCode: '2013',
    },
    {
      id: 'pb-4',
      studentId: 'B11202014',
      name: '黃詩涵',
      department: '資訊工程學系一年級',
      role: '一般組員',
      maxPoints: 2.0,
      verifyCode: '2014',
    },
  ];

  // Sattolo 4-cycle for Event B:
  // pb-1 -> pb-2 (completed)
  // pb-2 -> pb-3 (completed)
  // pb-3 -> pb-4 (pending)
  // pb-4 -> pb-1 (pending)
  const ticketPool: Record<string, string> = {
    [computeTicketHashKey(eventId, 'pb-3')]: sealTargetTicket(eventId, 'pb-3', 'pb-4'),
    [computeTicketHashKey(eventId, 'pb-4')]: sealTargetTicket(eventId, 'pb-4', 'pb-1'),
  };

  const evaluations: AnonymousEvaluationRecord[] = sortEvaluationsByAnonToken([
    {
      anonToken: '#ANON-3E8B55',
      targetId: 'pb-2',
      targetSnapshot: {
        academicYear: '115學年度',
        department: '資訊工程學系二年級',
        studentId: 'B11202012',
        name: '林佳穎',
        role: '組負責人',
        evaluationPeriod: '115年11月01日 至 115年12月20日',
        maxPoints: 2.5,
      },
      scores: {
        'rub-1': 28,
        'rub-2': 28,
        'rub-3': 18,
        'rub-4': 10,
        'rub-5': 9,
      },
      totalScore: 93,
      grade: 'A',
      ratio: 1.0,
      roundingMode: 'round',
      suggestedPoints: 2.5,
      attendanceRecords: [
        {
          id: 'att-b2-1',
          date: '2026-11-12',
          activityName: '期末系員大會提案審查會',
          expectedTime: '18:30-20:30',
          status: '準時',
          isApprovedLeave: false,
          reason: '',
          note: '完成議程簡報與財務決算表彙整。',
        },
        {
          id: 'att-b2-2',
          date: '2026-12-10',
          activityName: '期末系員大會暨幹部交接典禮',
          expectedTime: '18:00-21:30',
          status: '準時',
          isApprovedLeave: false,
          reason: '',
          note: '擔任司儀與簽到處總控，紀錄完整。',
        },
      ],
      attendanceStats: {
        totalSessions: 2,
        attendanceRate: 100,
        unexcusedAbsences: 0,
      },
      evidences: ['出席表', '工作紀錄', '活動照片', '成果文件'],
      overallComment:
        '工作執行細心正確，能主動察覺問題並積極承擔職務責任。服務學習紀錄與成果佐證資料完整具體，便於查核驗證。',
      submittedDate: '2026-12-21',
      universityReview: {
        approvedPoints: 2.5,
        isDeducted: false,
        deductedPoints: 0,
        needsSupplement: false,
        supplementContent: '',
        reviewComment: '表現優異，核發 2.5 點。',
        reviewerName: '林課指組承辦人',
        reviewDate: '115/12/24',
      },
    },
    {
      anonToken: '#ANON-7A1C90',
      targetId: 'pb-3',
      targetSnapshot: {
        academicYear: '115學年度',
        department: '資訊工程學系二年級',
        studentId: 'B11202013',
        name: '張哲維',
        role: '一般組員',
        evaluationPeriod: '115年11月01日 至 115年12月20日',
        maxPoints: 2.0,
      },
      scores: {
        'rub-1': 25,
        'rub-2': 26,
        'rub-3': 16,
        'rub-4': 8,
        'rub-5': 8,
      },
      totalScore: 83,
      grade: 'B',
      ratio: 0.8,
      roundingMode: 'round',
      suggestedPoints: 1.5,
      attendanceRecords: [
        {
          id: 'att-b3-1',
          date: '2026-11-12',
          activityName: '期末系員大會提案審查會',
          expectedTime: '18:30-20:30',
          status: '準時',
          isApprovedLeave: false,
          reason: '',
          note: '負責場地桌椅排列與設備測試。',
        },
        {
          id: 'att-b3-2',
          date: '2026-12-10',
          activityName: '期末系員大會暨幹部交接典禮',
          expectedTime: '18:00-21:30',
          status: '準時',
          isApprovedLeave: false,
          reason: '',
          note: '完成餐點發放與會後場地復原。',
        },
      ],
      attendanceStats: {
        totalSessions: 2,
        attendanceRate: 100,
        unexcusedAbsences: 0,
      },
      evidences: ['出席表', '活動照片', '相關訊息紀錄'],
      overallComment:
        '依規定準時出席各項會議與活動勤務，時間管理表現穩定。積極配合團隊分工與跨組協調，溝通態度合宜且具合作精神。',
      submittedDate: '2026-12-21',
      universityReview: {
        approvedPoints: 1.5,
        isDeducted: false,
        deductedPoints: 0,
        needsSupplement: false,
        supplementContent: '',
        reviewComment: 'B 等級（80% 為 1.6 點，以 0.5 點單位核定 1.5 點）。',
        reviewerName: '林課指組承辦人',
        reviewDate: '115/12/24',
      },
    },
  ]);

  return {
    id: eventId,
    name: '活動B-期末系大',
    academicYear: '115學年度',
    period: '115年11月01日 至 115年12月20日',
    participants,
    rubrics: DEFAULT_RUBRICS.map((r) => ({ ...r })),
    progressMap: {
      'pb-1': { participantId: 'pb-1', hasDrawn: true, hasEvaluated: true },
      'pb-2': { participantId: 'pb-2', hasDrawn: true, hasEvaluated: true },
      'pb-3': { participantId: 'pb-3', hasDrawn: false, hasEvaluated: false },
      'pb-4': { participantId: 'pb-4', hasDrawn: false, hasEvaluated: false },
    },
    remainingPoolIds: ['pb-1', 'pb-4'],
    ticketPool,
    evaluations,
  };
}

export function createInitialSystemState(): SystemState {
  return {
    events: [createEventADemo(), createEventBDemo()],
    noticeItems: [...DEFAULT_NOTICE_ITEMS],
    updatedDate: '2026-11-13',
  };
}
