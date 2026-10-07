// 导入预览确认层（spec: document-import 预览确认 / 导入长文策略）：
// 确认/取消/手动修正路径 + 超 30k 警告与「继续导入」措辞。
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import ImportPreview from "./ImportPreview.vue";

const SHORT = { kind: "docx", filename: "报告.docx", text: "# 标题\n\n正文内容。" } as const;

describe("ImportPreview 预览确认", () => {
  it("展示来源信息与提取文本", () => {
    const w = mount(ImportPreview, { props: { ...SHORT } });
    expect(w.find('[data-test="import-preview-src"]').text()).toContain("报告.docx");
    expect((w.find('[data-test="import-preview-text"]').element as HTMLTextAreaElement).value).toBe(SHORT.text);
  });

  it("确认 → 以预览文本 emit confirm", async () => {
    const w = mount(ImportPreview, { props: { ...SHORT } });
    await w.find('[data-test="import-confirm"]').trigger("click");
    expect(w.emitted("confirm")![0]).toEqual([SHORT.text]);
    expect(w.emitted("cancel")).toBeUndefined();
  });

  it("手动修正提取损耗后确认 → 确认的是修正文本（spec: 预览中手动修正）", async () => {
    const w = mount(ImportPreview, { props: { ...SHORT } });
    await w.find('[data-test="import-preview-text"]').setValue("# 标题\n\n修正后的正文。");
    await w.find('[data-test="import-confirm"]').trigger("click");
    expect(w.emitted("confirm")![0]).toEqual(["# 标题\n\n修正后的正文。"]);
  });

  it("取消 → emit cancel，不产生确认", async () => {
    const w = mount(ImportPreview, { props: { ...SHORT } });
    await w.find('[data-test="import-cancel"]').trigger("click");
    expect(w.emitted("cancel")).toHaveLength(1);
    expect(w.emitted("confirm")).toBeUndefined();
  });

  it("超 30k：显示长文降级警告且按钮为「继续导入」（spec: 导入长文策略，MUST NOT 截断）", async () => {
    const long = "长".repeat(80_000);
    const w = mount(ImportPreview, { props: { kind: "pdf", filename: "big.pdf", text: long } });
    expect(w.find('[data-test="import-overlimit-warn"]').exists()).toBe(true);
    expect(w.text()).toContain("长文结构化降级");
    const confirmBtn = w.find('[data-test="import-confirm"]');
    expect(confirmBtn.text()).toContain("继续导入");
    await confirmBtn.trigger("click");
    // 全量确认，未截断
    expect((w.emitted("confirm")![0] as string[])[0].length).toBe(80_000);
  });

  it("未超限：无警告、按钮为「确认进入审阅」", () => {
    const w = mount(ImportPreview, { props: { ...SHORT } });
    expect(w.find('[data-test="import-overlimit-warn"]').exists()).toBe(false);
    expect(w.find('[data-test="import-confirm"]').text()).toContain("确认进入审阅");
  });
});
