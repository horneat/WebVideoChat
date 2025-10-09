#!/bin/bash
echo "🚀 Starting Video Chat Tunnel..."
echo "📱 This will create: https://rutr.serveo.net"
echo "⏹️  Press Ctrl+C to stop"

while true; do
  echo "🔗 Establishing tunnel..."
  ssh -o ServerAliveInterval=60 -R rutr:80:localhost:3000 serveo.net
  echo "⚠️  Tunnel disconnected. Reconnecting in 5 seconds..."
  sleep 5
done
