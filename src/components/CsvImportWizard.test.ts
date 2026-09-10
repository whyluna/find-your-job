import { describe, expect, it } from "vitest";
import { buildImportRows, guessField, parseCsv } from "./CsvImportWizard";

describe("parseCsv", () => {
  it("保留字段正文中的中文逗号", () => {
    expect(parseCsv("公司,备注\n某科技,负责研发，测试和上线\n")).toEqual([
      ["公司", "备注"],
      ["某科技", "负责研发，测试和上线"],
    ]);
  });

  it("支持引号内的英文逗号、换行和转义引号", () => {
    expect(parseCsv('a,b\n1,"x,y\n""z"""\n')).toEqual([
      ["a", "b"],
      ["1", 'x,y\n"z"'],
    ]);
  });
});

it("区分计划、网申截止、实际投递和流程快照，并完整保留 JSON", () => {
  const snapshot = JSON.stringify({version:1, events:[{note:'含,逗号和"引号"\n下一行'}]});
  const csv = '公司,岗位,计划投递时间,网申截止时间,投递日期,当前状态,流程数据,面试轮数\n测试,工程师,2026-09-11T09:00:00Z,2026-09-12T09:00:00Z,,意向岗位,"' + snapshot.replaceAll('"', '""') + '",0\n';
  const parsed = parseCsv(csv);
  const mapping = Object.fromEntries(parsed[0].map((header,index) => [index,guessField(header)]));
  const row = buildImportRows(parsed,mapping)[0];
  expect(row.applied).toBe(false);
  expect(row.plannedApplyAt).toBe('2026-09-11T09:00:00.000Z');
  expect(row.applicationDeadline).toBe('2026-09-12T09:00:00.000Z');
  expect(row.importStatus).toBe('意向岗位');
  expect(row.progressData).toBe(snapshot);
  expect(row.validationError).toBeNull();
});

it("损坏 CSV、非法计划日期和轮次不能静默降级", () => {
  expect(() => parseCsv('公司,岗位\n测试,"不完整')).toThrow('引号未闭合');
  const rows = [['公司','岗位','计划投递时间','面试轮数'],['测试','工程师','不是日期','NaN']];
  const mapping = Object.fromEntries(rows[0].map((header,index) => [index,guessField(header)]));
  const error = buildImportRows(rows,mapping)[0].validationError;
  expect(error).toContain('计划投递时间');
  expect(error).toContain('面试轮数');
});

describe("guessField", () => {
  it("应用自身导出的岗位链接不会误识别为岗位名称", () => {
    expect(guessField("岗位")).toBe("positionTitle");
    expect(guessField("岗位链接")).toBe("jobUrl");
    expect(guessField("Job URL")).toBe("jobUrl");
  });
});
