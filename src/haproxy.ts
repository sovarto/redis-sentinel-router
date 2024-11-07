import { spawn } from 'child_process';
import { promises as dns } from 'dns';
import * as fs from 'fs';
import * as net from 'net';
import { ServerInstance } from './common';
import { clusters } from './env';

export interface BackendServerInstance extends ServerInstance {
    state: string;
}

// Constants for retry configuration
const MAX_RETRIES = 5; // Maximum number of retry attempts
const INITIAL_DELAY_MS = 2000; // Initial delay in milliseconds

/**
 * Sends a command to HAProxy with retry logic.
 * @param command The command string to send.
 * @returns A promise that resolves with the HAProxy response.
 */
export function sendCommandToHAProxy(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
        let attempt = 0; // Current attempt count
        let delay = INITIAL_DELAY_MS; // Current delay before next retry

        /**
         * Attempts to send the command to HAProxy.
         */
        const trySend = () => {
            const client = net.createConnection({ host: '127.0.0.1', port: 9999 }, () => {
                client.write(command + '\n');
            });

            let response = '';

            client.on('data', (data) => {
                response += data.toString();
            });

            client.on('end', () => {
                client.end();
                resolve(response);
            });

            client.on('error', (err) => {
                console.error(`Attempt ${ attempt
                                          + 1 }: Error communicating with HAProxy socket: ${ err.message }`);
                client.destroy(); // Ensure the connection is closed

                if (attempt < MAX_RETRIES) {
                    attempt++;
                    console.log(`Retrying in ${ delay } ms... (Attempt ${ attempt
                                                                          + 1 } of ${ MAX_RETRIES
                                                                                      + 1 })`);
                    setTimeout(() => {
                        delay *= 2; // Exponentially increase the delay
                        trySend();
                    }, delay);
                } else {
                    reject(new Error(`Failed after ${ MAX_RETRIES
                                                      + 1 } attempts: ${ err.message }`));
                }
            });
        };

        // Start the first attempt
        trySend();
    });
}


export function generateHAProxyConfig() {
    let haproxyConfig = fs.readFileSync('/haproxy.cfg', 'utf-8');

    for (const { name, port } of clusters) {
        haproxyConfig += `

frontend ${ name }_frontend
    bind *:${ port }
    default_backend ${ name }_backend

backend ${ name }_backend
    mode tcp
`;
    }

    fs.writeFileSync('/etc/haproxy/haproxy.cfg', haproxyConfig);
    console.log('Generated HAProxy configuration file at /etc/haproxy/haproxy.cfg');
}

export function startHAProxy() {
    const haproxyProcess = spawn('haproxy',
        [ '-f', '/etc/haproxy/haproxy.cfg' ],
        { stdio: 'inherit' });

    haproxyProcess.on('close', (code) => {
        console.log(`HAProxy process exited with code ${ code }`);
        process.exit(code || 0);
    });

    // Handle termination signals
    process.on('SIGTERM', () => {
        console.log('Received SIGTERM, stopping HAProxy...');
        haproxyProcess.kill('SIGTERM');
        process.exit(0);
    });

    console.log('HAProxy started!');
    return haproxyProcess;
}

function mapState(stateNumber: string) {
    switch(stateNumber) {
        case '0': return 'maint';
        case '1': return 'drain';
        case '2': return 'ready';
        default: {
            console.warn(`Received unknown backend server state number '${stateNumber}'`);
            return 'unknown';
        }
    }
}

export async function getBackendServers(name: string) {
    const showServersCmd = `show servers state ${ name }_backend`;
    const existingServersOutput = await sendCommandToHAProxy(showServersCmd);
    const existingServers: BackendServerInstance[] = existingServersOutput.split('\n').slice(2)
                                                                   .filter(x => x.length > 0)
                                                                   .map(x => x.split(' '))
                                                                   .map(x => ({
                                                                       host: x[3],
                                                                       port: parseInt(x[18]),
                                                                       state: mapState(x[5])
                                                                   }));

    return existingServers;
}

export async function addServerToBackend(name: string, server: ServerInstance) {
    let ips: string[] = [];
    try {
        ips = await dns.resolve(server.host);
        if (!ips.length) {
            throw new Error('No IP address found');
        }
    } catch (e) {
        console.error(`Couldn't get IP address of '${ server.host }'`, e);

        throw e;
    }
    const cmd = `add server ${ name }_backend/${ server.host } ${ ips[0] }:${ server.port }`;
    await sendCommandToHAProxy(cmd);
    console.log(`Added server '${ server.host }:${ server.port }' to backend '${ name }_backend'`);
}

export async function removeServerFromBackend(name: string, serverName: string) {
    const cmd = `del server ${ name }_backend/${ serverName }`;
    await sendCommandToHAProxy(cmd);
    console.log(`Removed server ${ serverName } from backend ${ name }_backend`);
}

export async function setServerState(backendName: string,
                                     serverName: string,
                                     state: 'ready' | 'drain' | 'maint') {
    const cmd = `set server ${ backendName }_backend/${ serverName } state ${ state }`;
    await sendCommandToHAProxy(cmd);
    console.log(`Set server ${ serverName } in backend ${ backendName }_backend to '${ state }'`);
}

export async function shutdownSessions(backendName: string, serverName: string) {
    const cmd = `shutdown sessions server ${ backendName }_backend/${ serverName }`;
    await sendCommandToHAProxy(cmd);
    console.log(`Shut down existing sessions to server '${ serverName }' in backend '${ backendName }_backend'`);
}

