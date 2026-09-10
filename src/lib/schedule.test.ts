import { describe, expect, it } from "vitest";
import { planningLabel, reminderFor } from "./schedule";

const now = new Date('2026-09-10T10:00:00Z').getTime();
const base = {applicationId:'app',companyName:'测试公司',positionTitle:'岗位',kind:'planned_apply',at:'2026-09-11T08:00:00Z'};
describe('投递计划提醒', () => {
  it('计划与网申截止使用截止提前量，且不能被误叫作面试', () => {
    expect(reminderFor(base,now,24,2)?.title).toContain('计划投递');
    expect(reminderFor({...base,kind:'application_deadline'},now,24,2)?.title).toContain('网申截止');
    expect(reminderFor(base,now,12,2)).toBeNull();
    expect(reminderFor({...base,kind:'interview'},now,24,2)).toBeNull();
  });
  it('错过计划或截止后仍可提醒，重设日期形成不同的去重键', () => {
    const expired = {...base,at:'2026-09-09T08:00:00Z'};
    expect(reminderFor(expired,now,24,2)?.title).toContain('计划已到期');
    expect(reminderFor({...expired,kind:'application_deadline'},now,24,2)?.title).toContain('网申已截止');
    expect(reminderFor(expired,now,24,2)?.key).not.toBe(reminderFor(base,now,24,2)?.key);
    expect(reminderFor({...expired,kind:'deadline'},now,24,2)).toBeNull();
  });
  it('非法时间和待补面试结果不发送新提醒', () => {
    expect(reminderFor({...base,at:'bad'},now,24,2)).toBeNull();
    expect(reminderFor({...base,kind:'overdue_interview'},now,24,2)).toBeNull();
    expect(planningLabel('interview',base.at,now)).toBeNull();
  });
});
