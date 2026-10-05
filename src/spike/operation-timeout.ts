export const stdioOperationTimeoutMs = 10 * 60 * 1000;

export async function withOperationTimeout<T>(
  operation: Promise<T>,
  label: string,
  timeoutMs = stdioOperationTimeoutMs,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`OPERATION_TIMEOUT: ${label}`)), timeoutMs);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
