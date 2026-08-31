import { describe, expect, it } from "vitest";
import { guessField, parseCsv } from "./CsvImportWizard";

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

describe("guessField", () => {
  it("应用自身导出的岗位链接不会误识别为岗位名称", () => {
    expect(guessField("岗位")).toBe("positionTitle");
    expect(guessField("岗位链接")).toBe("jobUrl");
    expect(guessField("Job URL")).toBe("jobUrl");
  });
});
