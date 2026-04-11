/**
 * Port Utility — TCP port availability checking
 *
 * Provides reliable port-in-use detection for Windows.
 * Used by Apache, MySQL, and PHP-CGI services before starting.
 */

import net from 'net';

/**
 * Check if a TCP port is available for binding.
 * Creates a temporary server to test the port, then closes it.
 *
 * @param port - Port number to check
 * @param host - Host to bind (default: '127.0.0.1')
 * @returns true if the port is available, false if in use
 */
export function isPortAvailable(port: number, host: string = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
        resolve(false);
      } else {
        // Other errors — treat as unavailable to be safe
        resolve(false);
      }
    });

    server.once('listening', () => {
      server.close(() => resolve(true));
    });

    server.listen(port, host);
  });
}

/**
 * Check if a TCP port is actively listening.
 * Attempts to connect to the target host/port and resolves true on success.
 *
 * @param port - Port number to probe
 * @param host - Host to connect to (default: '127.0.0.1')
 * @param timeoutMs - Connection timeout in milliseconds (default: 1000)
 * @returns true if a listener accepts the connection, false otherwise
 */
export function isPortListening(
  port: number,
  host: string = '127.0.0.1',
  timeoutMs: number = 1000
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finalize = (result: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finalize(true));
    socket.once('timeout', () => finalize(false));
    socket.once('error', () => finalize(false));

    socket.connect(port, host);
  });
}

/**
 * Find the next available port starting from the given port.
 * Scans sequentially until a free port is found.
 *
 * @param startPort - Starting port number
 * @param host - Host to check (default: '127.0.0.1')
 * @param maxAttempts - Maximum ports to try (default: 100)
 * @returns The first available port, or throws if none found
 */
export async function findAvailablePort(
  startPort: number,
  host: string = '127.0.0.1',
  maxAttempts: number = 100
): Promise<number> {
  for (let i = 0; i < maxAttempts; i++) {
    const port = startPort + i;
    const available = await isPortAvailable(port, host);
    if (available) {
      return port;
    }
  }
  throw new Error(
    `No available port found in range ${startPort}-${startPort + maxAttempts - 1}`
  );
}

/**
 * Get a human-readable error message for port conflicts.
 */
export function getPortConflictMessage(port: number, serviceName: string): string {
  if (port === 80) {
    return `Port ${port} is already in use. Another web server (IIS, WAMP, XAMPP, Skype) may be using it. Try running DevStack as Administrator, or change the ${serviceName} port.`;
  }
  if (port === 3306) {
    return `Port ${port} is already in use. Another MySQL/MariaDB instance may be running. Stop it first or change the ${serviceName} port.`;
  }
  return `Port ${port} is already in use by another application. Change the ${serviceName} port or stop the conflicting service.`;
}
