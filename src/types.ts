export type RoleType = '會長' | '副會長' | '組負責人' | '一般組員' | '臨時工作人員';

export interface Participant {
  id: string;
  studentId: string;
  name: string;
  department: string;
  role: RoleType;
  maxPoints: number;
  verifyCode: string; // 個人驗證碼／學號後4碼
}

export interface RubricItem {
  id: string;
  title: string;
  maxScore: number;
  description: string;
  tierHigh: string;
  tierMedium: string;
  tierLow: string;
}

/**
 * 表一：實名進度追蹤表（徹底切斷 Evaluator 與 Target 關聯）
 * 僅記錄每位成員是否已抽籤、是否已提交評核，嚴禁儲存任何抽籤配對對象。
 */
export interface ParticipantProgress {
  participantId: string;
  hasDrawn: boolean;
  hasEvaluated: boolean;
}

export type AttendanceStatus = '準時' | '遲到' | '早退' | '缺席';

export interface AttendanceRecord {
  id: string;
  date: string;
  activityName: string;
  expectedTime: string;
  status: AttendanceStatus;
  isApprovedLeave: boolean;
  reason: string;
  note: string; // 受 ECHO 遮罩保護
}

export type EvidenceType =
  | '出席表'
  | '工作紀錄'
  | '活動照片'
  | '成果文件'
  | '相關訊息紀錄';

export type RoundingMode = 'round' | 'floor';

export type GradeLevel = 'A' | 'B' | 'C' | 'D' | 'E';

export interface UniversityReview {
  approvedPoints: number | null;
  isDeducted: boolean;
  deductedPoints: number;
  needsSupplement: boolean;
  supplementContent: string;
  reviewComment: string;
  reviewerName: string;
  reviewDate: string; // YYYY/MM/DD
}

/**
 * 表二：匿名評核結果表（雙盲零知識不可追溯架構）
 * 嚴禁儲存 evaluatorId、評核人姓名或學號；僅配發隨機不可逆盲籤憑證碼（#ANON-XXXXXX）
 * 抹除時分秒時間戳記，僅保留日期（YYYY-MM-DD），且陣列強制依 anonToken 字母序排序。
 */
export interface AnonymousEvaluationRecord {
  anonToken: string; // e.g., #ANON-8F3A9C
  targetId: string;
  targetSnapshot: {
    academicYear: string;
    department: string;
    studentId: string;
    name: string;
    role: RoleType;
    evaluationPeriod: string;
    maxPoints: number;
  };
  scores: Record<string, number>;
  totalScore: number;
  grade: GradeLevel;
  ratio: number;
  roundingMode: RoundingMode;
  suggestedPoints: number;
  attendanceRecords: AttendanceRecord[];
  attendanceStats: {
    totalSessions: number;
    attendanceRate: number;
    unexcusedAbsences: number;
  };
  evidences: EvidenceType[];
  overallComment: string;
  submittedDate: string; // YYYY-MM-DD only
  universityReview: UniversityReview;
}

export interface EventSession {
  id: string;
  name: string;
  academicYear: string;
  period: string;
  participants: Participant[];
  rubrics: RubricItem[];
  progressMap: Record<string, ParticipantProgress>;
  remainingPoolIds: string[]; // 人員池剩餘未抽名單 ID
  ticketPool: Record<string, string>; // 即抽即焚單向雜湊加密票券池
  evaluations: AnonymousEvaluationRecord[]; // 強制依盲籤憑證碼字母序排序
}

export interface SystemState {
  events: EventSession[];
  noticeItems: string[];
  updatedDate: string;
}
