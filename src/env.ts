export interface Cluster {
    name: string;
    port: number;
}

const sentinelsEnv = process.env.SENTINELS;
if (!sentinelsEnv) {
    console.error('SENTINELS environment variable is not set');
    process.exit(1);
}

export const sentinels = sentinelsEnv.split(',').map((item) => {
    const [ host, port ] = item.split(':');
    return { host, port: parseInt(port) };
});

const clustersEnv = process.env.CLUSTERS;
if (!clustersEnv) {
    console.error('CLUSTERS environment variable is not set');
    process.exit(1);
}
export const clusters = clustersEnv.split(',').map(x => x.split(':'))
                                   .map(([ name, port ]) => ({ name, port: parseInt(port) }));
