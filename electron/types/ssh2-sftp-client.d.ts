declare module 'ssh2-sftp-client' {
  interface SftpConnectionOptions {
    host: string;
    port?: number;
    username: string;
    password?: string;
    readyTimeout?: number;
  }

  interface SftpListItem {
    type: string;
    name: string;
    size: number;
    modifyTime?: number;
    accessTime?: number;
  }

  export default class SftpClient {
    constructor(name?: string);
    connect(options: SftpConnectionOptions): Promise<unknown>;
    list(remotePath: string): Promise<SftpListItem[]>;
    end(): Promise<void>;
  }
}
