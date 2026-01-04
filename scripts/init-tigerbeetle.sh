#!/bin/sh
# TigerBeetle Cluster Initialization Script
#
# This script formats the TigerBeetle data file on first startup.
# It checks if the data file exists, and if not, formats it with the
# cluster configuration specified in environment variables.
#
# Environment Variables:
#   TIGERBEETLE_CLUSTER_ID  - Cluster ID (default: 0)
#   TIGERBEETLE_REPLICA_COUNT - Number of replicas (default: 1)
#   TIGERBEETLE_DATA_DIR    - Data directory path (default: /data)
#
# Data File Naming Convention:
#   Format: {cluster_id}_{replica_id}.tigerbeetle
#   Example: 0_0.tigerbeetle (cluster 0, replica 0)
#
# Multi-Replica Production Setup (Future):
#   For production deployments with 3+ replicas:
#   - Each replica needs unique replica ID (0, 1, 2)
#   - All replicas must share same cluster ID
#   - Format command: tigerbeetle format --cluster=0 --replica=N --replica-count=3 /data/0_N.tigerbeetle
#   - Start command: tigerbeetle start --addresses=0.0.0.0:3000 --addresses=replica1:3000 --addresses=replica2:3000 /data/0_N.tigerbeetle
#
# Security Note:
#   TigerBeetle cluster ID is IMMUTABLE after initialization.
#   Changing cluster ID requires reformatting (DATA LOSS).

set -e

# Configuration with defaults
CLUSTER_ID=${TIGERBEETLE_CLUSTER_ID:-0}
REPLICA_ID=0  # Single-node deployment always uses replica 0
REPLICA_COUNT=${TIGERBEETLE_REPLICA_COUNT:-1}
DATA_DIR=${TIGERBEETLE_DATA_DIR:-/data}

# Data file path
DATA_FILE="${DATA_DIR}/${CLUSTER_ID}_${REPLICA_ID}.tigerbeetle"

# Check if data file already exists
if [ -f "$DATA_FILE" ]; then
    echo "TigerBeetle data file already exists: $DATA_FILE"
    echo "Skipping initialization (cluster already formatted)"
else
    echo "TigerBeetle data file not found: $DATA_FILE"
    echo "Formatting new cluster:"
    echo "  Cluster ID: $CLUSTER_ID"
    echo "  Replica ID: $REPLICA_ID"
    echo "  Replica Count: $REPLICA_COUNT"

    # Format the data file
    tigerbeetle format \
        --cluster="$CLUSTER_ID" \
        --replica="$REPLICA_ID" \
        --replica-count="$REPLICA_COUNT" \
        "$DATA_FILE"

    echo "TigerBeetle cluster formatted successfully"
fi

# Start TigerBeetle server
echo "Starting TigerBeetle server on 0.0.0.0:3000"
exec tigerbeetle start --addresses=0.0.0.0:3000 "$DATA_FILE"
