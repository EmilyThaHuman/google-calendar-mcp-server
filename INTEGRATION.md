# Google Calendar MCP Server - Integration Guide

This guide provides step-by-step instructions for integrating the Google Calendar MCP Server with your ZeroTwo application.

## Overview

The Google Calendar MCP Server consolidates all Google Calendar functionality into a single MCP server, replacing the previous backend-based approach. This provides:

- Unified OAuth flow management
- Automatic token refresh
- Direct Calendar API access
- MCP protocol support
- Better separation of concerns

## Integration Steps

### 1. Frontend Updates (ZeroTwo)

#### Update OAuth Provider Configuration

Update `ZeroTwo/src/services/oauthProviders.js`:

```javascript
// Update the google_calendar entry
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
  revokeEndpoint: "https://oauth2.googleapis.com/revoke",
  mcpEnabled: true,
  mcpEndpoint: "http://localhost:3002/mcp", // Update in production
  mcpSseEndpoint: "http://localhost:3002/sse", // For SSE events
},
```

#### Update Environment Variables

Add to `ZeroTwo/.env`:

```env
# Google Calendar MCP Server
VITE_GOOGLE_CALENDAR_MCP_URL=http://localhost:3002
```

For production:
```env
VITE_GOOGLE_CALENDAR_MCP_URL=https://google-calendar-mcp-server.YOUR-DOMAIN.workers.dev
```

### 2. Backend Updates (ZeroTwoApi)

#### Update OAuth Routes

Modify `ZeroTwoApi/routes/auth/google-calendar.js`:

```javascript
import { Router } from "express";
import { google } from "googleapis";
import logger from "@utils/logger.js";
import { config } from "@config/index.js";
import { createClient } from "@supabase/supabase-js";

const router = Router();
const supabase = createClient(
  config.app.env.SUPABASE_URL,
  config.app.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * POST /api/auth/google-calendar/callback
 * Exchange authorization code for tokens and store in user profile
 * Also sync tokens to MCP server
 */
router.post("/callback", async (req, res) => {
  try {
    const { code, userId } = req.body;

    if (!code) {
      return res.status(400).json({
        error: true,
        message: "Authorization code is required",
        timestamp: new Date().toISOString(),
      });
    }

    logger.info("[GoogleCalendarAuth] Processing OAuth callback", {
      codeLength: code.length,
      userId,
    });

    // Initialize OAuth2 client
    const oauth2Client = new google.auth.OAuth2(
      config.app.env.GOOGLE_CLIENT_ID,
      config.app.env.GOOGLE_CLIENT_SECRET,
      "postmessage" // Required for popup mode authorization code flow
    );

    // Exchange authorization code for tokens
    const { tokens } = await oauth2Client.getToken(code);

    logger.info("[GoogleCalendarAuth] Tokens received successfully");

    // Store tokens in user profile
    if (userId) {
      const { data: profile, error: fetchError } = await supabase
        .from("profiles")
        .select("settings")
        .eq("id", userId)
        .single();

      if (!fetchError && profile) {
        const expiresAt = tokens.expiry_date
          ? new Date(tokens.expiry_date)
          : new Date(Date.now() + 3600000);

        const updatedSettings = {
          ...profile.settings,
          oauth_tokens: {
            ...(profile.settings?.oauth_tokens || {}),
            google_calendar: {
              provider_token: tokens.access_token,
              provider_refresh_token: tokens.refresh_token,
              expires_at: expiresAt.toISOString(),
              token_type: tokens.token_type || "Bearer",
              scope: tokens.scope,
              stored_at: new Date().toISOString(),
            },
          },
        };

        await supabase
          .from("profiles")
          .update({
            settings: updatedSettings,
            updated_at: new Date().toISOString(),
          })
          .eq("id", userId);

        logger.info("[GoogleCalendarAuth] Tokens stored in user profile");

        // Sync tokens to MCP server
        try {
          const mcpResponse = await fetch(
            `${config.app.env.GOOGLE_CALENDAR_MCP_URL}/oauth/sync`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                userId,
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token,
                expiresIn: tokens.expiry_date
                  ? Math.floor((tokens.expiry_date - Date.now()) / 1000)
                  : 3600,
              }),
            }
          );

          if (mcpResponse.ok) {
            logger.info("[GoogleCalendarAuth] Tokens synced to MCP server");
          }
        } catch (syncError) {
          logger.warn("[GoogleCalendarAuth] Failed to sync to MCP server:", syncError);
          // Don't fail the request if MCP sync fails
        }
      }
    }

    // Return tokens to frontend for storage
    res.json({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expiry_date
        ? Math.floor((tokens.expiry_date - Date.now()) / 1000)
        : 3600,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("[GoogleCalendarAuth] Error processing OAuth callback:", {
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      error: true,
      message: error.message || "Failed to process OAuth callback",
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * POST /api/auth/google-calendar/refresh
 * Refresh Google Calendar access token using refresh token
 */
router.post("/refresh", async (req, res) => {
  try {
    const { refreshToken, userId } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        error: true,
        message: "Refresh token is required",
        timestamp: new Date().toISOString(),
      });
    }

    logger.info("[GoogleCalendarAuth] Refreshing access token");

    // Initialize OAuth2 client
    const oauth2Client = new google.auth.OAuth2(
      config.app.env.GOOGLE_CLIENT_ID,
      config.app.env.GOOGLE_CLIENT_SECRET,
      "postmessage"
    );

    // Set the refresh token
    oauth2Client.setCredentials({
      refresh_token: refreshToken,
    });

    // Refresh the access token
    const { credentials } = await oauth2Client.refreshAccessToken();

    logger.info("[GoogleCalendarAuth] Access token refreshed successfully");

    // Update tokens in user profile if userId provided
    if (userId) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("settings")
        .eq("id", userId)
        .single();

      if (profile) {
        const expiresAt = credentials.expiry_date
          ? new Date(credentials.expiry_date)
          : new Date(Date.now() + 3600000);

        const updatedSettings = {
          ...profile.settings,
          oauth_tokens: {
            ...(profile.settings?.oauth_tokens || {}),
            google_calendar: {
              ...profile.settings?.oauth_tokens?.google_calendar,
              provider_token: credentials.access_token,
              expires_at: expiresAt.toISOString(),
              stored_at: new Date().toISOString(),
            },
          },
        };

        await supabase
          .from("profiles")
          .update({
            settings: updatedSettings,
            updated_at: new Date().toISOString(),
          })
          .eq("id", userId);
      }

      // Sync to MCP server
      try {
        await fetch(`${config.app.env.GOOGLE_CALENDAR_MCP_URL}/oauth/sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId,
            accessToken: credentials.access_token,
            refreshToken: refreshToken,
            expiresIn: credentials.expiry_date
              ? Math.floor((credentials.expiry_date - Date.now()) / 1000)
              : 3600,
          }),
        });
      } catch (syncError) {
        logger.warn("[GoogleCalendarAuth] Failed to sync refresh to MCP server:", syncError);
      }
    }

    res.json({
      accessToken: credentials.access_token,
      refreshToken: refreshToken,
      expiresIn: credentials.expiry_date
        ? Math.floor((credentials.expiry_date - Date.now()) / 1000)
        : 3600,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("[GoogleCalendarAuth] Error refreshing token:", {
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      error: true,
      message: error.message || "Failed to refresh access token",
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
```

#### Remove Old Tool Routes

Remove or deprecate `ZeroTwoApi/routes/ai/tools/google-calendar.js` since all Calendar operations are now handled by the MCP server.

Add a deprecation notice if needed:

```javascript
// ZeroTwoApi/routes/ai/tools/google-calendar.js
import { Router } from "express";
const router = Router();

router.all("*", (req, res) => {
  res.status(410).json({
    error: true,
    message: "Google Calendar tools have been migrated to the MCP server",
    mcpEndpoint: process.env.GOOGLE_CALENDAR_MCP_URL,
    timestamp: new Date().toISOString(),
  });
});

export default router;
```

#### Update MCP Client Configuration

Update `ZeroTwoApi/lib/mcp-client.js` to support Google Calendar MCP:

```javascript
// Add Google Calendar MCP support
if (integration.provider === "google_calendar") {
  endpointUrl = process.env.GOOGLE_CALENDAR_MCP_URL + "/mcp";
  
  // Use OAuth token from profile
  if (integration.oauth_token) {
    transportOptions.headers = {
      Authorization: `Bearer ${integration.oauth_token}`,
      ...integration.headers,
    };
  }
}
```

### 3. Database Updates

#### Create MCP Integration Entry

After successful OAuth, create an MCP integration in the database:

```sql
-- Insert Google Calendar MCP integration
INSERT INTO mcp_integrations (
  user_id,
  name,
  provider,
  endpoint,
  mcp_type,
  connection_status,
  auth_type,
  description,
  additional_config
) VALUES (
  $1, -- user_id
  'Google Calendar',
  'google_calendar',
  'http://localhost:3002/mcp', -- Update for production
  'remote_mcp',
  'connected',
  'oauth',
  'Google Calendar integration via MCP',
  jsonb_build_object(
    'oauth_client_id', 'YOUR_GOOGLE_CLIENT_ID',
    'scopes', ARRAY[
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/calendar.events'
    ]
  )
);
```

This can be done automatically in the OAuth callback handler:

```javascript
// In ZeroTwoApi/routes/auth/google-calendar.js callback handler
const { data: existingIntegration } = await supabase
  .from("mcp_integrations")
  .select("id")
  .eq("user_id", userId)
  .eq("provider", "google_calendar")
  .single();

if (!existingIntegration) {
  await supabase.from("mcp_integrations").insert({
    user_id: userId,
    name: "Google Calendar",
    provider: "google_calendar",
    endpoint: config.app.env.GOOGLE_CALENDAR_MCP_URL + "/mcp",
    mcp_type: "remote_mcp",
    connection_status: "connected",
    auth_type: "oauth",
    description: "Google Calendar integration via MCP",
  });
}
```

### 4. Environment Variables

#### Development

Add to `ZeroTwoApi/.env`:

```env
# Google Calendar MCP Server
GOOGLE_CALENDAR_MCP_URL=http://localhost:3002
```

#### Production

```env
# Google Calendar MCP Server
GOOGLE_CALENDAR_MCP_URL=https://google-calendar-mcp-server.YOUR-DOMAIN.workers.dev
```

### 5. Testing the Integration

#### 1. Start the MCP Server

```bash
cd google-calendar-mcp-server
npm install
npm run dev
```

Server should start on `http://localhost:3002`

#### 2. Start Your Backend

```bash
cd ZeroTwoApi
npm run dev
```

#### 3. Start Your Frontend

```bash
cd ZeroTwo
npm run dev
```

#### 4. Test OAuth Flow

1. Navigate to Settings → Integrations
2. Click "Connect Google Calendar"
3. Complete OAuth flow
4. Verify tokens are stored in profile
5. Verify MCP integration is created

#### 5. Test Calendar Operations

Use the AI chat to test Calendar operations:

```
"List my calendar events for today"
"Create a meeting tomorrow at 2pm"
"Show my calendars"
```

### 6. Production Deployment

#### Deploy MCP Server to Cloudflare Workers

```bash
cd google-calendar-mcp-server

# Update wrangler.toml with your account details
# Set secrets
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET

# Deploy
npm run deploy
```

#### Update Production Environment Variables

Update your production environment:

```env
# ZeroTwoApi production .env
GOOGLE_CALENDAR_MCP_URL=https://google-calendar-mcp-server.YOUR-SUBDOMAIN.workers.dev

# ZeroTwo production .env
VITE_GOOGLE_CALENDAR_MCP_URL=https://google-calendar-mcp-server.YOUR-SUBDOMAIN.workers.dev
```

### 7. Migration from Old System

If migrating from the old backend-based approach:

1. **Keep old routes temporarily** for backward compatibility
2. **Add deprecation warnings** to old routes
3. **Update frontend** to use new MCP-based flow
4. **Migrate user tokens** to new format if needed
5. **Test thoroughly** before removing old routes
6. **Remove old routes** after successful migration

#### Migration Script Example

```javascript
// migration-script.js
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function migrateToMcp() {
  // Get all users with Google Calendar tokens
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, settings")
    .not("settings->oauth_tokens->google_calendar", "is", null);

  for (const profile of profiles) {
    // Check if MCP integration exists
    const { data: existing } = await supabase
      .from("mcp_integrations")
      .select("id")
      .eq("user_id", profile.id)
      .eq("provider", "google_calendar")
      .single();

    if (!existing) {
      // Create MCP integration
      await supabase.from("mcp_integrations").insert({
        user_id: profile.id,
        name: "Google Calendar",
        provider: "google_calendar",
        endpoint: MCP_SERVER_URL + "/mcp",
        mcp_type: "remote_mcp",
        connection_status: "connected",
        auth_type: "oauth",
        description: "Google Calendar integration via MCP (migrated)",
      });

      console.log(`Migrated user ${profile.id}`);
    }
  }

  console.log("Migration complete!");
}

migrateToMcp();
```

## Troubleshooting

### OAuth Issues

**Problem**: OAuth redirect fails  
**Solution**: Check that redirect URI in Google Cloud Console matches exactly: `http://localhost:3002/oauth/callback`

**Problem**: Tokens not syncing to MCP server  
**Solution**: Verify `GOOGLE_CALENDAR_MCP_URL` is set correctly and MCP server is running

### MCP Connection Issues

**Problem**: "Authentication required" errors  
**Solution**: Ensure user has completed OAuth flow and tokens are stored in profile

**Problem**: "No valid session ID"  
**Solution**: Check MCP client configuration and session management

### API Errors

**Problem**: Calendar API returns 401  
**Solution**: Token may be expired, trigger refresh flow

**Problem**: Calendar API returns 403  
**Solution**: Check OAuth scopes include required Calendar permissions

## Support

For issues or questions:

1. Check the main README.md
2. Review error logs in both MCP server and backend
3. Verify environment variables are set correctly
4. Test OAuth flow independently
5. Check Google Cloud Console for API quota limits

## Next Steps

After successful integration:

1. Monitor MCP server logs for errors
2. Set up proper error handling in frontend
3. Implement rate limiting if needed
4. Add analytics/monitoring
5. Consider caching frequently accessed data
6. Implement proper security measures for production







