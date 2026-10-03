// 并发池（spec: review-orchestration 并发控制）
import { describe, expect, it } from "vitest";
import { ConcurrencyPool } from "./pool";

describe("ConcurrencyPool", () => {
  it("6 个任务并发不超过上限 3", async () => {
    const pool = new ConcurrencyPool(3);
    let active = 0;
    let peak = 0;
    const tasks = Array.from({ length: 6 }, (_, i) =>
      pool.run(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 10 + (i % 3) * 5));
        active--;
        return i;
      }),
    );
    const results = await Promise.all(tasks);
    expect(results).toHaveLength(6);
    expect(peak).toBe(3);
    expect(pool.activeCount).toBe(0);
  });

  it("上限为 1 时串行执行", async () => {
    const pool = new ConcurrencyPool(1);
    const order: number[] = [];
    await Promise.all(
      [1, 2, 3].map((n) =>
        pool.run(async () => {
          order.push(n);
          await new Promise((r) => setTimeout(r, 5));
        }),
      ),
    );
    expect(order).toEqual([1, 2, 3]);
  });

  it("任务失败不影响其他任务，池恢复可用", async () => {
    const pool = new ConcurrencyPool(2);
    await expect(pool.run(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    const ok = await pool.run(async () => "fine");
    expect(ok).toBe("fine");
  });
});
