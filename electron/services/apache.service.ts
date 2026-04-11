/**
 * Apache service lifecycle manager.
 */

import path from 'path';
import fs from 'fs';
import electron from 'electron';
import type { ServiceState } from '../../src/types';
import { ConfigStore } from '../utils/config.store';
import { getPortConflictMessage, isPortAvailable } from '../utils/port.util';
import { retryOrThrow } from '../utils/retry.util';
import { isHttpResponsive } from '../utils/runtime.validation';
import type { ProcessManager } from './process.manager';

type LogEmitter = (level: string, message: string) => void;

const PROCESS_NAME = 'apache';
const STARTUP_RETRY_ATTEMPTS = 5;
const STARTUP_RETRY_DELAY_MS = 1000;
const DEVSTACK_VHOST_INCLUDE = 'Include conf/extra/httpd-devstack-vhosts.conf';
const DEVSTACK_VHOST_FILE = 'httpd-devstack-vhosts.conf';

export class ApacheService {
  private status: 'running' | 'stopped' | 'starting' | 'stopping' = 'stopped';
  private version = '2.4.62';
  private port = 80;
  private pid: number | undefined;
  private processManager: ProcessManager;
  private logEmitter: LogEmitter | null = null;

  constructor(pm: ProcessManager) {
    this.processManager = pm;
    this.port = ConfigStore.getPort('apache');
  }

  setLogEmitter(emitter: LogEmitter): void {
    this.logEmitter = emitter;
  }

  async start(version?: string, port?: number): Promise<void> {
    if (this.status === 'running' || this.status === 'starting') {
      throw new Error('Apache is already running');
    }

    this.status = 'starting';

    if (version) this.version = version;
    if (port) {
      this.port = port;
      ConfigStore.setPort('apache', port);
    }

    this.emitLog('system', 'Starting Apache Web Server...');

    const binaryPath = this.resolveBinaryPath();
    if (!binaryPath) {
      this.status = 'stopped';
      throw new Error(
        'Apache binary (httpd.exe) not found. Place Apache binaries in resources/binaries/apache/ or configure the path in settings.'
      );
    }

    this.emitLog('system', `Binary: ${binaryPath}`);

    const portAvailable = await isPortAvailable(this.port);
    if (!portAvailable) {
      this.status = 'stopped';
      const message = getPortConflictMessage(this.port, 'Apache');
      this.emitLog('error', message);
      throw new Error(message);
    }

    const apacheDir = path.dirname(path.dirname(binaryPath));
    const confPath = path.join(apacheDir, 'conf', 'httpd.conf');
    const args: string[] = [];

    if (fs.existsSync(confPath)) {
      const runtimeConfPath = this.prepareRuntimeConfig(apacheDir, confPath, this.port);
      args.push('-f', runtimeConfPath);
    } else {
      this.emitLog('warning', `Config not found at ${confPath}, using defaults`);
      args.push('-c', `Listen ${this.port}`);
    }

    try {
      const child = this.processManager.startProcess(
        PROCESS_NAME,
        binaryPath,
        args,
        {
          cwd: apacheDir,
          windowsHide: true,
        },
        true,
        { port: this.port, host: '127.0.0.1' }
      );

      this.pid = child.pid;

      await retryOrThrow(
        async () => {
          if (!this.processManager.isRunning(PROCESS_NAME)) {
            return false;
          }
          return isHttpResponsive(this.port, '127.0.0.1', '/', 1000);
        },
        {
          attempts: STARTUP_RETRY_ATTEMPTS,
          delayMs: STARTUP_RETRY_DELAY_MS,
        },
        `Apache failed runtime validation on http://localhost:${this.port}`
      );

      this.status = 'running';
      this.pid = this.processManager.getProcessPid(PROCESS_NAME);
      this.processManager.resetRestartAttempts(PROCESS_NAME);
      this.emitLog('success', `Apache started successfully (PID: ${this.pid})`);
      this.emitLog('success', `Apache responded on http://localhost:${this.port}`);
    } catch (error) {
      if (this.processManager.isRunning(PROCESS_NAME)) {
        await this.processManager.stopProcess(PROCESS_NAME);
      }
      this.status = 'stopped';
      this.pid = undefined;

      const message = error instanceof Error ? error.message : String(error);
      this.emitLog('error', `Apache startup failed: ${message}`);
      throw new Error(message);
    }
  }

  async stop(): Promise<void> {
    if (this.status === 'stopped') {
      throw new Error('Apache is not running');
    }

    this.status = 'stopping';
    this.emitLog('system', 'Stopping Apache Web Server...');

    const previousPid = this.pid;
    await this.processManager.stopProcess(PROCESS_NAME, 5000);

    this.status = 'stopped';
    this.pid = undefined;
    this.emitLog('success', `Apache stopped (PID: ${previousPid ?? 'unknown'})`);
  }

  async restart(): Promise<void> {
    this.emitLog('system', 'Restarting Apache...');
    if (this.status === 'running') {
      await this.stop();
    }
    await this.start();
  }

  getStatus(): ServiceState {
    if (this.status === 'running' && !this.processManager.isRunning(PROCESS_NAME)) {
      this.status = 'stopped';
      this.pid = undefined;
    }

    return {
      status: this.status,
      version: this.version,
      port: this.port,
      pid: this.status === 'running' ? this.pid : undefined,
    };
  }

  private resolveBinaryPath(): string | null {
    const appPath =
      (electron as unknown as { app?: { getAppPath?: () => string } }).app?.getAppPath?.() ??
      process.cwd();

    const savedPath = ConfigStore.getBinaryPath('apache');
    if (savedPath) {
      const exe = path.join(savedPath, 'bin', 'httpd.exe');
      if (fs.existsSync(exe)) return exe;
    }

    const resourcePaths = [
      path.join(appPath, 'resources', 'binaries', 'apache', 'bin', 'httpd.exe'),
      path.join(process.cwd(), 'resources', 'binaries', 'apache', 'bin', 'httpd.exe'),
    ];

    for (const binaryPath of resourcePaths) {
      if (fs.existsSync(binaryPath)) return binaryPath;
    }

    const commonPaths = [
      'C:\\Apache24\\bin\\httpd.exe',
      'C:\\Apache\\bin\\httpd.exe',
      'C:\\devstack\\apache\\bin\\httpd.exe',
    ];

    for (const binaryPath of commonPaths) {
      if (fs.existsSync(binaryPath)) return binaryPath;
    }

    return null;
  }

  private prepareRuntimeConfig(apacheDir: string, confPath: string, port: number): string {
    const runtimeConfPath = path.join(apacheDir, 'conf', 'httpd.devstack.conf');
    const serverRoot = apacheDir.replace(/\\/g, '/');
    const original = fs.readFileSync(confPath, 'utf-8');

    let patched = original.replace(
      /Define\s+SRVROOT\s+"[^"]*"/i,
      `Define SRVROOT "${serverRoot}"`
    );

    if (!/Define\s+SRVROOT\s+"[^"]*"/i.test(original)) {
      patched = `Define SRVROOT "${serverRoot}"\n${patched}`;
    }

    if (/^Listen\s+.+$/mi.test(patched)) {
      patched = patched.replace(/^Listen\s+.+$/mi, `Listen ${port}`);
    } else {
      patched += `\nListen ${port}\n`;
    }

    patched = this.ensureDirectiveEnabled(
      patched,
      'LoadModule proxy_module modules/mod_proxy.so'
    );
    patched = this.ensureDirectiveEnabled(
      patched,
      'LoadModule proxy_fcgi_module modules/mod_proxy_fcgi.so'
    );
    patched = this.ensureDirectiveEnabled(patched, DEVSTACK_VHOST_INCLUDE);

    this.ensureDevStackVhostConfig(apacheDir);

    fs.writeFileSync(runtimeConfPath, patched, 'utf-8');
    return runtimeConfPath;
  }

  private ensureDirectiveEnabled(config: string, directive: string): string {
    const escapedDirective = this.escapeRegExp(directive);
    const enabledRegex = new RegExp(`^\\s*${escapedDirective}\\s*$`, 'mi');
    if (enabledRegex.test(config)) {
      return config;
    }

    const commentedRegex = new RegExp(`^\\s*#\\s*${escapedDirective}\\s*$`, 'mi');
    if (commentedRegex.test(config)) {
      return config.replace(commentedRegex, directive);
    }

    return `${config.trimEnd()}\n${directive}\n`;
  }

  private ensureDevStackVhostConfig(apacheDir: string): void {
    const vhostPath = path.join(apacheDir, 'conf', 'extra', DEVSTACK_VHOST_FILE);
    if (fs.existsSync(vhostPath)) return;

    const content = [
      '# Auto-generated by DevStack Local.',
      '# Manual edits may be overwritten.',
      '# No domains configured.',
      '',
    ].join('\n');

    fs.writeFileSync(vhostPath, content, 'utf-8');
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private emitLog(level: string, message: string): void {
    this.processManager.broadcastLog(level, message);
    if (this.logEmitter) {
      this.logEmitter(level, message);
    }
  }
}
