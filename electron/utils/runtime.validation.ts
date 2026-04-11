/**
 * Runtime readiness probes for managed services.
 */

import http from 'http';

/**
 * Check whether an HTTP endpoint responds (any status code).
 */
export async function isHttpResponsive(
  port: number,
  host: string = '127.0.0.1',
  pathName: string = '/',
  timeoutMs: number = 1000
): Promise<boolean> {
  return new Promise((resolve) => {
    const request = http.get(
      {
        host,
        port,
        path: pathName,
        timeout: timeoutMs,
      },
      (response) => {
        response.resume();
        resolve(true);
      }
    );

    request.on('error', () => resolve(false));
    request.on('timeout', () => {
      request.destroy();
      resolve(false);
    });
  });
}
