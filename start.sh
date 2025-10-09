#!/bin/bash
echo "Starting Video Chat Server on port 3000..."

# Build and start with docker-compose
docker-compose down
docker-compose build --no-cache
docker-compose up -d

echo "Server should be running on http://localhost:3000"
echo "Health check: http://localhost:3000/health"
