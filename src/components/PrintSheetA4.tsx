import React from 'react';
import {
  AnonymousEvaluationRecord,
  EvidenceType,
  RoleType,
  RubricItem,
} from '../types';
import { Printer, X, ShieldCheck } from 'lucide-react';

interface PrintSheetA4Props {
  eventName: string;
  record: AnonymousEvaluationRecord;
  rubrics: RubricItem[];
  noticeItems: string[];
  onClose?: () => void;
}

const ALL_ROLES: RoleType[] = ['會長', '副會長', '組負責人', '一般組員', '臨時工作人員'];
const ALL_EVIDENCES: EvidenceType[] = [
  '出席表',
  '工作紀錄',
  '活動照片',
  '成果文件',
  '相關訊息紀錄',
];

export const PrintSheetA4: React.FC<PrintSheetA4Props> = ({
  eventName,
  record,
  rubrics,
  noticeItems,
  onClose,
}) => {
  const { targetSnapshot, universityReview } = record;
  const finalApproved =
    universityReview.approvedPoints !== null
      ? universityReview.approvedPoints
      : record.suggestedPoints;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs overflow-y-auto flex items-start justify-center p-4 md:p-8 print:static print:p-0 print:bg-white print:overflow-visible">
      <div className="bg-white text-black w-full max-w-[210mm] border border-slate-300 shadow-xl rounded-lg p-6 md:p-10 print:shadow-none print:border-0 print:rounded-none print:p-0 print:w-full print:max-w-none">
        {/* Top Action Bar (Hidden in @media print) */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-5 mb-6 border-b border-slate-200 print:hidden">
          <div className="flex items-center gap-2 text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-md">
            <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-700" />
            <span>
              A4 正式公文預覽模式（點擊列印將自動隱藏所有導覽列與按鈕，輸出黑白公文表格）
            </span>
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Printer className="w-4 h-4" />
              <span>列印 A4 正式評核表</span>
            </button>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="關閉列印預覽"
                className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-md hover:bg-slate-200 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <X className="w-4 h-4" />
                <span>關閉預覽</span>
              </button>
            )}
          </div>
        </div>

        {/* Official Document Header */}
        <div className="text-center mb-4">
          <h1 className="text-xl md:text-2xl font-bold tracking-wide text-black">
            《{targetSnapshot.academicYear || '115學年度'}系學會服務學習點數評核表》
          </h1>
          <p className="text-xs text-neutral-700 mt-1 font-mono tabular-nums">
            活動場次：{eventName} ｜ 盲籤憑證編號：{record.anonToken} ｜ 紀錄日期：{record.submittedDate}
          </p>
        </div>

        {/* 1. 學生基本資料區 */}
        <div className="mb-4">
          <div className="text-xs font-bold bg-neutral-100 border border-black border-b-0 px-2.5 py-1.5">
            壹、學生基本資料區
          </div>
          <table className="w-full border-collapse border border-black text-xs">
            <tbody>
              <tr>
                <th className="border border-black bg-neutral-50 px-2.5 py-1.5 text-left font-semibold w-[14%]">
                  學年度
                </th>
                <td className="border border-black px-2.5 py-1.5 w-[18%] font-mono tabular-nums">
                  {targetSnapshot.academicYear}
                </td>
                <th className="border border-black bg-neutral-50 px-2.5 py-1.5 text-left font-semibold w-[14%]">
                  系級
                </th>
                <td className="border border-black px-2.5 py-1.5 w-[22%]">
                  {targetSnapshot.department}
                </td>
                <th className="border border-black bg-neutral-50 px-2.5 py-1.5 text-left font-semibold w-[14%]">
                  學號 / 姓名
                </th>
                <td className="border border-black px-2.5 py-1.5 w-[18%] font-mono tabular-nums font-semibold">
                  {targetSnapshot.studentId} / {targetSnapshot.name}
                </td>
              </tr>
              <tr>
                <th className="border border-black bg-neutral-50 px-2.5 py-1.5 text-left font-semibold">
                  擔任職務
                </th>
                <td className="border border-black px-2.5 py-1.5" colSpan={3}>
                  <div className="flex flex-wrap items-center gap-3">
                    {ALL_ROLES.map((r) => (
                      <span key={r} className="inline-flex items-center gap-1">
                        <span className="font-mono">
                          {targetSnapshot.role === r ? '☑' : '☐'}
                        </span>
                        <span className={targetSnapshot.role === r ? 'font-bold underline' : ''}>
                          {r}
                        </span>
                      </span>
                    ))}
                  </div>
                </td>
                <th className="border border-black bg-neutral-50 px-2.5 py-1.5 text-left font-semibold">
                  原訂最高點數
                </th>
                <td className="border border-black px-2.5 py-1.5 font-mono tabular-nums font-bold">
                  {targetSnapshot.maxPoints.toFixed(1)} 點
                </td>
              </tr>
              <tr>
                <th className="border border-black bg-neutral-50 px-2.5 py-1.5 text-left font-semibold">
                  評核期間
                </th>
                <td className="border border-black px-2.5 py-1.5 font-mono tabular-nums" colSpan={2}>
                  {targetSnapshot.evaluationPeriod}
                </td>
                <th className="border border-black bg-neutral-50 px-2.5 py-1.5 text-left font-semibold">
                  實際評核人
                </th>
                <td className="border border-black px-2.5 py-1.5 font-mono tabular-nums" colSpan={2}>
                  🔒 匿名評核員（盲籤憑證 {record.anonToken}）
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* 2. 服務表現評核區 */}
        <div className="mb-4">
          <div className="text-xs font-bold bg-neutral-100 border border-black border-b-0 px-2.5 py-1.5">
            貳、服務表現評核區（滿分 100 分）
          </div>
          <table className="w-full border-collapse border border-black text-xs">
            <thead>
              <tr className="bg-neutral-50">
                <th className="border border-black px-2 py-1.5 text-left w-[20%]">
                  評核項目（配分）
                </th>
                <th className="border border-black px-2 py-1.5 text-left w-[28%]">
                  評核重點說明
                </th>
                <th className="border border-black px-2 py-1.5 text-left w-[40%]">
                  三階段評分尺規參考
                </th>
                <th className="border border-black px-2 py-1.5 text-right w-[12%]">
                  單項得分
                </th>
              </tr>
            </thead>
            <tbody>
              {rubrics.map((item, idx) => {
                const sc = record.scores[item.id] ?? 0;
                return (
                  <tr key={item.id}>
                    <td className="border border-black px-2 py-1.5 font-semibold">
                      {idx + 1}. {item.title}（{item.maxScore}分）
                    </td>
                    <td className="border border-black px-2 py-1.5">{item.description}</td>
                    <td className="border border-black px-2 py-1.5 text-[11px] leading-snug">
                      <div>• 高度：{item.tierHigh}</div>
                      <div>• 普通：{item.tierMedium}</div>
                      <div>• 待改進：{item.tierLow}</div>
                    </td>
                    <td className="border border-black px-2 py-1.5 text-right font-mono tabular-nums font-bold text-sm">
                      {sc} / {item.maxScore}
                    </td>
                  </tr>
                );
              })}
              <tr className="bg-neutral-50 font-bold">
                <td className="border border-black px-2 py-1.5" colSpan={3}>
                  服務表現總分合計（ECHO 淨化綜合評語：{record.overallComment || '無'}）
                </td>
                <td className="border border-black px-2 py-1.5 text-right font-mono tabular-nums text-sm">
                  {record.totalScore} 分
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* 3. 出席及服務紀錄區 */}
        <div className="mb-4">
          <div className="text-xs font-bold bg-neutral-100 border border-black border-b-0 px-2.5 py-1.5">
            參、出席及服務紀錄區
          </div>
          <table className="w-full border-collapse border border-black text-xs">
            <thead>
              <tr className="bg-neutral-50">
                <th className="border border-black px-2 py-1 text-left w-[13%]">日期</th>
                <th className="border border-black px-2 py-1 text-left w-[24%]">活動或工作名稱</th>
                <th className="border border-black px-2 py-1 text-left w-[14%]">應出席時間</th>
                <th className="border border-black px-2 py-1 text-center w-[11%]">實際出席</th>
                <th className="border border-black px-2 py-1 text-center w-[10%]">校方核准請假</th>
                <th className="border border-black px-2 py-1 text-left w-[28%]">
                  請假/缺席原因與備註（ECHO 遮罩）
                </th>
              </tr>
            </thead>
            <tbody>
              {record.attendanceRecords.length === 0 ? (
                <tr>
                  <td colSpan={6} className="border border-black px-2 py-2 text-center">
                    無明細紀錄
                  </td>
                </tr>
              ) : (
                record.attendanceRecords.map((att) => (
                  <tr key={att.id}>
                    <td className="border border-black px-2 py-1 font-mono tabular-nums">
                      {att.date}
                    </td>
                    <td className="border border-black px-2 py-1">{att.activityName}</td>
                    <td className="border border-black px-2 py-1 font-mono tabular-nums">
                      {att.expectedTime}
                    </td>
                    <td className="border border-black px-2 py-1 text-center font-semibold">
                      {att.status}
                    </td>
                    <td className="border border-black px-2 py-1 text-center font-mono">
                      {att.isApprovedLeave ? '☑ 是' : '☐ 否'}
                    </td>
                    <td className="border border-black px-2 py-1">
                      {[att.reason, att.note].filter(Boolean).join(' ｜ ') || '—'}
                    </td>
                  </tr>
                ))
              )}
              <tr className="bg-neutral-50">
                <td colSpan={6} className="border border-black px-2.5 py-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold font-mono tabular-nums">
                      出席統計：總場次 {record.attendanceStats.totalSessions} 場 ｜ 實際出席率{' '}
                      {record.attendanceStats.attendanceRate}% ｜ 無故缺席{' '}
                      {record.attendanceStats.unexcusedAbsences} 次
                    </span>
                    <span>
                      可查證佐證資料：
                      {ALL_EVIDENCES.map((ev) => (
                        <span key={ev} className="ml-2 font-mono">
                          {record.evidences.includes(ev) ? '☑' : '☐'} {ev}
                        </span>
                      ))}
                    </span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* 4. 評核結果與點數自動換算區 & 校方審核欄位 */}
        <div className="mb-4">
          <div className="text-xs font-bold bg-neutral-100 border border-black border-b-0 px-2.5 py-1.5">
            肆、評核結果與校方核定審核區
          </div>
          <table className="w-full border-collapse border border-black text-xs">
            <tbody>
              <tr>
                <th className="border border-black bg-neutral-50 px-2.5 py-1.5 text-left font-semibold w-[18%]">
                  評核等級與比例
                </th>
                <td className="border border-black px-2.5 py-1.5 font-mono tabular-nums w-[32%]">
                  <span className="font-bold">{record.grade} 等級</span>（核發比例{' '}
                  {Math.round(record.ratio * 100)}%）
                </td>
                <th className="border border-black bg-neutral-50 px-2.5 py-1.5 text-left font-semibold w-[18%]">
                  系統建議核發點數
                </th>
                <td className="border border-black px-2.5 py-1.5 font-mono tabular-nums font-bold w-[32%]">
                  {record.suggestedPoints.toFixed(1)} 點（
                  {record.roundingMode === 'round' ? '四捨五入至 0.5 點' : '無條件捨去至 0.5 點'}）
                </td>
              </tr>
              <tr>
                <th className="border border-black bg-neutral-50 px-2.5 py-1.5 text-left font-semibold">
                  等級換算標準說明
                </th>
                <td className="border border-black px-2.5 py-1.5 text-[11px]" colSpan={3}>
                  90–100分：A等級(100%) ／ 80–89分：B等級(80%) ／ 70–79分：C等級(60%) ／
                  60–69分：D等級(40%) ／ 未滿60分：E等級(0%)；原訂最高點數 × 核發比例 =
                  建議核發點數（以 0.5 點為最小核發單位）。
                </td>
              </tr>
              <tr>
                <th className="border border-black bg-neutral-50 px-2.5 py-1.5 text-left font-semibold">
                  校方核定點數
                </th>
                <td className="border border-black px-2.5 py-1.5 font-mono tabular-nums font-bold text-sm">
                  {finalApproved.toFixed(1)} 點
                </td>
                <th className="border border-black bg-neutral-50 px-2.5 py-1.5 text-left font-semibold">
                  是否扣點
                </th>
                <td className="border border-black px-2.5 py-1.5 font-mono tabular-nums">
                  {universityReview.isDeducted
                    ? `☑ 是（扣 ${universityReview.deductedPoints.toFixed(1)} 點） ／ ☐ 否`
                    : '☑ 否 ／ ☐ 是（扣 ___ 點）'}
                </td>
              </tr>
              <tr>
                <th className="border border-black bg-neutral-50 px-2.5 py-1.5 text-left font-semibold">
                  是否需補件或補作
                </th>
                <td className="border border-black px-2.5 py-1.5" colSpan={3}>
                  {universityReview.needsSupplement
                    ? `☑ 是（內容：${universityReview.supplementContent || '請依通知補件'}） ／ ☐ 否`
                    : '☑ 否 ／ ☐ 是（內容：______________________）'}
                </td>
              </tr>
              <tr>
                <th className="border border-black bg-neutral-50 px-2.5 py-1.5 text-left font-semibold">
                  校方審核意見
                </th>
                <td className="border border-black px-2.5 py-1.5" colSpan={3}>
                  {universityReview.reviewComment || '（尚待校方承辦人填註審核意見）'}
                </td>
              </tr>
              <tr>
                <th className="border border-black bg-neutral-50 px-2.5 py-2 text-left font-semibold">
                  校方承辦人簽章
                </th>
                <td className="border border-black px-2.5 py-2 font-semibold">
                  {universityReview.reviewerName || '____________________'}
                </td>
                <th className="border border-black bg-neutral-50 px-2.5 py-2 text-left font-semibold">
                  審核日期（年/月/日）
                </th>
                <td className="border border-black px-2.5 py-2 font-mono tabular-nums">
                  {universityReview.reviewDate || '____ / __ / __'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* 5. 評核注意事項 */}
        <div className="border border-black p-2.5 text-[11px] leading-relaxed">
          <div className="font-bold mb-1">伍、評核注意事項：</div>
          <ol className="list-decimal list-inside space-y-0.5">
            {noticeItems.map((note, idx) => (
              <li key={idx}>{note}</li>
            ))}
          </ol>
          <div className="mt-2 pt-1.5 border-t border-neutral-300 text-[10px] font-mono">
            🛡️ 雙盲零知識隔離聲明：系統已啟用雙盲零知識隔離，管理員與校方僅能審核受評者得分與核定點數，無法追蹤評核人身分。
          </div>
        </div>
      </div>
    </div>
  );
};
