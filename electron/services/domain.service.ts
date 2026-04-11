/**
 * DomainService manages local domains, hosts file entries, and Apache virtual hosts.
 */

import fs from 'fs';
import path from 'path';
import electron from 'electron';
import type { ServiceResult, ServiceState } from '../../src/types';
import type { DomainInput, DomainOperationResult, DomainRecord } from '../../src/types/domain.types';
import type { PhpVersion } from '../../src/types/php.types';
import { ConfigStore } from '../utils/config.store';

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

export interface DomainServiceOptions {
  hostsFilePath?: string;
  apacheVhostConfigPath?: string;
  storage?: DomainStorage;
}

interface NormalizedDomainInput {
  hostname: string;
  projectPath: string;
  phpVersion: string | null;
  phpPort: number | null;
}

export class DomainService {
  private processBridge: DomainProcessBridge;
  private phpBridge: DomainPhpBridge;
  private hostsFilePath: string;
  private apacheVhostConfigPath: string;
  private storage: DomainStorage;

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
      const restartNote = await this.applyDomainChanges(nextDomains);

      return {
        success: true,
        message: this.appendRestartNote(`Domain ${domain.hostname} created successfully`, restartNote),
        domain,
      };
    } catch (error) {
      const message = this.getErrorMessage(error);
      this.log('error', `Failed to create domain: ${message}`);
      return { success: false, message: 'Failed to create domain', error: message };
    }
  }

  async updateDomain(id: string, input: DomainInput): Promise<DomainOperationResult> {
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
      const restartNote = await this.applyDomainChanges(sorted);

      return {
        success: true,
        message: this.appendRestartNote(`Domain ${updated.hostname} updated successfully`, restartNote),
        domain: updated,
      };
    } catch (error) {
      const message = this.getErrorMessage(error);
      this.log('error', `Failed to update domain: ${message}`);
      return { success: false, message: 'Failed to update domain', error: message };
    }
  }

  async deleteDomain(id: string): Promise<DomainOperationResult> {
    try {
      const domains = this.getDomains();
      const existing = domains.find((domain) => domain.id === id);
      if (!existing) {
        return { success: false, message: 'Domain not found', error: 'NOT_FOUND' };
      }

      const nextDomains = domains.filter((domain) => domain.id !== id);
      const restartNote = await this.applyDomainChanges(nextDomains);

      return {
        success: true,
        message: this.appendRestartNote(`Domain ${existing.hostname} deleted successfully`, restartNote),
      };
    } catch (error) {
      const message = this.getErrorMessage(error);
      this.log('error', `Failed to delete domain: ${message}`);
      return { success: false, message: 'Failed to delete domain', error: message };
    }
  }

  private getDomains(): DomainRecord[] {
    return this.sortDomains([...this.storage.getDomains()]);
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

    if (!hostname.includes('.')) {
      throw new Error('Hostname must contain at least one dot (example: "myapp.test")');
    }

    if (hostname.startsWith('.') || hostname.endsWith('.') || hostname.includes('..')) {
      throw new Error('Hostname format is invalid');
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

  private async applyDomainChanges(domains: DomainRecord[]): Promise<string | null> {
    this.writeHostsFile(domains);
    this.writeApacheVhostConfig(domains);
    this.storage.setDomains(domains);
    return this.restartApacheIfNeeded();
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

      const withoutManagedBlock = this.removeManagedHostsBlock(existingContent).trimEnd();
      const managedEntries = domains.map((domain) => `127.0.0.1 ${domain.hostname}`);

      let nextContent = withoutManagedBlock;
      if (managedEntries.length > 0) {
        const block = [HOSTS_BLOCK_START, ...managedEntries, HOSTS_BLOCK_END].join('\r\n');
        nextContent = nextContent ? `${nextContent}\r\n\r\n${block}\r\n` : `${block}\r\n`;
      } else if (nextContent) {
        nextContent = `${nextContent}\r\n`;
      }

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

  private async restartApacheIfNeeded(): Promise<string | null> {
    const apacheStatus = this.processBridge.getServiceStatus('apache');
    if (apacheStatus.status !== 'running') {
      return null;
    }

    this.log('system', 'Domain configuration changed. Restarting Apache...');
    const restartResult = await this.processBridge.restartService('apache');
    if (restartResult.success) {
      this.log('success', 'Apache restarted to apply domain changes');
      return 'Apache restarted';
    }

    const detail = restartResult.error ?? restartResult.message;
    this.log('warning', `Apache restart failed after domain update: ${detail}`);
    return `Apache restart failed (${detail})`;
  }

  private appendRestartNote(message: string, restartNote: string | null): string {
    if (!restartNote) return message;
    return `${message}. ${restartNote}.`;
  }

  private sortDomains(domains: DomainRecord[]): DomainRecord[] {
    return [...domains].sort((a, b) => a.hostname.localeCompare(b.hostname));
  }

  private toApachePath(value: string): string {
    return value.replace(/\\/g, '/');
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
