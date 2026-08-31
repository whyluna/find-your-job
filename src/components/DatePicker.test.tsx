import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DatePicker } from "./DatePicker";

afterEach(cleanup);

describe("DatePicker", () => {
  it("今天按钮会真正选择今天，日期按钮带完整可访问名称", () => {
    const onChange = vi.fn();
    render(<DatePicker value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "选择日期" }));
    expect(screen.getByRole("dialog", { name: "选择日期" })).toBeTruthy();
    const today = new Date();
    const fullName = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;
    expect(screen.getByRole("button", { name: fullName })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "今天" }));
    expect(onChange).toHaveBeenCalledOnce();
    const selected = new Date(onChange.mock.calls[0][0]);
    expect(selected.getFullYear()).toBe(today.getFullYear());
    expect(selected.getMonth()).toBe(today.getMonth());
    expect(selected.getDate()).toBe(today.getDate());
  });

  it("Escape 只关闭日期弹层", () => {
    render(<DatePicker value={null} onChange={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "选择日期" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "选择日期" })).toBeNull();
  });
});
