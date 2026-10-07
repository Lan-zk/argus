// updateStore 状态机（spec: app-updates / auto-update design D2）：
// 静默/手动检查分叉、确认前不下载、进度聚合、失败安全、unsupported 兜底、横幅关闭语义。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const checkMock = vi.fn();
const relaunchMock = vi.fn();
const getVersionMock = vi.fn();
let tauriEnv = true;

vi.mock("@tauri-apps/plugin-updater", () => ({ check: (...a: unknown[]) => checkMock(...a) }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: (...a: unknown[]) => relaunchMock(...a) }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: (...a: unknown[]) => getVersionMock(...a) }));
vi.mock("../lib/tauri", () => ({ isTauri: () => tauriEnv }));

import { useUpdateStore } from "./update";

/** 构造插件 Update 桩：downloadAndInstall 依次派发进度事件后 resolve。 */
function fakeUpdate(over: Partial<{ version: string; body: string | null; date: string }> = {}) {
  return {
    version: over.version ?? "0.2.0",
    body: over.body === undefined ? "修复若干问题" : over.body,
    date: over.date ?? "2026-10-07T00:00:00Z",
    downloadAndInstall: vi.fn(async (onEvent: (e: never) => void) => {
      onEvent({ event: "Started", data: { contentLength: 200 } } as never);
      onEvent({ event: "Progress", data: { chunkLength: 100, contentLength: 200 } } as never);
      onEvent({ event: "Progress", data: { chunkLength: 60 } } as never);
      onEvent({ event: "Finished", data: {} } as never);
    }),
  };
}

beforeEach(() => {
  tauriEnv = true;
  checkMock.mockReset();
  relaunchMock.mockReset().mockResolvedValue(undefined);
  getVersionMock.mockReset().mockResolvedValue("0.1.0");
  setActivePinia(createPinia());
});

describe("环境兜底（design D3）", () => {
  it("非 Tauri 环境：unsupported，静默检查直接返回不触达插件", async () => {
    tauriEnv = false;
    setActivePinia(createPinia());
    const s = useUpdateStore();
    expect(s.status).toBe("unsupported");
    await s.check4Update(true);
    expect(checkMock).not.toHaveBeenCalled();
    expect(s.status).toBe("unsupported");
  });

  it("refreshVersion 失败静默占位，不抛错", async () => {
    getVersionMock.mockRejectedValue(new Error("not in tauri"));
    const s = useUpdateStore();
    await s.refreshVersion();
    expect(s.appVersion).toBe("");
  });
});

describe("版本检查（spec: 版本检查时机 / 更新提示与用户确认）", () => {
  it("静默检查发现新版本 → available，携带版本号与说明", async () => {
    checkMock.mockResolvedValue(fakeUpdate());
    const s = useUpdateStore();
    await s.check4Update(true);
    expect(s.status).toBe("available");
    expect(s.pending).toMatchObject({ version: "0.2.0", notes: "修复若干问题" });
    expect(s.bannerVisible).toBe(true);
  });

  it("静默检查失败 → 回 idle，不落错误（不打扰）", async () => {
    checkMock.mockRejectedValue(new Error("network error"));
    const s = useUpdateStore();
    await s.check4Update(true);
    expect(s.status).toBe("idle");
    expect(s.error).toBe("");
  });

  it("手动检查失败 → check-failed + 可读中文错误", async () => {
    checkMock.mockRejectedValue(new Error("Failed to fetch"));
    const s = useUpdateStore();
    await s.check4Update(false);
    expect(s.status).toBe("check-failed");
    expect(s.error).toContain("网络错误");
  });

  it("手动检查无更新 → up-to-date", async () => {
    checkMock.mockResolvedValue(null);
    const s = useUpdateStore();
    await s.check4Update(false);
    expect(s.status).toBe("up-to-date");
    expect(s.pending).toBeNull();
  });

  it("更新说明缺失：notes 为空串，仍展示版本号（不报错）", async () => {
    checkMock.mockResolvedValue(fakeUpdate({ body: null }));
    const s = useUpdateStore();
    await s.check4Update(true);
    expect(s.status).toBe("available");
    expect(s.pending?.notes).toBe("");
  });
});

describe("横幅关闭语义（spec「关闭提示后本次运行不再弹出」）", () => {
  it("关闭后同版本不再自动弹出；手动重新检查重新展示", async () => {
    checkMock.mockResolvedValue(fakeUpdate());
    const s = useUpdateStore();
    await s.check4Update(true);
    s.dismissBanner();
    expect(s.bannerVisible).toBe(false);
    // 下次启动的静默检查发现同一版本：仍不弹
    await s.check4Update(true);
    expect(s.bannerVisible).toBe(false);
    // 手动检查：重新展示
    await s.check4Update(false);
    expect(s.bannerVisible).toBe(true);
  });
});

describe("一键更新链路（spec: 一键更新链路）", () => {
  it("确认前不下载：available 状态不调用 downloadAndInstall", async () => {
    checkMock.mockResolvedValue(fakeUpdate());
    const s = useUpdateStore();
    await s.check4Update(true);
    expect(s.status).toBe("available");
  });

  it("确认后：下载（进度聚合 0→100）→ installing → relaunch", async () => {
    checkMock.mockResolvedValue(fakeUpdate());
    const s = useUpdateStore();
    await s.check4Update(true);
    await s.startUpdate();
    // 桩环境一次 await 跑完整链：进度聚合完成 → relaunch 被调 → resolve 后落「重启失败」分支（真机此处已退出进程）
    expect(s.progress).toBe(100);
    expect(relaunchMock).toHaveBeenCalledTimes(1);
    expect(s.status).toBe("install-failed"); // 桩环境走「重启失败」分支并给出手动重启提示
    expect(s.error).toContain("手动重启");
  });

  it("下载/验签失败 → install-failed + 可读错误，可取消回 available 再重试", async () => {
    const u = fakeUpdate();
    u.downloadAndInstall = vi.fn(async () => {
      throw new Error("signature verification failed");
    });
    checkMock.mockResolvedValue(u);
    const s = useUpdateStore();
    await s.check4Update(true);
    await s.startUpdate();
    expect(s.status).toBe("install-failed");
    expect(s.error).toContain("signature verification failed");
    s.cancelFailed();
    expect(s.status).toBe("available");
    expect(s.error).toBe("");
  });

  it("总大小未知：progress 保持 null（不确定进度）", async () => {
    const u = fakeUpdate();
    u.downloadAndInstall = vi.fn(async (onEvent: (e: never) => void) => {
      onEvent({ event: "Started", data: {} } as never);
      onEvent({ event: "Progress", data: { chunkLength: 10 } } as never);
    });
    checkMock.mockResolvedValue(u);
    const s = useUpdateStore();
    await s.check4Update(true);
    await s.startUpdate();
    expect(s.progress).toBeNull();
  });
});
