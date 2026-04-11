/**
 * Generic retry utilities used by service startup and shutdown flows.
 */

export interface RetryOptions {
  attempts: number;
  delayMs: number;
}

/** Sleep helper for retry loops and polling flows. */
export async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Retry an async boolean check until it returns true, or attempts are exhausted.
 *
 * @param check - Async predicate to evaluate
 * @param options - Retry options (attempts and delay)
 * @returns true if the check succeeded within attempts, otherwise false
 */
export async function retryCheck(
  check: () => Promise<boolean>,
  options: RetryOptions
): Promise<boolean> {
  for (let attempt = 1; attempt <= options.attempts; attempt++) {
    if (await check()) {
      return true;
    }

    if (attempt < options.attempts) {
      await sleep(options.delayMs);
    }
  }

  return false;
}

/**
 * Retry an async boolean check and throw if it never succeeds.
 */
export async function retryOrThrow(
  check: () => Promise<boolean>,
  options: RetryOptions,
  failureMessage: string
): Promise<void> {
  const ok = await retryCheck(check, options);
  if (!ok) {
    throw new Error(failureMessage);
  }
}
