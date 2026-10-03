// 领域层日志槽：UI 可挂接渲染。默认静默。
// 约束（spec: ai-runtime 隐私边界）：日志不得包含完整原文与完整 API Key。

export type DomainLogger = (tag: string, msg: string, err?: boolean) => void;

let sink: DomainLogger = () => {};

export function setDomainLogger(fn: DomainLogger) {
  sink = fn;
}

export function dlog(tag: string, msg: string, err = false) {
  sink(tag, msg, err);
}
