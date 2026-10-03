// 简单并发池（spec: review-orchestration 并行执行与并发控制 / design 决策 10）。
// 默认上限 3；Provider 并发限制信息优先于应用上限（由调用方传入更小的 limit）。

export class ConcurrencyPool {
  private active = 0;
  private queue: (() => void)[] = [];

  constructor(public limit: number = 3) {}

  get activeCount(): number {
    return this.active;
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  /** 提交一个任务；返回的 Promise 在该任务完成（成功或失败）后 resolve。 */
  run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        this.active++;
        task()
          .then(resolve, reject)
          .finally(() => {
            this.active--;
            const next = this.queue.shift();
            if (next) next();
          });
      };
      if (this.active < this.limit) start();
      else this.queue.push(start);
    });
  }

  /** 等待全部已提交任务完成。 */
  async drain(): Promise<void> {
    while (this.active > 0 || this.queue.length > 0) {
      if (this.queue.length > 0) {
        const next = this.queue.shift()!;
        next();
        await Promise.resolve();
        continue;
      }
      await new Promise((r) => setTimeout(r, 0));
    }
  }
}
