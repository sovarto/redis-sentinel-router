export interface Cluster {
    name: string;
    port: number;
}

const sentinelsForAllEnv = process.env.SENTINELS_FOR_ALL;
const sentinelsPerClusterEnv = process.env.SENTINELS_PER_CLUSTER;
if (!sentinelsForAllEnv && !sentinelsPerClusterEnv) {
    console.error(
        'SENTINELS_FOR_ALL environment variable or SENTINELS_PER_CLUSTER environment variable needs to be set');
    process.exit(1);
}
if (sentinelsForAllEnv && sentinelsPerClusterEnv) {
    console.error(
        'Only one of SENTINELS_FOR_ALL and SENTINELS_PER_CLUSTER environment variable is allowed to be set');
    process.exit(1);
}

const clustersEnv = process.env.CLUSTERS;
if (!clustersEnv) {
    console.error('CLUSTERS environment variable is not set');
    process.exit(1);
}
export const clusters = clustersEnv.split(',').map(x => x.split(':'))
                                   .map(([ name, port ]) => ({ name, port: parseInt(port) }));

let sentinels: Record<string, { host: string, port: number }[]>;
if (sentinelsForAllEnv) {
    const sentinelsForAll = getSentinels(sentinelsForAllEnv);
    sentinels = Object.fromEntries(clusters.map(x => ([ x.name, sentinelsForAll ])));
} else if (sentinelsPerClusterEnv) {// capybara::sent1:123,sent3:123;
    const sentinelsPerCluster = Object.fromEntries(sentinelsPerClusterEnv.split(';').map(x => {
        const parts = x.split('::');
        return [ parts[0], getSentinels(parts[1]) ];
    }));

    const missingSentinels = clusters.map(x => x.name).filter(x => !sentinelsPerCluster[x]);
    if (missingSentinels.length) {
        console.error(`Sentinel configuration missing for these clusters: ${ missingSentinels }`);
    }
    sentinels = sentinelsPerCluster;
}

export { sentinels };

export const debugLog = process.env.DEBUG_LOG?.toLowerCase() === 'true';

function getSentinels(input: string) {
    return input.split(',').map((item) => {
        const [ host, port ] = item.split(':');
        return { host, port: parseInt(port) };
    });
}
