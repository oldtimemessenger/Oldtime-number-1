import { createSHA256 } from "hash-wasm";

self.onmessage = async event => {
  try {
    const file = event.data;
    if (!(file instanceof Blob) || !file.size) throw new Error("The media file could not be verified.");
    const digest = await createSHA256();
    digest.init();
    const chunkSize = 8 * 1024 * 1024;
    for (let offset = 0; offset < file.size; offset += chunkSize) {
      digest.update(new Uint8Array(await file.slice(offset, offset + chunkSize).arrayBuffer()));
    }
    self.postMessage({ sha256: digest.digest("hex") });
  } catch (error) {
    self.postMessage({ error: error?.message || "The media file could not be verified." });
  }
};
