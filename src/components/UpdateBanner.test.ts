// UpdateBanner 组件测试（spec: app-updates 更新提示与用户确认 / 一键更新链路）：
// 展示（版本号+说明摘要）、关闭（本次运行不再弹出）、触发更新、失败重试/取消。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import UpdateBanner from "./UpdateBanner.vue";
import { useUpdateStore } from "../stores/update";
import type { UpdateInfo, UpdateStatus } from "../stores/update";

beforeEach(() => {
  setActivePinia(createPinia());
});

/** 直挂组件：active pinia 与组件 plugin pinia 同一实例。 */
function mountBanner() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const w = mount(UpdateBanner, { global: { plugins: [pinia] } });
  const s = useUpdateStore();
  return { w, s };
}

/** $patch 后等 DOM 重渲染再断言。 */
async function patch(
  s: ReturnType<typeof useUpdateStore>,
  state: { status?: UpdateStatus; pending?: UpdateInfo | null; progress?: number | null; error?: string },
) {
  s.$patch(state);
  await nextTick();
}

describe("available：提示与用户确认", () => {
  it("展示新版本号与说明摘要；说明超长截断且 title 含全文", async () => {
    const { w, s } = mountBanner();
    await patch(s, { status: "available", pending: { version: "0.2.0", notes: "修复若干问题" } });
    expect(w.find('[data-test="update-banner"]').text()).toContain("v0.2.0");
    expect(w.find('[data-test="update-banner"]').text()).toContain("修复若干问题");

    const long = "很长的更新说明".repeat(20);
    await patch(s, { pending: { version: "0.3.0", notes: long } });
    expect(w.find('[data-test="update-banner"]').text()).toContain("…");
    expect(w.find(".ub-notes").attributes("title")).toBe(long);
    w.unmount();
  });

  it("说明缺失时仅展示版本号，不渲染说明元素", async () => {
    const { w, s } = mountBanner();
    await patch(s, { status: "available", pending: { version: "0.2.0", notes: "" } });
    expect(w.find('[data-test="update-banner"]').text()).toContain("v0.2.0");
    expect(w.find(".ub-notes").exists()).toBe(false);
    w.unmount();
  });

  it("点击「立即更新」调用 startUpdate（确认前不下载由 store 保证，此处验证触发）", async () => {
    const { w, s } = mountBanner();
    await patch(s, { status: "available", pending: { version: "0.2.0", notes: "" } });
    const spy = vi.spyOn(s, "startUpdate").mockResolvedValue(undefined);
    await w.find('[data-test="update-accept"]').trigger("click");
    expect(spy).toHaveBeenCalledTimes(1);
    w.unmount();
  });

  it("关闭后横幅消失且状态保持 available（本次运行不再自动弹出）", async () => {
    const { w, s } = mountBanner();
    await patch(s, { status: "available", pending: { version: "0.2.0", notes: "" } });
    await w.find('[data-test="update-dismiss"]').trigger("click");
    await nextTick();
    expect(w.find('[data-test="update-banner"]').exists()).toBe(false);
    expect(s.status).toBe("available");
    expect(s.dismissedVersion).toBe("0.2.0");
    w.unmount();
  });
});

describe("下载/安装/失败各态", () => {
  it("downloading 展示进度百分比；进度未知时无数字", async () => {
    const { w, s } = mountBanner();
    await patch(s, { status: "downloading", progress: 42 });
    expect(w.find('[data-test="update-banner"]').text()).toContain("42%");
    await patch(s, { progress: null });
    expect(w.find('[data-test="update-banner"]').text()).not.toContain("%");
    w.unmount();
  });

  it("installing 提示安装与自动重启", async () => {
    const { w, s } = mountBanner();
    await patch(s, { status: "installing" });
    expect(w.find('[data-test="update-banner"]').text()).toContain("自动重启");
    w.unmount();
  });

  it("install-failed 展示错误并提供重试/取消；取消后横幅收起", async () => {
    const { w, s } = mountBanner();
    await patch(s, { status: "install-failed", error: "更新失败：验签未通过" });
    expect(w.find(".ub-error").text()).toContain("验签未通过");
    const retry = vi.spyOn(s, "startUpdate").mockResolvedValue(undefined);
    await w.find('[data-test="update-retry"]').trigger("click");
    expect(retry).toHaveBeenCalledTimes(1);
    await w.find('[data-test="update-cancel"]').trigger("click");
    await nextTick();
    expect(w.find('[data-test="update-banner"]').exists()).toBe(false);
    w.unmount();
  });

  it("idle / up-to-date / check-failed 等非横幅状态不渲染", async () => {
    const { w, s } = mountBanner();
    for (const st of ["idle", "up-to-date", "check-failed", "checking"] as const) {
      await patch(s, { status: st });
      expect(w.find('[data-test="update-banner"]').exists(), st).toBe(false);
    }
    w.unmount();
  });
});
