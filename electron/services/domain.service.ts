/**
 * DomainService manages local domains, hosts file entries, and Apache virtual hosts.
 */

import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import electron from 'electron';
import type { ServiceResult, ServiceState } from '../../src/types';
import type { DomainInput, DomainOperationResult, DomainRecord } from '../../src/types/domain.types';
import type { PhpVersion } from '../../src/types/php.types';
import { ConfigStore } from '../utils/config.store';
import { assertExecutable } from '../utils/binary.util';

const HOSTS_BLOCK_START = '# DEVSTACK LOCAL DOMAINS START';
const HOSTS_BLOCK_END = '# DEVSTACK LOCAL DOMAINS END';
const DEVSTACK_VHOST_FILENAME = 'httpd-devstack-vhosts.conf';

interface DomainProcessBridge {
  broadcastLog(level: string, message: string): void;
  getServiceStatus(service: 'apache'): ServiceState;
  restartService(service: 'apache'): Promise<ServiceResult>;
}

interface DomainPhpBridge {
  getAvailableVersions(): Promise<PhpVersion[]>;
  ensurePhpCgiRunning(version: string): Promise<number>;
}

interface DomainStorage {
  getDomains: () => DomainRecord[];
  setDomains: (domains: DomainRecord[]) => void;
}

export interface ApacheConfigValidationContext {
  binaryPath: string;
  apacheDir: string;
  configPath: string;
}

type ApacheConfigValidator = (context: ApacheConfigValidationContext) => Promise<void>;

export interface DomainServiceOptions {
  hostsFilePath?: string;
  apacheVhostConfigPath?: string;
  storage?: DomainStorage;
  apacheConfigValidator?: ApacheConfigValidator;
}

interface NormalizedDomainInput {
  hostname: string;
  projectPath: string;
  phpVersion: string | null;
  phpPort: number | null;
}

interface DomainSnapshot {
  domains: DomainRecord[];
  hostsFileExisted: boolean;
  hostsManagedBlock: string | null;
  vhostFileExisted: boolean;
  vhostFileContent: string | null;
}

const DISALLOWED_HOSTNAMES = new Set(['localhost', '127.0.0.1']);
const DISALLOWED_PUBLIC_SUFFIXES = ['.com', '.net', '.org'];
const ALLOWED_LOCAL_SUFFIXES = ['.local', '.test'];
const APACHE_SYNTAX_CHECK_TIMEOUT_MS = 10000;

export class DomainService {
  private processBridge: DomainProcessBridge;
  private phpBridge: DomainPhpBridge;
  private hostsFilePath: string;
  private apacheVhostConfigPath: string;
  private storage: DomainStorage;
  private apacheConfigValidator: ApacheConfigValidator;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    processBridge: DomainProcessBridge,
    phpBridge: DomainPhpBridge,
    options?: DomainServiceOptions
  ) {
    this.processBridge = processBridge;
    this.phpBridge = phpBridge;
    this.hostsFilePath = this.resolveHostsFilePath(options?.hostsFilePath);
    this.apacheVhostConfigPath = this.resolveApacheVhostConfigPath(options?.apacheVhostConfigPath);
    this.storage = options?.storage ?? {
      getDomains: () => ConfigStore.getDomains(),
      setDomains: (domains) => ConfigStore.setDomains(domains),
    };
    this.apacheConfigValidator =
      options?.apacheConfigValidator ?? ((context) => this.defaultApacheConfigValidator(context));

    try {
      this.writeApacheVhostConfig(this.getDomains());
    } catch (error) {
      this.log('warning', `Failed to initialize vhost config: ${this.getErrorMessage(error)}`);
    }
  }

  async listDomains(): Promise<DomainRecord[]> {
    return this.getDomains();
  }

  async createDomain(input: DomainInput): Promise<DomainOperationResult> {
    return this.runWithWriteLock(async () => {
      try {
        const domains = this.getDomains();
        const normalized = await this.normalizeInput(input, domains);

        const now = new Date().toISOString();
        const domain: DomainRecord = {
          id: this.generateDomainId(),
          hostname: normalized.hostname,
          projectPath: normalized.projectPath,
          phpVersion: normalized.phpVersion,
          phpPort: normalized.phpPort,
          createdAt: now,
          updatedAt: now,
        };

        const nextDomains = this.sortDomains([...domains, domain]);
        await this.applyDomainChanges(nextDomains);

        return {
          success: true,
          message: `Domain ${domain.hostname} created successfully`,
          domain,
        };
      } catch (error) {
        const message = this.getErrorMessage(error);
        this.log('error', `Failed to create domain: ${message}`);
        return {
          success: false,
          message: 'Failed to create domain',
          error: message,
        };
      }
    });
  }

  async updateDomain(id: string, input: DomainInput): Promise<DomainOperationResult> {
    return this.runWithWriteLock(async () => {
      try {
        const domains = this.getDomains();
        const existingIndex = domains.findIndex((domain) => domain.id === id);
        if (existingIndex === -1) {
          return { success: false, message: 'Domain not found', error: 'NOT_FOUND' };
        }

        const normalized = await this.normalizeInput(input, domains, id);
        const current = domains[existingIndex];
        const updated: DomainRecord = {
          ...current,
          hostname: normalized.hostname,
          projectPath: normalized.projectPath,
          phpVersion: normalized.phpVersion,
          phpPort: normalized.phpPort,
          updatedAt: new Date().toISOString(),
        };

        const nextDomains = [...domains];
        nextDomains[existingIndex] = updated;
        const sorted = this.sortDomains(nextDomains);
        await this.applyDomainChanges(sorted);

        return {
          success: true,
          message: `Domain ${updated.hostname} updated successfully`,
          domain: updated,
        };
      } catch (error) {
        const message = this.getErrorMessage(error);
        this.log('error', `Failed to update domain: ${message}`);
        return {
          success: false,
          message: 'Failed to update domain',
          error: message,
        };
      }
    });
  }

  async deleteDomain(id: string): Promise<DomainOperationResult> {
    return this.runWithWriteLock(async () => {
      try {
        const domains = this.getDomains();
        const existing = domains.find((domain) => domain.id === id);
        if (!existing) {
          return { success: false, message: 'Domain not found', error: 'NOT_FOUND' };
        }

        const nextDomains = domains.filter((domain) => domain.id !== id);
        await this.applyDomainChanges(nextDomains);

        return {
          success: true,
          message: `Domain ${existing.hostname} deleted successfully`,
        };
      } catch (error) {
        const message = this.getErrorMessage(error);
        this.log('error', `Failed to delete domain: ${message}`);
        return {
          success: false,
          message: 'Failed to delete domain',
          error: message,
        };
      }
    });
  }

  private getDomains(): DomainRecord[] {
    return this.sortDomains([...this.storage.getDomains()]);
  }

  private runWithWriteLock<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.writeQueue.then(operation, operation);
    this.writeQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private async normalizeInput(
    input: DomainInput,
    existingDomains: DomainRecord[],
    editingDomainId?: string
  ): Promise<NormalizedDomainInput> {
    const hostname = this.normalizeHostname(input.hostname);
    this.assertHostnameIsUnique(hostname, existingDomains, editingDomainId);

    const projectPath = this.normalizeProjectPath(input.projectPath);
    const phpVersion = input.phpVersion?.trim() ? input.phpVersion.trim() : null;

    let phpPort: number | null = null;
    if (phpVersion) {
      phpPort = await this.resolvePhpVersionPort(phpVersion);
    }

    return {
      hostname,
      projectPath,
      phpVersion,
      phpPort,
    };
  }

  private normalizeHostname(rawHostname: string): string {
    const hostname = rawHostname.trim().toLowerCase();
    if (!hostname) {
      throw new Error('Hostname is required');
    }

    if (hostname.includes('://')) {
      throw new Error('Hostname must not include protocol (use "myapp.test", not "http://myapp.test")');
    }

    if (!/^[a-z0-9.-]+$/.test(hostname)) {
      throw new Error('Hostname contains invalid characters');
    }

    if (DISALLOWED_HOSTNAMES.has(hostname)) {
      throw new Error(`Hostname "${hostname}" is reserved and cannot be used`);
    }

    if (!hostname.includes('.')) {
      throw new Error('Hostname must contain at least one dot (example: "myapp.test")');
    }

    if (hostname.startsWith('.') || hostname.endsWith('.') || hostname.includes('..')) {
      throw new Error('Hostname format is invalid');
    }

    if (this.isIPv4Address(hostname)) {
      throw new Error('IP addresses are not valid hostnames for domains');
    }

    if (DISALLOWED_PUBLIC_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
      throw new Error(
        'Public domains (.com/.net/.org) are not allowed. Use local domains like .local, .test, or .dev.local'
      );
    }

    if (!ALLOWED_LOCAL_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
      throw new Error('Hostname must end with .local, .test, or .dev.local');
    }

    const labels = hostname.split('.');
    for (const label of labels) {
      if (!label) {
        throw new Error('Hostname format is invalid');
      }
      if (!/^[a-z0-9-]+$/.test(label)) {
        throw new Error('Hostname contains invalid label characters');
      }
      if (label.startsWith('-') || label.endsWith('-')) {
        throw new Error('Hostname labels cannot start or end with hyphens');
      }
    }

    return hostname;
  }

  private normalizeProjectPath(rawProjectPath: string): string {
    const trimmed = rawProjectPath.trim();
    if (!trimmed) {
      throw new Error('Project path is required');
    }

    if (trimmed.includes('"')) {
      throw new Error('Project path must not include quotation marks');
    }

    const resolvedPath = path.resolve(trimmed);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Project path does not exist: ${resolvedPath}`);
    }

    const stats = fs.statSync(resolvedPath);
    if (!stats.isDirectory()) {
      throw new Error(`Project path is not a directory: ${resolvedPath}`);
    }

    try {
      fs.accessSync(resolvedPath, fs.constants.R_OK);
    } catch {
      throw new Error(`Project path is not readable: ${resolvedPath}`);
    }

    return resolvedPath;
  }

  private assertHostnameIsUnique(
    hostname: string,
    domains: DomainRecord[],
    editingDomainId?: string
  ): void {
    const duplicate = domains.find(
      (domain) => domain.hostname.toLowerCase() === hostname && domain.id !== editingDomainId
    );

    if (duplicate) {
      throw new Error(`Hostname "${hostname}" is already configured`);
    }
  }

  private async resolvePhpVersionPort(version: string): Promise<number> {
    const versions = await this.phpBridge.getAvailableVersions();
    const matched = versions.find((item) => item.version === version);

    if (!matched || !matched.installed) {
      throw new Error(`PHP ${version} is not installed`);
    }

    return this.phpBridge.ensurePhpCgiRunning(version);
  }

  private async applyDomainChanges(domains: DomainRecord[]): Promise<void> {
    const snapshot = this.createSnapshot();

    try {
      this.writeHostsFile(domains);
      this.writeApacheVhostConfig(domains);
      this.storage.setDomains(domains);
      await this.validateAndRestartApacheIfNeeded();
    } catch (error) {
      const errorMessage = this.getErrorMessage(error);
      this.log('warning', `Apply failed; attempting rollback: ${errorMessage}`);

      try {
        this.rollbackSnapshot(snapshot);
        this.log('warning', 'Domain changes rolled back successfully');
      } catch (rollbackError) {
        const rollbackMessage = this.getErrorMessage(rollbackError);
        this.log('error', `Rollback failed: ${rollbackMessage}`);
        throw new Error(
          `${errorMessage}. Rollback failed: ${rollbackMessage}. Domain state may be inconsistent.`
        );
      }

      throw new Error(`${errorMessage}. All domain changes were rolled back.`);
    }
  }

  private writeHostsFile(domains: DomainRecord[]): void {
    try {
      const hostsDir = path.dirname(this.hostsFilePath);
      if (!fs.existsSync(hostsDir)) {
        fs.mkdirSync(hostsDir, { recursive: true });
      }

      const existingContent = fs.existsSync(this.hostsFilePath)
        ? fs.readFileSync(this.hostsFilePath, 'utf-8')
        : '';

      const managedBlock = this.renderManagedHostsBlock(domains);
      const nextContent = this.replaceManagedHostsBlock(existingContent, managedBlock);

      fs.writeFileSync(this.hostsFilePath, nextContent, 'utf-8');
      this.log('system', `Hosts file updated at ${this.hostsFilePath}`);
    } catch (error) {
      const message = this.getErrorMessage(error);
      if (this.isPermissionError(error)) {
        throw new Error(
          `Cannot update hosts file (${this.hostsFilePath}). Start DevStack as Administrator and try again.`
        );
      }
      throw new Error(`Failed to update hosts file: ${message}`);
    }
  }

  private removeManagedHostsBlock(content: string): string {
    const lines = content.split(/\r?\n/);
    const retained: string[] = [];
    let skipping = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === HOSTS_BLOCK_START) {
        skipping = true;
        continue;
      }
      if (trimmed === HOSTS_BLOCK_END) {
        skipping = false;
        continue;
      }
      if (!skipping) {
        retained.push(line);
      }
    }

    while (retained.length > 0 && retained[retained.length - 1].trim() === '') {
      retained.pop();
    }

    return retained.join('\r\n');
  }

  private extractManagedHostsBlock(content: string): string | null {
    const lines = content.split(/\r?\n/);
    const startIndex = lines.findIndex((line) => line.trim() === HOSTS_BLOCK_START);
    if (startIndex === -1) return null;

    const endIndex = lines.findIndex((line, index) => index > startIndex && line.trim() === HOSTS_BLOCK_END);
    if (endIndex === -1) return null;

    return lines.slice(startIndex, endIndex + 1).join('\r\n');
  }

  private replaceManagedHostsBlock(content: string, managedBlock: string | null): string {
    const withoutManagedBlock = this.removeManagedHostsBlock(content).trimEnd();

    if (!managedBlock) {
      return withoutManagedBlock ? `${withoutManagedBlock}\r\n` : '';
    }

    return withoutManagedBlock
      ? `${withoutManagedBlock}\r\n\r\n${managedBlock}\r\n`
      : `${managedBlock}\r\n`;
  }

  private renderManagedHostsBlock(domains: DomainRecord[]): string | null {
    if (domains.length === 0) {
      return null;
    }

    const managedEntries = domains.map((domain) => `127.0.0.1 ${domain.hostname}`);
    return [HOSTS_BLOCK_START, ...managedEntries, HOSTS_BLOCK_END].join('\r\n');
  }

  private writeApacheVhostConfig(domains: DomainRecord[]): void {
    const configDir = path.dirname(this.apacheVhostConfigPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    const content = this.renderApacheVhostConfig(domains);
    fs.writeFileSync(this.apacheVhostConfigPath, content, 'utf-8');
    this.log('system', `Apache vhost config written to ${this.apacheVhostConfigPath}`);
  }

  private renderApacheVhostConfig(domains: DomainRecord[]): string {
    const header = [
      '# Auto-generated by DevStack Local.',
      '# Manual edits may be overwritten.',
      `# Updated: ${new Date().toISOString()}`,
      '',
    ];

    if (domains.length === 0) {
      return `${header.join('\n')}# No domains configured.\n`;
    }

    const blocks = domains.map((domain) => this.renderVhostBlock(domain));
    return `${header.join('\n')}${blocks.join('\n\n')}\n`;
  }

  private renderVhostBlock(domain: DomainRecord): string {
    const projectPath = this.toApachePath(domain.projectPath);
    const logName = domain.hostname.replace(/[^a-z0-9.-]/gi, '_');

    const lines = [
      `<VirtualHost *:80>`,
      `    ServerName ${domain.hostname}`,
      `    DocumentRoot "${projectPath}"`,
      `    <Directory "${projectPath}">`,
      `        Options Indexes FollowSymLinks`,
      `        AllowOverride All`,
      `        Require all granted`,
      `    </Directory>`,
      `    ErrorLog "logs/devstack-${logName}-error.log"`,
      `    CustomLog "logs/devstack-${logName}-access.log" common`,
    ];

    if (domain.phpVersion && domain.phpPort) {
      lines.push(
        `    # PHP ${domain.phpVersion}`,
        `    <FilesMatch \\.php$>`,
        `        SetHandler "proxy:fcgi://127.0.0.1:${domain.phpPort}"`,
        `    </FilesMatch>`
      );
    }

    lines.push(`</VirtualHost>`);
    return lines.join('\n');
  }

  private async validateAndRestartApacheIfNeeded(): Promise<void> {
    const apacheStatus = this.processBridge.getServiceStatus('apache');
    if (apacheStatus.status !== 'running') {
      return;
    }

    await this.validateApacheConfigSyntax();

    this.log('system', 'Domain configuration changed. Restarting Apache...');
    const restartResult = await this.processBridge.restartService('apache');
    if (restartResult.success) {
      this.log('success', 'Apache restarted to apply domain changes');
      return;
    }

    const detail = restartResult.error ?? restartResult.message;
    throw new Error(`Apache restart failed after domain update: ${detail}`);
  }

  private async validateApacheConfigSyntax(): Promise<void> {
    const binaryPath = this.resolveApacheBinaryPath();
    if (!binaryPath) {
      throw new Error('Apache config syntax check failed: Apache binary (httpd.exe) not found');
    }

    assertExecutable(binaryPath, 'Apache');
    const apacheDir = path.dirname(path.dirname(binaryPath));
    const configPath = this.resolveActiveApacheConfigPath(apacheDir);

    try {
      await this.apacheConfigValidator({
        binaryPath,
        apacheDir,
        configPath,
      });
      this.log('success', 'Apache config syntax check passed');
    } catch (error) {
      throw new Error(`Apache config syntax check failed: ${this.getErrorMessage(error)}`);
    }
  }

  private defaultApacheConfigValidator(context: ApacheConfigValidationContext): Promise<void> {
    return new Promise((resolve, reject) => {
      execFile(
        context.binaryPath,
        ['-t', '-f', context.configPath],
        {
          cwd: context.apacheDir,
          windowsHide: true,
          timeout: APACHE_SYNTAX_CHECK_TIMEOUT_MS,
        },
        (error, stdout, stderr) => {
          const output = [stdout, stderr]
            .map((chunk) => chunk.trim())
            .filter((chunk) => chunk.length > 0)
            .join('\n');

          if (error) {
            reject(new Error(output || error.message));
            return;
          }

          resolve();
        }
      );
    });
  }

  private resolveApacheBinaryPath(): string | null {
    let appPath = process.cwd();
    try {
      appPath =
        (electron as unknown as { app?: { getAppPath?: () => string } }).app?.getAppPath?.() ??
        process.cwd();
    } catch {
      appPath = process.cwd();
    }

    const savedPath = ConfigStore.getBinaryPath('apache');
    if (savedPath) {
      const exe = path.join(savedPath, 'bin', 'httpd.exe');
      if (fs.existsSync(exe)) return exe;
    }

    const resourcePaths = [
      path.join(appPath, 'resources', 'binaries', 'apache', 'bin', 'httpd.exe'),
      path.join(process.cwd(), 'resources', 'binaries', 'apache', 'bin', 'httpd.exe'),
      'C:\\Apache24\\bin\\httpd.exe',
      'C:\\Apache\\bin\\httpd.exe',
      'C:\\devstack\\apache\\bin\\httpd.exe',
    ];

    for (const binaryPath of resourcePaths) {
      if (fs.existsSync(binaryPath)) return binaryPath;
    }

    return null;
  }

  private resolveActiveApacheConfigPath(apacheDir: string): string {
    const runtimePath = path.join(apacheDir, 'conf', 'httpd.devstack.conf');
    if (fs.existsSync(runtimePath)) {
      return runtimePath;
    }

    const defaultPath = path.join(apacheDir, 'conf', 'httpd.conf');
    if (fs.existsSync(defaultPath)) {
      return defaultPath;
    }

    throw new Error(`Apache config file not found in ${path.join(apacheDir, 'conf')}`);
  }

  private createSnapshot(): DomainSnapshot {
    const hostsFileExisted = fs.existsSync(this.hostsFilePath);
    const hostsContent = hostsFileExisted
      ? fs.readFileSync(this.hostsFilePath, 'utf-8')
      : '';

    const vhostFileExisted = fs.existsSync(this.apacheVhostConfigPath);
    const vhostFileContent = vhostFileExisted
      ? fs.readFileSync(this.apacheVhostConfigPath, 'utf-8')
      : null;

    return {
      domains: this.getDomains(),
      hostsFileExisted,
      hostsManagedBlock: this.extractManagedHostsBlock(hostsContent),
      vhostFileExisted,
      vhostFileContent,
    };
  }

  private rollbackSnapshot(snapshot: DomainSnapshot): void {
    this.storage.setDomains(snapshot.domains);
    this.rollbackHostsFile(snapshot);
    this.rollbackVhostFile(snapshot);
  }

  private rollbackHostsFile(snapshot: DomainSnapshot): void {
    const currentContent = fs.existsSync(this.hostsFilePath)
      ? fs.readFileSync(this.hostsFilePath, 'utf-8')
      : '';

    const restoredContent = this.replaceManagedHostsBlock(currentContent, snapshot.hostsManagedBlock);

    if (!snapshot.hostsFileExisted && restoredContent.trim() === '') {
      if (fs.existsSync(this.hostsFilePath)) {
        fs.unlinkSync(this.hostsFilePath);
      }
      return;
    }

    const hostsDir = path.dirname(this.hostsFilePath);
    if (!fs.existsSync(hostsDir)) {
      fs.mkdirSync(hostsDir, { recursive: true });
    }

    fs.writeFileSync(this.hostsFilePath, restoredContent, 'utf-8');
  }

  private rollbackVhostFile(snapshot: DomainSnapshot): void {
    if (!snapshot.vhostFileExisted) {
      if (fs.existsSync(this.apacheVhostConfigPath)) {
        fs.unlinkSync(this.apacheVhostConfigPath);
      }
      return;
    }

    const configDir = path.dirname(this.apacheVhostConfigPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    fs.writeFileSync(this.apacheVhostConfigPath, snapshot.vhostFileContent ?? '', 'utf-8');
  }

  private sortDomains(domains: DomainRecord[]): DomainRecord[] {
    return [...domains].sort((a, b) => a.hostname.localeCompare(b.hostname));
  }

  private toApachePath(value: string): string {
    return value.replace(/\\/g, '/');
  }

  private isIPv4Address(value: string): boolean {
    const segments = value.split('.');
    if (segments.length !== 4) {
      return false;
    }

    return segments.every((segment) => {
      if (!/^\d+$/.test(segment)) return false;
      const num = Number(segment);
      return num >= 0 && num <= 255;
    });
  }

  private resolveHostsFilePath(providedPath?: string): string {
    if (providedPath && providedPath.trim()) {
      return path.resolve(providedPath);
    }

    if (process.platform === 'win32') {
      return 'C:\\Windows\\System32\\drivers\\etc\\hosts';
    }

    return '/etc/hosts';
  }

  private resolveApacheVhostConfigPath(providedPath?: string): string {
    if (providedPath && providedPath.trim()) {
      return path.resolve(providedPath);
    }

    let appPath = process.cwd();
    try {
      appPath =
        (electron as unknown as { app?: { getAppPath?: () => string } }).app?.getAppPath?.() ??
        process.cwd();
    } catch {
      appPath = process.cwd();
    }

    const candidates: string[] = [];
    const savedApachePath = ConfigStore.getBinaryPath('apache');
    if (savedApachePath) {
      candidates.push(path.join(savedApachePath, 'conf', 'extra', DEVSTACK_VHOST_FILENAME));
    }

    candidates.push(
      path.join(appPath, 'resources', 'binaries', 'apache', 'conf', 'extra', DEVSTACK_VHOST_FILENAME),
      path.join(process.cwd(), 'resources', 'binaries', 'apache', 'conf', 'extra', DEVSTACK_VHOST_FILENAME),
      path.join('C:\\Apache24', 'conf', 'extra', DEVSTACK_VHOST_FILENAME),
      path.join('C:\\Apache', 'conf', 'extra', DEVSTACK_VHOST_FILENAME),
      path.join('C:\\devstack\\apache', 'conf', 'extra', DEVSTACK_VHOST_FILENAME)
    );

    for (const candidate of candidates) {
      if (fs.existsSync(path.dirname(candidate))) {
        return candidate;
      }
    }

    return candidates[0];
  }

  private generateDomainId(): string {
    return `domain-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  private log(level: string, message: string): void {
    this.processBridge.broadcastLog(level, `[domains] ${message}`);
  }

  private isPermissionError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const maybeError = error as NodeJS.ErrnoException;
    return maybeError.code === 'EACCES' || maybeError.code === 'EPERM';
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
