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


## 2026-09-28 官方 9 路模型回归

Windows / Intel gen-12lp / Chrome，真实 WebGPU FP32，官方模型与哈希见 README。
修复前 4 线程稳定复现 `Got nonfinite for policy sum`；1 线程完成 128 Visits。用户亦确认学校电脑 1 线程正常。

修复 Winograd 持久权重被临时池复用后，自动硬件回归全部通过：

| 场景 | 实际 Visits | NN 行 / 批次 | 候选数 | Policy / Ownership |
|---|---:|---:|---:|---:|
| 首次 1 线程 | 128 | 128 / 128 | 5 | 82 / 81 |
| 同 Worker 改为 4 线程 | 131 | 131 / 67 | 5 | 82 / 81 |
| 同 Worker 再搜索 | 131 | 131 / 66 | 5 | 82 / 81 |
| 重载同一模型后 4 线程 | 130 | 130 / 66 | 5 | 82 / 81 |

每次包含 forcedFinal、有限数值的 Value、有效 PV、根及候选 Ownership。
NN 行数大于批次数，确认覆盖了多样本批次。Visits 小幅超过 128 是并发搜索停止时的实际计数。
18 项已发布单元测试通过（含 4 项异常诊断测试）；真实 pthread WASM ABI 和构建哈希检查通过。
性能与数值验证仅针对上述硬件和测试局面；不代表所有设备的显存承载能力或高 Visits 稳定性。

Edge 页面测试：同一文件重复选择、9→19→9 尺寸切换后强制重载均正常；4 线程 128 Visits 预算最终 131 Visits，39.1 秒；无页面异常，IndexedDB 保存完成。截图保存在 `test-results/edge-9x9-fixed.png`（本地忽略）。
