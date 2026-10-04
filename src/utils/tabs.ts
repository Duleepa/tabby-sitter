export async function retryTabMutation<T>(
  fn: () => Promise<T>
): Promise<T> {
  try {
    return await fn();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('user may be dragging a tab') || msg.includes('cannot be edited right now')) {
      await new Promise((r) => setTimeout(r, 300));
      return await fn();
    }
    throw e;
  }
}
