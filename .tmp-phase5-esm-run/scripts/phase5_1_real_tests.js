import fs from 'fs';
import path from 'path';
import { RemoteService } from '../electron/services/remote.service';
class MemoryStorage {
    constructor() {
        this.connections = [];
        this.secrets = [];
    }
    getConnections() {
        return [...this.connections];
    }
    setConnections(connections) {
        this.connections = [...connections];
    }
    getSensitiveSecrets() {
        return [...this.secrets];
    }
    setSensitiveSecrets(secrets) {
        this.secrets = [...secrets];
    }
}
class FakeCodec {
    isAvailable() {
        return true;
    }
    encrypt(value) {
        return Buffer.from(`secret:${value}`, 'utf-8').toString('base64');
    }
    decrypt(value) {
        const decoded = Buffer.from(value, 'base64').toString('utf-8');
        if (!decoded.startsWith('secret:')) {
            throw new Error('Invalid encoded secret');
        }
        return decoded.slice('secret:'.length);
    }
}
class FakeProcessBridge {
    constructor() {
        this.logs = [];
    }
    broadcastLog(level, message) {
        this.logs.push(`${level}:${message}`);
    }
}
class FakeTransportClient {
    constructor(behavior) {
        this.connectCalls = [];
        this.listCalls = [];
        this.disconnectCalls = 0;
        this.behavior = behavior;
    }
    async connect(connection, timeoutMs) {
        this.connectCalls.push({ connection, timeoutMs });
        if (this.behavior.connect) {
            await this.behavior.connect(connection, timeoutMs);
        }
    }
    async list(rootPath) {
        this.listCalls.push(rootPath);
        if (this.behavior.list) {
            return this.behavior.list(rootPath);
        }
        return [];
    }
    async disconnect() {
        this.disconnectCalls += 1;
        if (this.behavior.disconnect) {
            await this.behavior.disconnect();
        }
    }
}
const results = [];
function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}
async function runTest(name, fn) {
    try {
        const details = await fn();
        results.push({ name, success: true, details });
        console.log(`[PASS] ${name}: ${details}`);
    }
    catch (error) {
        const details = error instanceof Error ? error.message : String(error);
        results.push({ name, success: false, details });
        console.error(`[FAIL] ${name}: ${details}`);
    }
}
function createHarness(behaviors, connectTimeoutMs = 150) {
    const storage = new MemoryStorage();
    const bridge = new FakeProcessBridge();
    const clients = [];
    const service = new RemoteService(bridge, {
        storage,
        secretCodec: new FakeCodec(),
        connectTimeoutMs,
        transportClientFactory: () => {
            const behavior = behaviors.shift() ?? {};
            const client = new FakeTransportClient(behavior);
            clients.push(client);
            return client;
        },
    });
    return { service, storage, bridge, clients };
}
async function main() {
    const projectRoot = process.cwd();
    const outputPath = path.join(projectRoot, 'phase5_1_test_results.json');
    await runTest('Add, edit, connect, and delete connection', async () => {
        const listEntries = [
            { name: 'public_html', path: '/var/www/public_html', type: 'directory', size: null, modifiedAt: null },
            { name: 'deploy.log', path: '/var/www/deploy.log', type: 'file', size: 128, modifiedAt: null },
        ];
        const { service, clients } = createHarness([
            {
                list: async () => listEntries,
            },
        ]);
        const createResult = await service.createConnection({
            name: 'Primary SFTP',
            protocol: 'sftp',
            host: 'example.test',
            port: 22,
            username: 'deploy',
            password: 'super-secret',
            rootPath: '/var/www',
        });
        assert(createResult.success, createResult.error ?? createResult.message);
        assert(createResult.connection, 'Expected created connection summary');
        const connectionId = createResult.connection.id;
        const updateResult = await service.updateConnection(connectionId, {
            name: 'Primary SFTP',
            protocol: 'sftp',
            host: 'edited.example.test',
            port: 22,
            username: 'deploy',
            password: '',
            rootPath: '/var/www',
        });
        assert(updateResult.success, updateResult.error ?? updateResult.message);
        const connectResult = await service.connectConnection(connectionId);
        assert(connectResult.success, connectResult.error ?? connectResult.message);
        assert(connectResult.entries.length === 2, `Expected 2 root entries, got ${connectResult.entries.length}`);
        assert(clients.length === 1, `Expected one transport client, got ${clients.length}`);
        assert(clients[0].connectCalls[0]?.connection.password === 'super-secret', 'Expected stored password to be preserved across edit');
        const deleteResult = await service.deleteConnection(connectionId);
        assert(deleteResult.success, deleteResult.error ?? deleteResult.message);
        const listAfterDelete = await service.listConnections();
        assert(listAfterDelete.length === 0, `Expected 0 connections after delete, got ${listAfterDelete.length}`);
        return 'CRUD flow passed with preserved encrypted password';
    });
    await runTest('Validation rejects invalid connection input', async () => {
        const { service } = createHarness([]);
        const result = await service.createConnection({
            name: 'Bad Connection',
            protocol: 'sftp',
            host: 'http://bad-host',
            port: 0,
            username: '',
            password: 'secret',
            rootPath: '.',
        });
        assert(!result.success, 'Expected invalid connection input to fail');
        assert((result.error ?? '').includes('protocol prefix') || (result.error ?? '').includes('Port'), `Unexpected validation error: ${result.error ?? result.message}`);
        return result.error ?? result.message;
    });
    await runTest('Test connection loads root preview and closes ephemeral client', async () => {
        const { service, clients } = createHarness([
            {
                list: async (rootPath) => [
                    { name: 'app', path: `${rootPath}/app`, type: 'directory', size: null, modifiedAt: null },
                ],
            },
        ]);
        const result = await service.testConnection({
            name: 'Ephemeral FTP',
            protocol: 'ftp',
            host: 'legacy.example.test',
            port: 21,
            username: 'legacy',
            password: 'legacy-secret',
            rootPath: '/',
        });
        assert(result.success, result.error ?? result.message);
        assert(result.entries.length === 1, `Expected 1 preview entry, got ${result.entries.length}`);
        assert(clients.length === 1, `Expected one ephemeral client, got ${clients.length}`);
        assert(clients[0].disconnectCalls >= 1, 'Expected ephemeral client cleanup after test');
        return `Preview entries=${result.entries.length}, disconnectCalls=${clients[0].disconnectCalls}`;
    });
    await runTest('Timeout handling aborts connect and leaves connection in error state', async () => {
        const neverResolvingPromise = new Promise(() => undefined);
        const { service, clients } = createHarness([
            {
                connect: async () => neverResolvingPromise,
            },
        ], 100);
        const createResult = await service.createConnection({
            name: 'Timeout SFTP',
            protocol: 'sftp',
            host: 'timeout.example.test',
            port: 22,
            username: 'deploy',
            password: 'secret',
            rootPath: '/srv',
        });
        assert(createResult.success && createResult.connection, createResult.error ?? createResult.message);
        const connectResult = await service.connectConnection(createResult.connection.id);
        assert(!connectResult.success, 'Expected timed out connect to fail');
        assert((connectResult.error ?? '').toLowerCase().includes('timed out'), `Unexpected timeout error: ${connectResult.error ?? connectResult.message}`);
        assert(clients.length === 1, `Expected one timeout client, got ${clients.length}`);
        assert(clients[0].disconnectCalls >= 1, 'Expected timeout cleanup to trigger disconnect');
        const summaries = await service.listConnections();
        assert(summaries[0]?.status === 'error', `Expected error status, got ${summaries[0]?.status ?? 'none'}`);
        return connectResult.error ?? connectResult.message;
    });
    await runTest('Disconnect cleanup succeeds even when transport close throws', async () => {
        const { service } = createHarness([
            {
                list: async () => [
                    { name: 'logs', path: '/logs', type: 'directory', size: null, modifiedAt: null },
                ],
                disconnect: async () => {
                    throw new Error('Socket already closed');
                },
            },
        ]);
        const createResult = await service.createConnection({
            name: 'Cleanup FTP',
            protocol: 'ftp',
            host: 'cleanup.example.test',
            port: 21,
            username: 'ftp-user',
            password: 'cleanup-secret',
            rootPath: '/',
        });
        assert(createResult.success && createResult.connection, createResult.error ?? createResult.message);
        const connectResult = await service.connectConnection(createResult.connection.id);
        assert(connectResult.success, connectResult.error ?? connectResult.message);
        const disconnectResult = await service.disconnectConnection(createResult.connection.id);
        assert(disconnectResult.success, disconnectResult.error ?? disconnectResult.message);
        const summaries = await service.listConnections();
        assert(summaries[0]?.status === 'disconnected', `Expected disconnected status after cleanup, got ${summaries[0]?.status ?? 'none'}`);
        return disconnectResult.message;
    });
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf-8');
    console.log(`Saved Phase 5.1 test results to ${outputPath}`);
    const failedCount = results.filter((result) => !result.success).length;
    if (failedCount > 0) {
        throw new Error(`Phase 5.1 real tests failed (${failedCount} failed test(s))`);
    }
}
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
