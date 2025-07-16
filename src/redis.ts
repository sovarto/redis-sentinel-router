import Redis from 'ioredis';
import { ServerInstance, sleep } from './common';
import { debugLog } from './env';

export class SentinelClient {
    commandClient: Redis | undefined;
    subscriptionClient: Redis | undefined;

    constructor(private instances: ServerInstance[]) {
    }

    connect(onCommandClientConnected: (client: Redis) => void,
            eventsToSubscribeTo: Record<string, (message: string, client: Redis) => void>) {
        this.internalConnect('command', 0, c => {
            this.commandClient = c;
            onCommandClientConnected(c);
        }, () => {
            this.commandClient = undefined;
        });
        this.internalConnect('subscription', 0, c => {
            this.subscriptionClient = c;
            c.subscribe(...Object.keys(eventsToSubscribeTo), (err, count) => {
                if (err) {
                    console.error(err.message);
                }
                console.log(`Subscribed to ${ count } channels.`);
            });

            c.on('message', (channel, message) => {
                if (!this.commandClient) {
                    console.error(`Received message from channel '${ channel }', but the command client is not initialized. Dropping message.`);
                    return;
                }

                const callback = eventsToSubscribeTo[channel];
                if (!callback) {
                    console.error(`Received message from channel '${ channel }', but the callback was provided. Dropping message.`);
                    return;
                }

                callback(message, this.commandClient);
            });
        }, () => {
            this.subscriptionClient = undefined;
        });
    }

    internalConnect(name: string,
                    currentInstanceIndex: number,
                    onConnectCallback: (client: Redis) => void,
                    onDisconnectCallback: () => void) {
        const instance = this.instances[currentInstanceIndex];

        console.log(`[${ name }] Trying to connect to redis sentinel '${ instance.host }:${ instance.port }'...`);

        const redisClient = new Redis({
            host: instance.host,
            port: instance.port,
            retryStrategy: () => null, // Disable automatic retries
        });

        let reconnecting = false;

        redisClient.on('connect', () => {
            console.log(`[${ name }] Connected to redis sentinel '${ instance.host }:${ instance.port }'`);
            onConnectCallback(redisClient);
        });

        redisClient.on('end', async () => {
            if (!reconnecting) {
                onDisconnectCallback();
                reconnecting = true;
                console.warn(`[${ name }] Connection to sentinel '${ instance.host }:${ instance.port }' ended.`);
                redisClient.removeAllListeners();
                await sleep(5000)
                this.internalConnect(name,
                    (currentInstanceIndex + 1) % this.instances.length,
                    onConnectCallback,
                    onDisconnectCallback);
            }
        });

        redisClient.on('error', (e) => {
            console.warn(`[${ name }] Connection to sentinel '${ instance.host }:${ instance.port }' had an error.`,
                e);
            redisClient.disconnect();
        });
    }
}

export interface ClusterInfo {
    name: string;
    master: ServerInstance;
    replicas: ServerInstance[];
}

export async function getRedisClustersFromSentinel(client: Redis, clusters: string[]) {
    const result: ClusterInfo[] = [];

    for (const name of clusters) {
        try {
            const masterResult = await client.call('sentinel',
                'get-master-addr-by-name',
                name) as string[];
            const replicasResult = sentinelResultToObjects(await client.call('sentinel',
                'replicas',
                name) as string[][]);

            if(debugLog) {
                console.debug(`Master of cluster '${name}':`, masterResult);
                console.debug(`Replicas of cluster '${name}': `, replicasResult)
            }

            const cluster = {
                name,
                master: { host: masterResult[0], port: parseInt(masterResult[1]) },
                replicas: replicasResult.filter(x => x.flags.indexOf('s_down') === -1)
                                        .map(x => ({ host: x.ip, port: parseInt(x.port) }))
            };

            result.push(cluster);
        } catch (e) {
            console.warn(`Couldn't get cluster info from sentinel for '${ name }'`, e);
        }
    }

    return result;
}

function sentinelResultToObjects(result: string[][]): { [k: string]: string }[] {
    return result.reduce<Record<string, string>[]>((acc, curr) => {
        const o: { [k: string]: string } = {};
        for (let i = 0; i < curr.length; i += 2) {
            o[curr[i]] = curr[i + 1];
        }
        acc.push(o);
        return acc;
    }, []);
}
