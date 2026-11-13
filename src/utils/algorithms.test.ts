import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateSattoloCycle,
  verifySingleOrbitCycle,
  computeTicketHashKey,
  sealTargetTicket,
  unsealTargetTicket,
  getDateOnlyTimestamp,
  sortEvaluationsByAnonToken,
  sanitizeWithEchoRegex,
  neutralizeWithEchoStyle,
  calculateGradeAndPoints,
  calculateAttendanceStats,
  encodeStateToBase64Url,
  decodeStateFromBase64Url,
} from './algorithms';
import { AnonymousEvaluationRecord, AttendanceRecord } from '../types';

test('Sattolo Algorithm produces a single orbit n-cycle with zero fixed points across 200 trials', () => {
  const members = ['p1', 'p2', 'p3', 'p4', 'p5'];
  for (let trial = 0; trial < 200; trial++) {
    const cycle = generateSattoloCycle(members);
    assert.equal(verifySingleOrbitCycle(members, cycle), true, `Failed on trial ${trial}`);
    for (const m of members) {
      assert.notEqual(cycle.get(m), m, 'Fixed point detected');
    }
  }
});

test('Zero-knowledge ticket pool seals and unseals target ID only with matching evaluator credentials', () => {
  const eventId = 'evt-camp-115';
  const evaluatorId = 'mem-01';
  const targetId = 'mem-03';

  const hashKey = computeTicketHashKey(eventId, evaluatorId);
  assert.ok(hashKey.startsWith('TKT_'));
  assert.equal(hashKey.includes(evaluatorId), false);

  const sealed = sealTargetTicket(eventId, evaluatorId, targetId);
  assert.notEqual(sealed, targetId);

  const unsealed = unsealTargetTicket(eventId, evaluatorId, sealed);
  assert.equal(unsealed, targetId);

  // Wrong evaluator cannot unseal to original targetId
  const wrongUnsealed = unsealTargetTicket(eventId, 'mem-02', sealed);
  assert.notEqual(wrongUnsealed, targetId);
});

test('Timing attack defense strips time to YYYY-MM-DD and sorts evaluations by #ANON token', () => {
  const d = new Date(2026, 10, 13, 23, 59, 59);
  const dateStr = getDateOnlyTimestamp(d);
  assert.equal(dateStr, '2026-11-13');
  assert.equal(dateStr.includes(':'), false);

  const mockRecords = [
    { anonToken: '#ANON-F91B2C' },
    { anonToken: '#ANON-10A4E8' },
    { anonToken: '#ANON-8C3D11' },
  ] as AnonymousEvaluationRecord[];

  const sorted = sortEvaluationsByAnonToken(mockRecords);
  assert.deepEqual(
    sorted.map((r) => r.anonToken),
    ['#ANON-10A4E8', '#ANON-8C3D11', '#ANON-F91B2C']
  );
});

test('ECHO Regex Sanitizer masks roster names, student IDs, emails, URLs, numbers, and self-references', () => {
  const roster = [
    { name: '王小明', studentId: 'B11201001' },
    { name: '林小華', studentId: 'B11201002' },
  ];
  const raw =
    '我是王小明，身為會長，我覺得林小華(學號B11201002)在活動期間表現超讚！！聯絡信箱 test@ntu.edu.tw 或網址 https://example.com/doc 電話 0912-345-678 編號 98765';
  const sanitized = sanitizeWithEchoRegex(raw, roster);

  assert.equal(sanitized.includes('王小明'), false);
  assert.equal(sanitized.includes('林小華'), false);
  assert.equal(sanitized.includes('B11201002'), false);
  assert.equal(sanitized.includes('我是'), false);
  assert.equal(sanitized.includes('[NAME][NAME]'), false);
  assert.equal(sanitized.includes('test@ntu.edu.tw'), false);
  assert.equal(sanitized.includes('https://example.com/doc'), false);
  assert.equal(sanitized.includes('0912-345-678'), false);
  assert.ok(sanitized.includes('[NAME]'));
  assert.ok(sanitized.includes('[ID]'));
  assert.ok(sanitized.includes('[EMAIL]'));
  assert.ok(sanitized.includes('[URL]'));
  assert.ok(sanitized.includes('[NUM]'));

  const neutralized = neutralizeWithEchoStyle(raw, roster);
  assert.equal(neutralized.includes('超讚'), false);
  assert.ok(neutralized.includes('高度符合標準且表現優異'));
});

test('Grade and 0.5-point calculation follows 115 Academic Year rubric rules', () => {
  // 92 score => A (100%), max 4 pts => 4.0
  assert.deepEqual(calculateGradeAndPoints(92, 4, 'round'), {
    grade: 'A',
    ratio: 1.0,
    rawPoints: 4,
    suggestedPoints: 4.0,
  });

  // 85 score => B (80%), max 3 pts => raw 2.4 => round to 0.5 = 2.5, floor to 0.5 = 2.0
  assert.deepEqual(calculateGradeAndPoints(85, 3, 'round'), {
    grade: 'B',
    ratio: 0.8,
    rawPoints: 2.4,
    suggestedPoints: 2.5,
  });
  assert.deepEqual(calculateGradeAndPoints(85, 3, 'floor'), {
    grade: 'B',
    ratio: 0.8,
    rawPoints: 2.4,
    suggestedPoints: 2.0,
  });

  // 74 score => C (60%), max 3 pts => raw 1.8 => round = 2.0, floor = 1.5
  assert.equal(calculateGradeAndPoints(74, 3, 'round').suggestedPoints, 2.0);
  assert.equal(calculateGradeAndPoints(74, 3, 'floor').suggestedPoints, 1.5);

  // 65 score => D (40%), max 4 pts => raw 1.6 => round = 1.5, floor = 1.5
  assert.equal(calculateGradeAndPoints(65, 4, 'round').grade, 'D');
  assert.equal(calculateGradeAndPoints(65, 4, 'round').suggestedPoints, 1.5);

  // 58 score => E (0%) => 0 pts
  assert.equal(calculateGradeAndPoints(58, 4, 'round').grade, 'E');
  assert.equal(calculateGradeAndPoints(58, 4, 'round').suggestedPoints, 0);
});

test('Attendance stats properly exclude university-approved leave from unexcused absences', () => {
  const records: AttendanceRecord[] = [
    {
      id: '1',
      date: '2026-10-01',
      activityName: '第一次籌備會',
      expectedTime: '18:30-20:30',
      status: '準時',
      isApprovedLeave: false,
      reason: '',
      note: '',
    },
    {
      id: '2',
      date: '2026-10-08',
      activityName: '器材清點',
      expectedTime: '18:30-20:30',
      status: '缺席',
      isApprovedLeave: true,
      reason: '公假代表學校參賽',
      note: '',
    },
    {
      id: '3',
      date: '2026-10-15',
      activityName: '總彩排',
      expectedTime: '18:00-21:30',
      status: '缺席',
      isApprovedLeave: false,
      reason: '未事先請假',
      note: '',
    },
  ];

  const stats = calculateAttendanceStats(records);
  assert.equal(stats.totalSessions, 3);
  assert.equal(stats.unexcusedAbsences, 1);
  assert.equal(stats.approvedLeaveCount, 1);
  assert.equal(stats.attendanceRate, 50);
});

test('UTF-8 Base64 URL state encoder/decoder preserves Traditional Chinese characters', () => {
  const payload = { title: '活動A-迎新宿營', member: '小明', points: 3.5 };
  const encoded = encodeStateToBase64Url(payload);
  const decoded = decodeStateFromBase64Url<typeof payload>(encoded);
  assert.deepEqual(decoded, payload);
});
