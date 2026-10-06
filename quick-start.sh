#!/bin/bash

# Google Calendar MCP Server - Quick Start Script
# This script helps you quickly set up and start the Google Calendar MCP server

set -e

echo "🗓️  Google Calendar MCP Server - Quick Start"
echo "============================================="
echo ""

# Check if .env exists
if [ ! -f .env ]; then
  echo "📝 Creating .env file from template..."
  cp env.example .env
  echo "✅ .env file created"
  echo ""
  echo "⚠️  IMPORTANT: Please edit .env and add your Google OAuth credentials"
  echo "   - GOOGLE_CLIENT_ID"
  echo "   - GOOGLE_CLIENT_SECRET"
  echo ""
  echo "Press Enter to continue after updating .env, or Ctrl+C to exit..."
  read
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
  echo "📦 Installing dependencies..."
  npm install
  echo "✅ Dependencies installed"
  echo ""
fi

# Verify environment variables
echo "🔍 Checking environment variables..."

if ! grep -q "GOOGLE_CLIENT_ID=your_google_client_id_here" .env; then
  echo "✅ GOOGLE_CLIENT_ID is set"
else
  echo "❌ GOOGLE_CLIENT_ID not configured"
  echo "Please edit .env and add your Google Client ID"
  exit 1
fi

if ! grep -q "GOOGLE_CLIENT_SECRET=your_google_client_secret_here" .env; then
  echo "✅ GOOGLE_CLIENT_SECRET is set"
else
  echo "❌ GOOGLE_CLIENT_SECRET not configured"
  echo "Please edit .env and add your Google Client Secret"
  exit 1
fi

echo ""
echo "✅ Configuration looks good!"
echo ""
echo "🚀 Starting development server..."
echo ""
echo "Server will be available at:"
echo "  - Health Check: http://localhost:3002/health"
echo "  - MCP Endpoint: http://localhost:3002/mcp"
echo "  - OAuth Start: http://localhost:3002/oauth/authorize"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

# Start the dev server
npm run dev







