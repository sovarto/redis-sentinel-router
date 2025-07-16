[![Docker Pulls](https://img.shields.io/docker/pulls/sovarto/redis-sentinel-router.svg)](https://hub.docker.com/r/sovarto/redis-sentinel-router)

# Motivation

The default way to operate a Redis cluster with automatic failover is with the help of Sentinel. Sentinel monitors the instances of the cluster and if the primary goes down, it designates one of the replicas as the new primary and points all other replicas to this new primary. The clients that want to connect to such a cluster need to be able to connect to Sentinel to get notified of such a change in the primary.

Not all clients are able to do this, especially older clients don't understand Sentinel.

# Solution

The solution is a transparent proxy that routes the client connections to the current primary. This proxy - or router - is based on HAProxy and configures it based on the state of the Redis cluster as reported by Sentinel.

# Usage

The following environment variables are available:

|Name|Description|
|----|-----------|
|CLUSTERS|This router supports routing for multiple Redis clusters. Each Redis cluster gets its own port. This environment variable assigns a port to each cluster name. The cluster name has to be the same as in Sentinel. Syntax: `<cluster 1 name>:<port>,<cluster 2 name>:<port>` e.g. `events:10000,image-cache:10001`|
|SENTINELS_FOR_ALL|Setting this environment variable will make the router to look for info for all clusters in the same Sentinel cluster. Syntax: `<host 1>:<port>, <host 2>:<port>`, e.g. `redis-sentinel-1:26379,redis-sentinel-2:26379`|
|SENTINELS_PER_CLUSTER|Setting this environment variable will allow the router to connect to different Sentinel clusters, depending on the Redis cluster. Syntax: `<cluster 1 name>::<cluster 1 sentinel 1>:<port>,<cluster 1 sentinel 2>:<port>;<cluster 2 name>::<cluster 2 sentinel 1>:<port>,<cluster 2 sentinel 2>:<port>`, e.g. `events::events-sentinel-1:26379,events-sentinel-2:26379;image-cache::image-cache-sentinel-1:26379,image-cache-sentinel-2:26379`. For every cluster defined in `CLUSTERS` a Sentinel configuration must be specified in this variable|
|DEBUG_LOG| Set to `true` to enable verbose logging|

The environment variables `SENTINELS_FOR_ALL` and `SENTINELS_PER_CLUSTER` are mutually exclusive.