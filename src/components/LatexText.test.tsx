import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LatexText } from "@/components/LatexText";

describe("LatexText", () => {
  it("行内公式 $...$ 渲染为 katex 元素", () => {
    const { container } = render(<LatexText>注意力 $QK^TV$ 的缩放因子</LatexText>);
    expect(container.querySelector(".katex")).toBeTruthy();
    expect(screen.getByText(/注意力/)).toBeTruthy();
  });

  it("块级公式 $$...$$ 渲染为 display 模式", () => {
    const { container } = render(<LatexText>推导：$$E=mc^2$$ 完毕</LatexText>);
    expect(container.querySelector(".katex-display")).toBeTruthy();
  });

  it("普通文本不含 $ 时原样输出", () => {
    render(<LatexText>常规面经内容</LatexText>);
    expect(screen.getByText("常规面经内容")).toBeTruthy();
  });

  it("非法公式回退为红字原文提示", () => {
    const { container } = render(<LatexText>错误 $\frac{$ 试一下</LatexText>);
    // 不抛异常、页面仍有内容
    expect(container.textContent).toContain("错误");
  });

  it("中文与公式混排", () => {
    const { container } = render(
      <LatexText>softmax 定义为 $\sigma(z)_i = \frac{e^{z_i}}{\sum_j e^{z_j}}$，用于多分类。</LatexText>,
    );
    expect(container.querySelectorAll(".katex").length).toBeGreaterThanOrEqual(1);
    expect(container.textContent).toContain("softmax");
  });
});
