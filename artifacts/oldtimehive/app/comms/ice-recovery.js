export async function createIceRestartOffer(pc) {
  const offer = await pc.createOffer({ iceRestart: true });
  await pc.setLocalDescription(offer);
  return pc.localDescription || offer;
}

export async function createIceRestartAnswer(pc, offer) {
  await pc.setRemoteDescription(offer);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  return pc.localDescription || answer;
}

