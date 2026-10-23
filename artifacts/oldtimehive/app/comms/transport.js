export function selectedIceTransport(stats) {
  if (!stats || typeof stats.get !== "function" || typeof stats.values !== "function") {
    return "unknown";
  }

  let selectedPair;
  for (const report of stats.values()) {
    if (report.type === "transport" && report.selectedCandidatePairId) {
      selectedPair = stats.get(report.selectedCandidatePairId);
      if (selectedPair) break;
    }
  }
  selectedPair ||= [...stats.values()].find(report =>
    report.type === "candidate-pair" &&
    report.state === "succeeded" &&
    (report.selected || report.nominated)
  );
  if (!selectedPair) return "unknown";

  const local = stats.get(selectedPair.localCandidateId);
  const remote = stats.get(selectedPair.remoteCandidateId);
  if (!local || !remote) return "unknown";
  return local.candidateType === "relay" || remote.candidateType === "relay"
    ? "relay"
    : "direct";
}
