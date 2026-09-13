"""Apply the research ABI to the pinned, pristine KataGo-WebGPU checkout."""
from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
p = root / 'upstream/cpp/kataeval/kataeval.cpp'
s = p.read_text()
if 'kgrConfigure' in s:
    raise SystemExit('Already patched; use a pristine pinned checkout')
s = s.replace('static void buildBoardHist(', 'static std::vector<int> researchSetup;\nstatic int researchInitialPla = 1;\nstatic void buildBoardHist(', 1)
start = s.index('  // Real Go handicap is ALWAYS')
end = s.index('\n}\n', start)
s = s[:start] + '''  if(researchSetup.size() == (size_t)(gXLen*gYLen))
    for(int i = 0; i < gXLen*gYLen; i++) {
      if(researchSetup[i] < 0 || researchSetup[i] > 2) throw StringError("Invalid setup stone");
      if(researchSetup[i]) board.setStone(toLoc(i), (Color)researchSetup[i]);
    }
  hist = BoardHistory(board, (Player)researchInitialPla, rules, 0);
  for(int i = 0; i < numMoves; i++) {
    if(moveLocs[i] < -1 || moveLocs[i] >= gXLen*gYLen || (moveCols[i] != 1 && moveCols[i] != 2))
      throw StringError("Invalid move encoding");
    Loc loc = toLoc(moveLocs[i]);
    Player pla = (Player)moveCols[i];
    if(!hist.isLegal(board, loc, pla)) throw StringError("Illegal move at index " + std::to_string(i));
    hist.makeBoardMoveAssumeLegal(board, loc, pla, NULL);
  }''' + s[end:]
# Each dataset record starts from a fresh search tree. Within a record there is ONE search.
s = s.replace('if(gBot->getSearch()->getRootNode() != NULL && common == gBotLine.size())', 'if(false)')
s = s.replace('"kge-search"', '"kgr-research-v1"')
s = s.replace('static void analyzeCb(const Search* s) noexcept { writeSnapshot(s); }', '''static std::mutex researchMutex;
static std::vector<nlohmann::json> researchFrames;
static std::string researchError;
static int researchFirst = 64, researchPV = 64;
static double researchGrowth = 1.5;
static int64_t researchNext = 64;
static bool researchMovesOwnership = true;
static std::chrono::steady_clock::time_point researchStarted;
static void researchSnapshot(const Search* s, bool force) noexcept {
  try {
    ReportedSearchValues v;
    if(!s->getRootValues(v) || v.visits < 1 || (!force && v.visits < researchNext)) return;
    nlohmann::json j;
    if(!s->getAnalysisJson(P_WHITE, researchPV, false, true, true, true,
                          researchMovesOwnership, researchMovesOwnership, true, true, j)) return;
    j["actualRootVisits"] = v.visits;
    j["rootValue"] = {{"whiteWin",v.winValue},{"whiteLoss",v.lossValue},{"noResult",v.noResultValue},
      {"utility",v.utility},{"scoreMean",v.expectedScore},{"scoreLead",v.lead},{"scoreStdev",v.expectedScoreStdev}};
    j["ownershipAtVisits"] = v.visits;
    j["snapshotConsistency"] = force ? "stopped-tree" : "live-tree-non-atomic";
    j["engineElapsedMs"] = std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-researchStarted).count();
    j["nnRowsProcessed"] = gNNEval->numRowsProcessed();
    j["nnBatchesProcessed"] = gNNEval->numBatchesProcessed();
    std::vector<AnalysisData> extra;
    s->getAnalysisData(extra, 0, false, researchPV, true);
    for(auto& m : j["moveInfos"]) for(const auto& a : extra)
      if(m["move"] == Location::toString(a.move, s->rootBoard)) {
        m["trainingStatsWhite"] = {{"ess",a.ess},{"radius",a.radius},{"weightFactor",a.weightFactor},
          {"weightSqSum",a.weightSqSum},{"utilitySqAvg",a.utilitySqAvg},{"scoreMeanSqAvg",a.scoreMeanSqAvg},
          {"resultUtility",a.resultUtility},{"scoreUtility",a.scoreUtility},{"winLossValue",a.winLossValue}};
        break;
      }
    j["searchParams"] = s->searchParams.changeableParametersToJson();
    std::ostringstream params; s->searchParams.printParams(params); j["searchParamsText"] = params.str();
    j["perspective"] = "white";
    j["forcedFinal"] = force;
    researchNext = std::max(v.visits + 1, (int64_t)std::ceil(v.visits * researchGrowth));
    std::lock_guard<std::mutex> lock(researchMutex); researchFrames.push_back(std::move(j)); researchError.clear();
  } catch(const std::exception& e) {
    std::lock_guard<std::mutex> lock(researchMutex); researchError = e.what();
  } catch(...) { std::lock_guard<std::mutex> lock(researchMutex); researchError = "Snapshot failed"; }
}
static void analyzeCb(const Search* s) noexcept { researchSnapshot(s, false); }
KATAEVAL_EXPORT int kgrConfigure(const int* stones, int initialPla, int first, double growth, int pv, int moveOwnership) {
  stopPonder();
  if(gNNEval) {
    delete gBot;
    gBot = new AsyncBot(SearchParams::basicDecentParams(), gNNEval, NULL, &kgeLogger(), "kgr-research-v1");
    gBot->setAlwaysIncludeOwnerMap(true);
    gNNEval->clearStats();
    gNNEval->clearCache();
  }
  researchStarted = std::chrono::steady_clock::now();
  researchSetup.assign(stones, stones + gXLen*gYLen); researchInitialPla = initialPla;
  researchFirst = std::max(1, first); researchNext = researchFirst;
  researchGrowth = std::max(1.1, growth); researchPV = std::max(1, std::min(256, pv));
  researchMovesOwnership = moveOwnership != 0;
  std::lock_guard<std::mutex> lock(researchMutex); researchFrames.clear(); researchError.clear(); return 1;
}
KATAEVAL_EXPORT const char* kgrPoll() {
  static std::string copy;
  std::lock_guard<std::mutex> lock(researchMutex);
  nlohmann::json j; j["frames"] = researchFrames; researchFrames.clear();
  j["done"] = gSearchDone.load();
  if(!researchError.empty()) j["snapshotError"] = researchError;
  copy = j.dump(); return copy.c_str();
}
KATAEVAL_EXPORT int kgrFinish() {
  if(!gBot) return 0;
  stopPonder(); researchSnapshot(gBot->getSearch(), true); return 1;
}''')
s = s.replace('params.maxVisits = maxVisits; params.maxPlayouts = maxVisits;', '''params.maxVisits = maxVisits; params.maxPlayouts = maxVisits;
  params.chosenMoveTemperature = 0; params.chosenMoveTemperatureEarly = 0;
  params.rootNoiseEnabled = false; params.rootNumSymmetriesToSample = 1;''')
p.write_text(s)
b = root / 'upstream/scripts/build-eval.sh'
t = b.read_text().replace('EXPORTS="$EXPORTS,_kgeSearchKata', 'EXPORTS="$EXPORTS,_kgrConfigure,_kgrPoll,_kgrFinish,_kgeSearchKata')
# Optional demo-net bundling must not make an otherwise successful build fail.
t = t[:t.index('# Bundle the demo nets')]
b.write_text(t)
print('Research ABI patched')
