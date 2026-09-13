# KataGo 教师研究室

使用本地 GPU 的围棋教师数据工作台，基于 [saigo-online/katago-webgpu](https://github.com/saigo-online/katago-webgpu)。静态网站部署在 GitHub Pages；教师权重、SGF 和分析数据不上传，GitHub Actions 仅编译引擎和发布静态文件。

网站：<https://samual-hu.github.io/KataGo-Teacher-Lab/>

## 使用

1. 用桌面 Chrome / Edge 打开网站。首次打开会注册同源 Service Worker 并刷新，提供 WASM 多线程需要的跨源隔离。必须是 HTTPS 或 localhost。
2. 从本机选择 KataGo `.bin.gz` / `.bin` / `.txt.gz` 权重。保留原始权重文件；记录中的 SHA-256 对原始文件字节计算，重新 gzip 会产生不同哈希。
3. 上传 SGF，选择任意节点或变化分支；也可落子或手工摆黑白子。棋盘支持 9 / 13 / 19 路、贴目和行棋方。改变棋盘尺寸须重新加载权重。
4. 设置 Visits / 时间上限、搜索线程和收敛阈值，开始分析。一次记录使用一个新搜索树，在记录内持续加深，不重启分段搜索。
5. 每个完整采样自动保存到 IndexedDB；可查看历史采样、候选着、PV、Policy / Ownership 叠加和趋势，并下载 JSON 或累计 JSONL。支持导入累积数据；同 ID 不覆盖。

## 模型兼容性和真实性

固定上游提交 `d5ad1c0423dba989c60a2f06b1848e7eec2b5941`。上游支持 modelVersion ≤17 的卷积、嵌套瓶颈和 Transformer 架构，包括 attention、RoPE、SwiGLU、RMSNorm、GQA；**这不意味着未来任意权重都兼容**。SGF 元数据编码器、分组 RMSNorm 等上游未支持结构会报错。新模型格式需要升级上游并重新编译。

请自行从 [KataGo 官方训练站](https://katagotraining.org/) 获取强教师权重；仓库不附带或自动下载教师权重。文件名不证明棋力。上游随机 Transformer 测试网仅用于验证执行路径，不能用作强教师。

计算使用 `NNEvaluator + AsyncBot + Search`，不是简化的 JS MCTS。FP32 为默认精度；研究界面不提供未经逐模型验证的 FP16 开关。WebGPU 失败时拒绝生成数据，不静默切换 CPU。显存、浏览器内存和 GPU 驱动决定能否加载大型网络；本项目不保证每台电脑能运行当前最大的教师。

## 规则与局面历史

分析固定采用 **Tromp–Taylor**：面积计分、全局同形禁着、允许多子自杀、无贴还子。原 SGF 的 RU 原样保存，但不会自动改变引擎规则，界面明确提示。支持 SGF 变化树、AB/AW/AE、压缩摆子范围、PL、HA、停一手和转义属性。多棋谱集合、非 9/13/19 棋盘、非法着手会明确报错。

摆子是局面初始化，不伪装成普通着手。中途摆子和手工编辑建立新的历史起点并记录原因；此前的劫争历史不能从纯棋盘恢复。完整 SGF 文本、节点路径、初始摆子、后续着手、当前棋盘、贴目和行棋方都保存。开始搜索前比较 C++ 重放棋盘与界面棋盘，不一致则拒绝生成数据。

## 渐进采样与收敛

引擎约每 80ms 接收一次分析回调，只在实际 root visits 达到几何阈值时生成完整 JSON。默认从 64 Visits 开始，每次乘 1.5；阈值不是精确停止点，因此保存**实际** Visits，不冒充 64/96/144 的精确预算。快照通过队列交给 Worker，不用重复轮询帧伪造样本。Ownership 每个采样重新计算，不采用演示版缓存。

默认至少 1024 Visits，最近 4 个独立采样同时满足：最佳着一致、PV 前 3 手一致、窗口白胜率范围 ≤0.005、领先范围 ≤0.5 目、相对窗口末端的候选 edge-visits 分布 TV ≤0.035，以及任一点 Ownership 的窗口范围 ≤0.025。可调整所有阈值；可关闭自动停止以观察后续反转。

保存稳定窗口起点和检测时 Visits、首次观察稳定结果、停止原因、真实最终 Visits、耗时和全部轨迹。稳定窗口起点是估计区间下界，检测点才是获得该证据时的计算量。**稳定不证明结论正确**，也不是统计置信保证；多次运行、不同教师、不同阈值仍可能给出不同结果。时间/Visits 用尽和手动停止不自动视作稳定。最终快照在停止线程后获取，不用最后一次缓存帧冒充最终状态。

## 教师数据内容

每条 `katago-teacher/1.0` JSON 独立包含：

| 字段 | 内容 |
|---|---|
| teacher | 模型内置名称、文件名、SHA-256、字节数、版本、GPU 信息、后端、精度 |
| engine | 固定上游提交、研究 ABI、部署 WASM/JS 哈希 |
| position / sourceSGF | 初始摆子、历史着手、最终棋盘、行棋方、贴目、规则、SGF 原文与路径、局面哈希 |
| settings | 预算、线程、采样、PV、Ownership 选项和全部收敛阈值 |
| rawNN | 搜索前合法性掩码 Policy、胜/负/无结果概率、ScoreMean、Lead、Ownership |
| snapshots | 原始 KataGo 分析 JSON，加未剪枝 root visits、精确 W/L/no-result、采样时间和参数 |
| result | 实际停止原因、实际 Visits、耗时、收敛观察 |
| derived | edgeVisits 归一化目标；排除对称别名，温度为 1 |
| unavailable | 明确列出的未导出教师内部信息 |

原生快照保留全部已展开根候选（不截取前 8 个），包括 child visits / edge visits / weights、prior、utility、winrate、scoreLead、scoreSelfplay、scoreStdev、noResultValue、LCB、utilityLCB、playSelectionValue、排序、对称别名、每个候选 PV / PV visits / PV edge visits、根与可选候选 Ownership / 标准差，以及原始网络不确定性和 root 哈希。未展开动作仍在完整 Policy 向量中；没有虚构未搜索候选的价值。

统一使用**白棋视角**。Policy 为原始网络先验，非法为 -1，末项是 pass；搜索改进后的策略另存为 edgeVisits 分布。分析 JSON 的 winrate 是 `(1 + winLossValue)/2`（无结果半权重），不等于精确 `P(win)`；`rootValue` 和 `rawNN.value` 保留精确胜/负/无结果概率。`scoreSelfplay` 才是网络/搜索均分，`scoreLead` 是领先估计。Ownership +1 白、-1 黑，按左上到右下行优先排列。LCB 与 utilityLCB 不能混用。

没有导出所有中间激活、完整搜索树、原始多策略头 logits / Q 张量、完整分数直方图或每次 playout 时间。所有可用字段原样保存，不将缺失信息填零。本格式是通用研究教师数据，**不是可直接喂给 KataGo 自训练管线的 NPZ**；未来需按学生模型的特征编码、规则与损失转换。子变化 Ownership 体积和开销较大；默认开启，可按实验关闭并保留配置。

## 开发、编译、测试与部署

前端零 npm 运行依赖。Node.js 22 + Python 3；引擎编译使用 Linux、Eigen3、Emscripten 6.0.1（emdawnwebgpu）。

```sh
npm test
git clone --depth 1 https://github.com/emscripten-core/emsdk.git "$HOME/emsdk"
"$HOME/emsdk/emsdk" install 6.0.1
"$HOME/emsdk/emsdk" activate 6.0.1
# Ubuntu: sudo apt-get install libeigen3-dev
bash scripts/build-engine.sh
npm run build
npm run serve
# http://localhost:8000
```

构建脚本拉取固定提交，并通过 `scripts/patch-engine.py` 应用研究 ABI。已修补目录不能重复修补；重新编译请使用干净的上游固定提交。`upstream/` 和生成的 `site/engine/` 不提交 Git，只部署静态产物。`site/engine/manifest.json` 校验部署引擎哈希。

GitHub Pages 设置选择 **GitHub Actions**。推送 main 自动运行测试、编译 WASM、校验文件并部署 `site/`。GitHub 只托管静态文件，编译依赖从网络下载；运行中 SGF、模型和数据不离开本机。

本地单元测试覆盖 SGF 变化与摆子、捕获/禁着、自杀、坐标、非法棋谱、收敛窗口、对称候选去重和预算校验。真实 WebGPU 端到端验证另行记录，不能把单元测试视为大型教师加载/棋力验证。

## 数据持久性

IndexedDB 每个快照事务保存完整记录；页面意外关闭留下 `running` 记录，显示为未完成/中断，不误标完成。内存不足/存储配额失败时界面明确提示下载。导出需要自己备份；清理站点数据、无痕窗口退出或浏览器驱逐可能丢失本地数据库。模型只在本次页面/Worker 中存储，刷新需重新选择。大型数据集建议分批下载，并在外部按 ID、模型哈希、局面哈希管理。

## 许可

本项目采用 MIT；KataGo 与 KataGo-WebGPU 的原始许可见 `THIRD_PARTY_LICENSE.txt`。参考 [上游 README](https://github.com/saigo-online/katago-webgpu/blob/d5ad1c0423dba989c60a2f06b1848e7eec2b5941/README.md)、[KataGo analysis 格式](https://github.com/lightvector/KataGo/blob/master/docs/Analysis_Engine.md)。
