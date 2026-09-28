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

运行时采样属于非原子 live-tree 观察（`snapshotConsistency`），各统计读取期间搜索仍可能推进；`ownershipAtVisits` 是本次采样开始时的 Visits。停止后的最终快照为 stopped-tree。多线程在途访问可能使最终 Visits 略超上限，例如 128 的预算实际产生 131 Visits；始终保存真实值。自动停止后重新检查最终快照，如果结论反转，标记 `stability-unconfirmed-at-stop`。另保存引擎耗时、NN rows / batches（含搜索前一次原始评估）；每条记录重建搜索对象并清空 NN 缓存，固定初始搜索种子 `kgr-research-v1`，但多线程执行不保证逐位可复现。

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

`npm run test:engine` 实际实例化编译后的 pthread WASM 并检查研究 ABI 和安全空状态；完整搜索需在浏览器 Worker 中验证（Node 的 Asyncify/pthreads 不适合实际搜索）。浏览器验证记录见 [TESTING.md](TESTING.md)。

## 数据持久性

IndexedDB 每个快照事务保存完整记录；页面意外关闭留下 `running` 记录，显示为未完成/中断，不误标完成。内存不足/存储配额失败时界面明确提示下载。导出需要自己备份；清理站点数据、无痕窗口退出或浏览器驱逐可能丢失本地数据库。模型只在本次页面/Worker 中存储，刷新需重新选择。大型数据集建议分批下载，并在外部按 ID、模型哈希、局面哈希管理。

## 许可

本项目采用 MIT；KataGo 与 KataGo-WebGPU 的原始许可见 `THIRD_PARTY_LICENSE.txt`。参考 [上游 README](https://github.com/saigo-online/katago-webgpu/blob/d5ad1c0423dba989c60a2f06b1848e7eec2b5941/README.md)、[KataGo analysis 格式](https://github.com/lightvector/KataGo/blob/master/docs/Analysis_Engine.md)。


## 2026-09-28：9 路多线程搜索修复

官方 `kata9x9-b18c384nbt-20231025` 在 1 线程正常、4 线程报 `Got nonfinite for policy sum` 的原因，是固定上游版本的 Winograd 权重缓存误用了临时 GPU 缓冲池。批次变化会覆盖持久权重。本项目补丁将这些权重移出缓冲池，保留正常多线程搜索；没有通过降低线程数或伪造输出规避错误。

该官方文件是 modelVersion 12 的嵌套瓶颈卷积网络（nbt），不是 Transformer。Search 与 NNEvaluator 的 9 路初始化经真实搜索验证；更换尺寸会销毁 Worker，重新加载模型。同一个权重文件可以再次选择加载。

异常面板和 Console 现在保留 message、stack（浏览器提供时）、原生 C++ 异常名称、嵌套 cause / ErrorEvent、调用阶段、模型 SHA-256、棋盘尺寸、搜索设置、WASM 内存和近期日志。失败记录也保留诊断。若浏览器跨线程事件不提供 stack，原生异常栈仍输出到 Console，不编造缺失信息。

硬件回归（可选，不在无 GPU 的 CI 中执行）：

```sh
npm install --prefix .tools/browser-test playwright-core --no-audit --no-fund
# 将官方权重保存到 .tools/models/kata9x9-b18c384nbt-20231025.bin.gz
node scripts/test-gpu.mjs
```

需已安装 Chrome；环境变量 `KATAGO_TEST_BROWSER=msedge` 可使用 Edge，`KATAGO_TEST_MODEL` 可指定文件。脚本使用隔离浏览器及 localhost，只读取本地权重，测试单线程→多线程→连续搜索→重新加载；核验 Visits、候选、Policy、Value、PV、Ownership 和真实批量推理。完整证据写入忽略的 `test-results/`。该 9 路权重 SHA-256 为 `a1298ce1adc1dad7bd868ca962b2384cc8388ed373a00e6bae1114fa6f9e2d61`。


如 GitHub Pages 页面显示旧版本，请查看顶栏环境徽章的修订标记。2026-09-28 的缓存一致性更新为“修订 b”：HTML、页面脚本、Worker 和引擎二进制使用同一版本参数，Service Worker 重新验证网络资源。`KATAGO_TEST_THREADS=8 node scripts/test-gpu.mjs` 可用官方权重验证 8 线程及重新加载。


## 整盘自动教师数据采集（修订 c）

导入一份 SGF、选好棋盘尺寸并加载本地教师权重后，在“整盘自动分析”设置**每局面 Visits 上限**、最长时间和搜索线程（1–64）。默认按 SGF **第一主线**分析初始局面及每一手棋后的局面。搜索达到 Visits 上限时，64 线程可能略微超出设定值；数据记录真实 Visits。最长时间是安全上限，若先到期该局面的 Visits 可能少于设定值。

推荐先点“选择输出文件夹”授权，再点“开始整盘分析”。Chrome/Edge 的[文件夹选择 API](https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker)要求用户主动选择并授权目录；网站无法自行指定任意磁盘路径。任务开始后不再需要逐步确认：在选定目录下新建一个 `katago-日期-编号` 子文件夹，每完成一个局面就写入 `position-0000.json` 等完整教师记录，同时更新 `run.json`；全部完成后流式生成 `dataset.jsonl`。中断或出错时已完成的局面文件仍保留。每条记录都含模型名称 / SHA-256、SGF、完整局面历史、搜索设置、原始 NN 输出、渐进快照、候选和 Ownership。

学校浏览器如果禁用文件夹授权，可选“完成后浏览器下载 JSONL”。它会在整盘完成时发起一次下载；落在哪个文件夹由浏览器下载设置决定，网站不能越过浏览器权限改写。文件夹模式也会尽力把已完成记录保存到浏览器 IndexedDB。运行期间保持页面打开、电脑不进入睡眠；网站会尝试请求屏幕保持唤醒，但操作系统或学校策略可能阻止。

棋盘候选标记现在同时显示名次和该候选当前 Edge Visits；下方表格显示精确数值。直播统计约每 150 毫秒更新，完整教师快照仍按原有渐进采样阈值保存，最终快照在搜索停止后生成。

64 线程需要 65 个浏览器线程（含 NN 服务线程），已在真实 9 路官方权重上验证。更多搜索线程可能增加 CPU 和内存负担，不能保证 GPU 利用率或每秒 Visits 一定上升；当前 NN 推理最大批次仍为 16。
