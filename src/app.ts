import { Mutex } from 'async-mutex';
import Redis from 'ioredis';
import { ServerInstance } from './common';
import { sentinels } from './env';
import {
    addServerToBackend,
    generateHAProxyConfig,
    getBackendServers,
    removeServerFromBackend,
    setServerState,
    shutdownSessions,
    startHAProxy
} from './haproxy';
import { getRedisClustersFromSentinel, SentinelClient } from './redis';

const mutex = new Mutex();

function hostMatcher(a: ServerInstance, b: ServerInstance) {
    return a.host === b.host && a.port === b.port;
}

async function updateServersInHAProxy(client: Redis) {
    const release = await mutex.acquire();
    try {
        const clusters = await getRedisClustersFromSentinel(client);
        for (const cluster of clusters) {
            const clusterServers = [ cluster.master, ...cluster.replicas ];
            const existingServers = await getBackendServers(cluster.name);

            const newServers = clusterServers.filter(x =>
                !existingServers.some(y => hostMatcher(x, y)));
            const removedServers = existingServers.filter(x =>
                !clusterServers.some(y => hostMatcher(x, y)));

            if (newServers.length) {
                console.log(`The following servers need to be added to HAProxy: ${
                    newServers.map(x => `${ x.host }:${ x.port }`).join(', ') }`);
            }
            if (removedServers.length) {
                console.log(`The following servers need to be removed from HAProxy: ${
                    removedServers.map(x => `${ x.host }:${ x.port }`).join(', ') }`);
            }


            for (const newServer of newServers) {
                await addServerToBackend(cluster.name, newServer);
            }

            for (const removedServer of removedServers) {
                await removeServerFromBackend(cluster.name, removedServer.host);
            }

            if (existingServers.filter(x => hostMatcher(x, cluster.master))[0]?.state !== 'ready') {
                await setServerState(cluster.name, cluster.master.host, 'ready');
            }

            for (const replica of cluster.replicas) {
                if (existingServers.filter(x => hostMatcher(x, replica))[0]?.state === 'ready') {
                    await setServerState(cluster.name, replica.host, 'maint');
                    await shutdownSessions(cluster.name, replica.host);
                }
            }
        }
    } finally {
        release(); // Always release the mutex
    }
}

async function slavesChanged(message: string, commandClient: Redis) {
    await updateServersInHAProxy(commandClient);
}

async function masterSwitched(message: string) {
    const [ cluster, oldMasterHost, _, newMasterHost ] = message.split(' ');
    console.log(`Master of cluster '${ cluster }' switched from '${ oldMasterHost }' to '${ newMasterHost }'`);
    await setServerState(cluster, newMasterHost, 'ready');
    await setServerState(cluster, oldMasterHost, 'maint');
    await shutdownSessions(cluster, oldMasterHost);
}

async function main() {
    generateHAProxyConfig();
    startHAProxy();
    await new Promise(resolve => setTimeout(resolve, 1000));

    const sentinelClient = new SentinelClient(sentinels);
    sentinelClient.connect(
        commandClient => updateServersInHAProxy(commandClient),
        {
            '+switch-master': masterSwitched,
            '+slave': slavesChanged,
            '-slave': slavesChanged
        }
    );
}

main().catch((err) => {
    console.error('Error in main function:', err);
});
