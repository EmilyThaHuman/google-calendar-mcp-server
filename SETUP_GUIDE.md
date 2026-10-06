# Google Calendar MCP Server - Setup Guide

## Quick Setup (5 minutes)

### 1. Google Cloud Setup

1. **Go to Google Cloud Console**
   - Visit: https://console.cloud.google.com/

2. **Create/Select Project**
   - Create a new project or select existing one
   - Note the project name

3. **Enable Calendar API**
   - Navigate to "APIs & Services" → "Library"
   - Search for "Google Calendar API"
   - Click "Enable"

4. **Create OAuth Credentials**
   - Go to "APIs & Services" → "Credentials"
   - Click "Create Credentials" → "OAuth client ID"
   - Choose "Web application"
   - Add redirect URI:
     - Development: `http://localhost:3002/oauth/callback`
     - Production: `https://your-domain.workers.dev/oauth/callback`
   - Click "Create"
   - **Copy Client ID and Client Secret** (you'll need these!)

### 2. Local Setup

```bash
# Clone/Navigate to directory
cd google-calendar-mcp-server

# Copy environment template
cp env.example .env

# Edit .env with your credentials
nano .env
```

Add your credentials to `.env`:

```env
# Server Configuration
PORT=3002
NODE_ENV=development

# Google OAuth Configuration (REQUIRED)
GOOGLE_CLIENT_ID=your_actual_client_id_here
GOOGLE_CLIENT_SECRET=your_actual_client_secret_here
GOOGLE_REDIRECT_URI=http://localhost:3002/oauth/callback

# Frontend URL
FRONTEND_URL=http://localhost:5173

# MCP Server Configuration
MCP_SERVER_NAME=google-calendar-mcp-server
MCP_SERVER_VERSION=1.0.0
```

### 3. Install and Run

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

Or use the quick start script:

```bash
chmod +x quick-start.sh
./quick-start.sh
```

### 4. Verify Installation

Open your browser and check:

- Health Check: http://localhost:3002/health

You should see:
```json
{
  "status": "healthy",
  "server": "google-calendar-mcp-server",
  "version": "1.0.0",
  "timestamp": "2024-01-15T10:00:00.000Z"
}
```

## Integration with ZeroTwo

### Frontend (ZeroTwo)

1. **Update OAuth Provider**

Edit `ZeroTwo/src/services/oauthProviders.js`:

```javascript
google_calendar: {
  provider: "google_calendar",
  clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID,
  flowType: OAuthFlowType.GOOGLE_GIS,
  scopes: [
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/calendar.events",
  ],
  backendExchangeEndpoint: "/api/auth/google-calendar/callback",
  backendRefreshEndpoint: "/api/auth/google-calendar/refresh",
  mcpEnabled: true,
  mcpEndpoint: "http://localhost:3002/mcp",
},
```

2. **Add Environment Variable**

Add to `ZeroTwo/.env`:

```env
VITE_GOOGLE_CALENDAR_MCP_URL=http://localhost:3002
```

### Backend (ZeroTwoApi)

1. **Update OAuth Routes**

The `/api/auth/google-calendar/callback` and `/api/auth/google-calendar/refresh` routes should now sync tokens to the MCP server.

See `INTEGRATION.md` for detailed code examples.

2. **Add Environment Variable**

Add to `ZeroTwoApi/.env`:

```env
GOOGLE_CALENDAR_MCP_URL=http://localhost:3002
```

3. **Create MCP Integration**

After OAuth success, create entry in `mcp_integrations` table:

```sql
INSERT INTO mcp_integrations (
  user_id,
  name,
  provider,
  endpoint,
  mcp_type,
  connection_status,
  auth_type
) VALUES (
  $1, -- user_id
  'Google Calendar',
  'google_calendar',
  'http://localhost:3002/mcp',
  'remote_mcp',
  'connected',
  'oauth'
);
```

## Testing the Integration

### 1. Start All Services

```bash
# Terminal 1 - MCP Server
cd google-calendar-mcp-server
npm run dev

# Terminal 2 - Backend
cd ZeroTwoApi
npm run dev

# Terminal 3 - Frontend
cd ZeroTwo
npm run dev
```

### 2. Test OAuth Flow

1. Open browser: http://localhost:5173
2. Login to your account
3. Go to Settings → Integrations
4. Click "Connect Google Calendar"
5. Complete Google OAuth flow
6. Should redirect back with success message

### 3. Test Calendar Operations

In the AI chat, try:

```
"Show my calendar events for today"
"List all my calendars"
"Create a meeting tomorrow at 2pm titled 'Team Sync'"
```

## Production Deployment

### Option 1: Cloudflare Workers

```bash
# Install Wrangler CLI
npm install -g wrangler

# Login to Cloudflare
wrangler login

# Update wrangler.toml with your account details

# Set secrets
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET

# Deploy
npm run deploy
```

### Option 2: Docker

```bash
# Build image
docker build -t google-calendar-mcp-server .

# Run container
docker run -p 3002:3002 \
  -e GOOGLE_CLIENT_ID=your_client_id \
  -e GOOGLE_CLIENT_SECRET=your_client_secret \
  -e GOOGLE_REDIRECT_URI=https://your-domain.com/oauth/callback \
  -e FRONTEND_URL=https://app.zerotwo.ai \
  google-calendar-mcp-server
```

### Option 3: Node.js Server

```bash
# Build
npm run build

# Set production environment variables
export NODE_ENV=production
export GOOGLE_CLIENT_ID=your_client_id
export GOOGLE_CLIENT_SECRET=your_client_secret
export GOOGLE_REDIRECT_URI=https://your-domain.com/oauth/callback
export FRONTEND_URL=https://app.zerotwo.ai

# Start
npm start
```

### Update Production URLs

Update redirect URI in Google Cloud Console:
- Add: `https://your-domain.com/oauth/callback`

Update environment variables:
```env
# ZeroTwoApi production
GOOGLE_CALENDAR_MCP_URL=https://google-calendar-mcp-server.your-domain.com

# ZeroTwo production
VITE_GOOGLE_CALENDAR_MCP_URL=https://google-calendar-mcp-server.your-domain.com
```

## Troubleshooting

### "Missing required environment variables"

**Problem**: Server won't start

**Solution**: 
1. Check `.env` file exists
2. Verify `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set
3. Make sure values are not still the placeholder text

### OAuth redirect fails

**Problem**: After Google auth, redirect doesn't work

**Solution**:
1. Check redirect URI in Google Cloud Console matches exactly
2. Verify `GOOGLE_REDIRECT_URI` in `.env`
3. Make sure port 3002 is not in use

### "Authentication required" errors

**Problem**: Calendar tools return auth errors

**Solution**:
1. Complete OAuth flow first
2. Check tokens are stored in user profile
3. Verify MCP integration is created in database
4. Check token hasn't expired (refresh if needed)

### Port already in use

**Problem**: Can't start server on port 3002

**Solution**:
```bash
# Find process using port
lsof -i :3002

# Kill process
kill -9 <PID>

# Or change port in .env
PORT=3003
```

## Support

- **Documentation**: See README.md and INTEGRATION.md
- **Issues**: Check server logs and error messages
- **Google API**: Check quotas in Google Cloud Console
- **OAuth**: Verify redirect URIs and scopes

## Next Steps

1. ✅ Complete setup
2. ✅ Test OAuth flow
3. ✅ Test Calendar operations
4. 📝 Review INTEGRATION.md for detailed integration
5. 🚀 Deploy to production
6. 📊 Monitor logs and usage
7. 🔒 Implement rate limiting (production)
8. 🎨 Customize for your needs

## Security Checklist

For production deployment:

- [ ] Use HTTPS for all endpoints
- [ ] Store tokens securely (database with encryption)
- [ ] Implement rate limiting
- [ ] Set up proper CORS origins
- [ ] Use secure session management
- [ ] Enable logging and monitoring
- [ ] Set up alerts for errors
- [ ] Regular security audits
- [ ] Keep dependencies updated
- [ ] Use environment-specific configs

## Performance Tips

- Use connection pooling for database
- Implement caching for frequently accessed data
- Set up CDN for static assets
- Monitor API quota usage
- Implement request batching where possible
- Use compression for responses

---

Need help? Check the full documentation in README.md and INTEGRATION.md







