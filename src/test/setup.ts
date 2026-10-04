// Minimal chrome stub so modules that touch chrome.* at import time can load.
const stub = {
  storage: {
    onChanged: { addListener: () => {} },
    local: { get: () => Promise.resolve({}), set: () => Promise.resolve() },
    session: { get: () => Promise.resolve({}), set: () => Promise.resolve() },
  },
};

(globalThis as unknown as { chrome: unknown }).chrome = stub;
