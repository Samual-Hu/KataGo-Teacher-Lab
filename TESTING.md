# 验证记录

2026-09-13，Windows 本机 Chromium / WebGPU。

- `npm test`：14 项通过，覆盖 SGF、规则、收敛、候选去重与最终反转、数据集 JSONL 往返和损坏记录拒绝。
- GitHub Actions：Emscripten 6.0.1 完整 WASM 编译成功，Pages 静态文件构建和发布成功。
- `npm run test:engine`：实例化真实 512MB pthread WASM、检查研究 ABI、空队列和无引擎结束请求，通过。
- 浏览器导入 `tests/variation.sgf`：识别 7 节点、黑白摆子与两个变化分支；跳到节点 6 后保留 4 手历史，通过 C++ 棋盘一致性检查。
- 加载上游 `b4c256h4nbttflrs-fson-silu-rsnh.bin.gz`：modelVersion 17 Transformer，SHA-256 `d10c966976a31fa7cba6dd625799a12886af06b0503a2a2a98a37f74e5cbcf6e`，实际 WebGPU 后端加载成功。
- 9 路局面、4 线程、128 Visits 上限：实际最终 131 Visits；得到 66、99、131 三个完整采样，最后一帧标记 forcedFinal；未误判稳定。
- 原生快照核验：82 项 Policy（含 pass）、81 项根 Ownership 及其标准差、26 个候选（超过上游演示的 8 个）、候选 Ownership、完整 PV 和原始参数，以及精确根胜/负/无结果概率均存在。
- IndexedDB 自动保存，界面显示已完成记录和相应采样数。

测试网权重仅验证 Transformer 执行路径，不能代表强教师棋力；尚未验证用户未来选定的大型正式教师在其 GPU 上的性能或最大可用模型尺寸。任何性能数字仅指上述测试网络和测试局面。
