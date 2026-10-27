/**
 * Node --import preload for obsidian-hybrid-search.
 *
 * @huggingface/transformers defaults to https://huggingface.co/ and does NOT
 * honor HF_ENDPOINT. In regions where huggingface.co is unreachable, local
 * Xenova embeddings fail with "fetch failed". Point remoteHost at HF_ENDPOINT
 * (e.g. https://hf-mirror.com) before OHS loads the embedder.
 *
 * OHS also overwrites ``env.cacheDir`` to ``~/.cache/huggingface`` after import.
 * When TRANSFORMERS_CACHE / HF_HOME is set, keep that path via a getter/setter.
 */
let env = null;
try {
  ({ env } = await import("@huggingface/transformers"));
} catch {
  // transformers.js 未安装或残缺时跳过 HF_ENDPOINT 镜像设置。
  // OHS 0.13.x 使用 onnxruntime-node，不依赖 transformers.js，不影响核心功能。
}

if (env) {
  function normalizeHost(raw) {
    const s = String(raw || "").trim();
    if (!s) return "";
    return s.endsWith("/") ? s : `${s}/`;
  }

  const host = normalizeHost(process.env.HF_ENDPOINT || process.env.HF_MIRROR || "");
  if (host) {
    env.remoteHost = host;
  }

  const preferredCache = process.env.TRANSFORMERS_CACHE || process.env.HF_HOME || "";
  let cacheDir = preferredCache || env.cacheDir;
  if (preferredCache) {
    Object.defineProperty(env, "cacheDir", {
      configurable: true,
      enumerable: true,
      get() {
        return cacheDir;
      },
      set(value) {
        // Keep GoGo runtime cache; ignore OHS hardcoded ~/.cache/huggingface.
        cacheDir = preferredCache || value;
      },
    });
    env.useFSCache = true;
  }

  env.allowRemoteModels = true;
}
