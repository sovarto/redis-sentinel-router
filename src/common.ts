export interface ServerInstance {
    host: string;
    port: number;
};

export function sleep(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)) };