import { homedir } from "node:os";
import { join } from "node:path";

// scope.mjs —— 配置作用域解析层
// -----------------------------------------------------------------------------
// Bennira 的配置分两层，像 VS Code 的 settings：
//   - 全局层 ~/.bennira/    ：一次配好，所有项目共享（模型 endpoint / key / 默认主题）
//   - 项目层 <project>/.bennira/：只放该项目要覆盖的差异（换个模型、换个配色）
//
// 读取时按 [全局, 项目] 顺序逐层深合并，后者覆盖前者——所以"项目级覆盖全局"。
// 写入时由调用方指定 scope（"global" | "project"），各写各的 .bennira，互不污染。
//
// 全局根默认是用户主目录下的 ~/.bennira，可用环境变量 BENNIRA_HOME 覆盖
// （测试时指向临时目录，避免碰真实 ~；也方便企业统一注入配置根）。

export const SCOPES = Object.freeze({ GLOBAL: "global", PROJECT: "project" });

// 全局配置根目录（~ 或 BENNIRA_HOME）。注意：返回的是"家目录"，
// 真正的配置在其下的 .bennira/，与项目层结构一致。
export function globalRoot() {
  return process.env.BENNIRA_HOME || homedir();
}

// 给定项目根，返回从低到高优先级的配置根链：[全局, 项目]。
// 若项目根恰好等于全局根（少见，比如在 ~ 里直接跑），去重成一层。
export function configChain(projectRoot) {
  const g = globalRoot();
  if (!projectRoot || projectRoot === g) {
    return [g];
  }
  return [g, projectRoot];
}

// 把 scope 名解析成对应的配置根目录。
export function rootForScope(projectRoot, scope = SCOPES.PROJECT) {
  return scope === SCOPES.GLOBAL ? globalRoot() : projectRoot;
}

// 便捷：某个配置根下的 .bennira 目录。
export function dotBennira(root) {
  return join(root, ".bennira");
}
