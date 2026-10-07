// updateStore（spec: app-updates / auto-update design D2）：应用内自动更新状态机。
// 静默路径（启动检查）失败一律吞掉不打扰；手动路径产出可读中文错误；
// 纯浏览器 dev 环境（非 Tauri）整体 unsupported，更新 UI 隐藏、版本号走 fallback。
import { defineStore } from "pinia";
import { isTauri } from "../lib/tauri";
import { check } from "@tauri-apps/plugin-updater";
import type { Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";

export type UpdateStatus =
  | "unsupported" // 非 Tauri 环境（纯浏览器 dev）
  | "idle"
  | "checking"
  | "available" // 发现新版本，等待用户确认（未确认绝不下载）
  | "up-to-date"
  | "check-failed"
  | "downloading"
  | "installing"
  | "install-failed"; // 下载/验签/安装失败：当前版本保持可用

/** 更新提示信息（来自 latest.json；notes 缺失时仅展示版本号）。 */
export interface UpdateInfo {
  version: string;
  notes: string;
  date?: string;
}

/** 插件返回的 Update 对象含回调式 API，不进响应式 state，模块级持有。 */
let activeUpdate: Update | null = null;

/** 已被用户关闭提示的版本号（仅本次运行；再次检查到同一版本不再自动弹出）。 */
function readableError(e: unknown, fallbackPrefix: string): string {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  if (/network|failed to fetch|fetch failed|dns|econnrefused|connection/i.test(msg)) {
    return `${fallbackPrefix}：网络错误，请检查网络连接后重试`;
  }
  if (/timeout|timed?\s*out/i.test(msg)) {
    return `${fallbackPrefix}：请求超时，请稍后重试`;
  }
  return msg ? `${fallbackPrefix}：${msg}` : fallbackPrefix;
}

export const useUpdateStore = defineStore("update", {
  state: () => ({
    status: (isTauri() ? "idle" : "unsupported") as UpdateStatus,
    /** 当前应用版本号（「关于」展示；加载失败显示 —）。 */
    appVersion: "",
    /** 发现的更新（available 起有效）。 */
    pending: null as UpdateInfo | null,
    /** 下载进度 0–100；null = 总大小未知（不确定进度）。 */
    progress: null as number | null,
    /** 手动路径的可读错误文案（静默路径不落此字段）。 */
    error: "",
    /** 启动横幅被关闭时对应的版本号（本次运行内不再自动弹出）。 */
    dismissedVersion: null as string | null,
    /** 是否正在加载版本号。 */
    loadingVersion: false,
  }),

  getters: {
    /** 横幅可见性：available（未被关闭）+ 下载/安装中 + 安装失败。 */
    bannerVisible(state): boolean {
      if (state.status === "downloading" || state.status === "installing" || state.status === "install-failed") {
        return true;
      }
      if (state.status !== "available" || !state.pending) return false;
      return state.dismissedVersion !== state.pending.version;
    },
  },

  actions: {
    /** 加载当前版本号（失败静默，「关于」显示占位）。 */
    async refreshVersion() {
      if (this.loadingVersion || this.appVersion) return;
      this.loadingVersion = true;
      try {
        this.appVersion = await getVersion();
      } catch {
        this.appVersion = ""; // 非 Tauri 环境等：占位显示
      } finally {
        this.loadingVersion = false;
      }
    },

    /**
     * 版本检查（spec: app-updates 版本检查时机）。
     * @param silent true = 启动静默路径：失败吞掉回 idle；false = 手动路径：失败落 check-failed + 可读错误。
     * 比较语义（仅更高版本视为可更新）由 updater 内核承担。
     */
    async check4Update(silent: boolean) {
      if (this.status === "unsupported") return;
      if (this.status === "checking" || this.status === "downloading" || this.status === "installing") return;
      this.status = "checking";
      this.error = "";
      try {
        const update = await check({ timeout: 15000 });
        if (update) {
          activeUpdate = update;
          this.pending = { version: update.version, notes: update.body ?? "", date: update.date };
          this.status = "available";
          if (!silent) this.dismissedVersion = null; // 手动检查：重新展示横幅
        } else {
          this.pending = null;
          this.status = "up-to-date";
        }
      } catch (e) {
        if (silent) {
          this.status = "idle"; // 静默失败：不打扰（spec 场景「静默检查失败不打扰」）
        } else {
          this.status = "check-failed";
          this.error = readableError(e, "检查更新失败");
        }
      }
    },

    /**
     * 一键更新（spec: app-updates 一键更新链路）：仅由用户确认触发。
     * 下载（进度）→ minisign 验签 → 安装 → 重启；任一步失败当前版本保持可用。
     */
    async startUpdate() {
      if (!activeUpdate || (this.status !== "available" && this.status !== "install-failed")) return;
      this.status = "downloading";
      this.progress = null;
      this.error = "";
      let downloaded = 0;
      let total = 0;
      try {
        await activeUpdate.downloadAndInstall((event) => {
          if (event.event === "Started" && event.data.contentLength) {
            total = event.data.contentLength;
          } else if (event.event === "Progress") {
            downloaded += event.data.chunkLength;
            // 插件类型未标 Progress 的可选 contentLength（运行时存在），收窄读取
            const len = (event.data as { chunkLength: number; contentLength?: number }).contentLength;
            if (len) total = len;
            this.progress = total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : null;
          } else if (event.event === "Finished") {
            this.progress = 100;
          }
        });
        this.status = "installing";
        await relaunch();
        // relaunch 成功即退出进程，不到这里；失败则提示手动重启
        this.status = "install-failed";
        this.error = "新版本已安装，但自动重启失败：请手动重启应用完成更新。";
      } catch (e) {
        this.status = "install-failed";
        this.error = readableError(e, "更新失败");
      }
    },

    /** 关闭 available 横幅：记录版本号，本次运行不再自动弹出（spec「关闭提示后本次运行不再弹出」）。 */
    dismissBanner() {
      if (this.pending) this.dismissedVersion = this.pending.version;
    },

    /** install-failed 横幅的「取消」：回到 idle，后续可再次从「关于」或下次检查发起。 */
    cancelFailed() {
      if (this.status === "install-failed") {
        this.status = activeUpdate ? "available" : "idle";
        this.error = "";
      }
    },
  },
});
