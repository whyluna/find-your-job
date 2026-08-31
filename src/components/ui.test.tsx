import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Modal } from "./ui";

afterEach(() => {
  cleanup();
  document.getElementById("root")?.remove();
});

describe("Modal", () => {
  it("建立真正的模态边界、聚焦表单并在关闭后恢复焦点", async () => {
    const root = document.createElement("div");
    root.id = "root";
    document.body.appendChild(root);
    const onClose = vi.fn();
    const view = render(
      <>
        <button>打开弹窗</button>
        <Modal open={false} onClose={onClose} title="测试弹窗">
          <input aria-label="姓名" />
        </Modal>
      </>,
      { container: root },
    );
    const opener = screen.getByRole("button", { name: "打开弹窗" });
    opener.focus();
    view.rerender(
      <>
        <button>打开弹窗</button>
        <Modal open onClose={onClose} title="测试弹窗">
          <input aria-label="姓名" />
        </Modal>
      </>,
    );

    const dialog = screen.getByRole("dialog", { name: "测试弹窗" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(root.hasAttribute("inert")).toBe(true);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "姓名" })));

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    view.rerender(
      <>
        <button>打开弹窗</button>
        <Modal open={false} onClose={onClose} title="测试弹窗">
          <input aria-label="姓名" />
        </Modal>
      </>,
    );
    await waitFor(() => expect(root.hasAttribute("inert")).toBe(false));
    expect(document.activeElement?.textContent).toBe("打开弹窗");
  });
});
