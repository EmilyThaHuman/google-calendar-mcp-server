# Google Calendar MCP Server

A Model Context Protocol (MCP) server for Google Calendar integration with OAuth 2.0 authentication.

## Features

- **OAuth 2.0 Authentication**: Secure Google OAuth flow with automatic token refresh
- **MCP Protocol Support**: Full implementation of the Model Context Protocol
- **Google Calendar Operations**:
  - List and search events
  - Create, update, and delete events
  - List calendars
  - Get free/busy information
- **Session Management**: Persistent sessions with automatic token refresh
- **TypeScript**: Fully typed with TypeScript for better development experience

## Prerequisites

- Node.js 18+ 
- Google Cloud Project with Google Calendar API enabled
- OAuth 2.0 credentials (Client ID and Client Secret)

## Setup

### 1. Google Cloud Configuration

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Google Calendar API
4. Create OAuth 2.0 credentials:
   - Application type: Web application
   - Authorized redirect URIs: `http://localhost:3002/oauth/callback`
5. Copy your Client ID and Client Secret

### 2. Installation

```bash
# Clone or navigate to the project directory
cd google-calendar-mcp-server

# Install dependencies
npm install
```

### 3. Configuration

Create a `.env` file in the root directory:

```bash
cp env.example .env
```

Edit `.env` with your configuration:

```env
# Server Configuration
PORT=3002
NODE_ENV=development

# Google OAuth Configuration
GOOGLE_CLIENT_ID=your_google_client_id_here
GOOGLE_CLIENT_SECRET=your_google_client_secret_here
GOOGLE_REDIRECT_URI=http://localhost:3002/oauth/callback

# Frontend URL (where to redirect after OAuth)
FRONTEND_URL=http://localhost:5173

# MCP Server Configuration
MCP_SERVER_NAME=google-calendar-mcp-server
MCP_SERVER_VERSION=1.0.0
```

## Usage

### Development Mode

```bash
npm run dev
```

### Production Mode

```bash
# Build
npm run build

# Start
npm start
```

## API Endpoints

### Health Check
```
GET /health
```

### OAuth Flow

#### 1. Initiate Authorization
```
GET /oauth/authorize?userId={userId}&state={state}
```

Response:
```json
{
  "authorizationUrl": "https://accounts.google.com/o/oauth2/v2/auth?...",
  "state": "your-state-value"
}
```

#### 2. OAuth Callback (handled automatically)
```
GET /oauth/callback?code={code}&state={state}
```

#### 3. Refresh Token
```
POST /oauth/refresh
Content-Type: application/json

{
  "userId": "user123",
  "refreshToken": "refresh_token_here"
}
```

#### 4. Disconnect
```
POST /oauth/disconnect
Content-Type: application/json

{
  "userId": "user123"
}
```

### MCP Endpoint

```
POST /mcp
GET /mcp
DELETE /mcp
```

The MCP endpoint follows the Model Context Protocol specification for tool execution.

## MCP Tools

### 1. calendar_list_events

List and search Google Calendar events.

**Input:**
```json
{
  "userId": "user123",
  "calendarId": "primary",
  "timeMin": "2024-01-01T00:00:00Z",
  "timeMax": "2024-12-31T23:59:59Z",
  "maxResults": 50,
  "singleEvents": true,
  "orderBy": "startTime",
  "showDeleted": false,
  "q": "meeting"
}
```

**Output:**
```json
{
  "events": [
    {
      "id": "event123",
      "summary": "Team Meeting",
      "description": "Weekly team sync",
      "location": "Conference Room A",
      "start": {
        "dateTime": "2024-01-15T10:00:00-08:00",
        "timeZone": "America/Los_Angeles"
      },
      "end": {
        "dateTime": "2024-01-15T11:00:00-08:00",
        "timeZone": "America/Los_Angeles"
      },
      "attendees": [
        {
          "email": "user@example.com",
          "displayName": "User Name",
          "responseStatus": "accepted"
        }
      ],
      "status": "confirmed",
      "htmlLink": "https://calendar.google.com/..."
    }
  ],
  "count": 1
}
```

### 2. calendar_create_event

Create a new event in Google Calendar.

**Input:**
```json
{
  "userId": "user123",
  "calendarId": "primary",
  "summary": "Project Review",
  "description": "Q4 project review meeting",
  "location": "Building 1, Room 301",
  "start": {
    "dateTime": "2024-01-20T14:00:00-08:00",
    "timeZone": "America/Los_Angeles"
  },
  "end": {
    "dateTime": "2024-01-20T15:00:00-08:00",
    "timeZone": "America/Los_Angeles"
  },
  "attendees": [
    { "email": "colleague@example.com" }
  ],
  "reminders": {
    "useDefault": false,
    "overrides": [
      { "method": "email", "minutes": 1440 },
      { "method": "popup", "minutes": 10 }
    ]
  }
}
```

**Output:**
```json
{
  "success": true,
  "event": {
    "id": "event456",
    "summary": "Project Review",
    "htmlLink": "https://calendar.google.com/...",
    "start": {
      "dateTime": "2024-01-20T14:00:00-08:00"
    },
    "end": {
      "dateTime": "2024-01-20T15:00:00-08:00"
    }
  }
}
```

### 3. calendar_update_event

Update an existing event in Google Calendar.

**Input:**
```json
{
  "userId": "user123",
  "calendarId": "primary",
  "eventId": "event456",
  "summary": "Updated: Project Review",
  "location": "Building 2, Room 405"
}
```

**Output:**
```json
{
  "success": true,
  "event": {
    "id": "event456",
    "summary": "Updated: Project Review",
    "htmlLink": "https://calendar.google.com/..."
  }
}
```

### 4. calendar_delete_event

Delete an event from Google Calendar.

**Input:**
```json
{
  "userId": "user123",
  "calendarId": "primary",
  "eventId": "event456"
}
```

**Output:**
```json
{
  "success": true,
  "message": "Event event456 deleted successfully"
}
```

### 5. calendar_list_calendars

List all calendars for the authenticated user.

**Input:**
```json
{
  "userId": "user123"
}
```

**Output:**
```json
{
  "calendars": [
    {
      "id": "primary",
      "summary": "My Calendar",
      "description": "Personal calendar",
      "timeZone": "America/Los_Angeles",
      "primary": true
    },
    {
      "id": "work@example.com",
      "summary": "Work Calendar",
      "timeZone": "America/Los_Angeles",
      "primary": false
    }
  ],
  "count": 2
}
```

### 6. calendar_get_freebusy

Get free/busy information for calendars.

**Input:**
```json
{
  "userId": "user123",
  "timeMin": "2024-01-15T00:00:00Z",
  "timeMax": "2024-01-15T23:59:59Z",
  "calendarIds": ["primary", "work@example.com"]
}
```

**Output:**
```json
{
  "calendars": {
    "primary": {
      "busy": [
        {
          "start": "2024-01-15T10:00:00-08:00",
          "end": "2024-01-15T11:00:00-08:00"
        },
        {
          "start": "2024-01-15T14:00:00-08:00",
          "end": "2024-01-15T15:30:00-08:00"
        }
      ]
    }
  }
}
```

## Integration with ZeroTwoApi

To integrate this Google Calendar MCP server with your ZeroTwoApi backend:

### 1. Update Frontend OAuth Configuration

In `ZeroTwo/src/services/oauthProviders.js`, update the Google Calendar configuration:

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
  mcpSseEndpoint: "http://localhost:3002/sse",
},
```

### 2. Update Backend OAuth Routes

The backend OAuth routes in `ZeroTwoApi/routes/auth/google-calendar.js` should redirect to this MCP server instead of handling tokens directly.

### 3. Remove Old Tool Routes

Remove the old tool routes from `ZeroTwoApi/routes/ai/tools/google-calendar.js` since all Calendar operations are now handled by this MCP server.

### 4. Create MCP Integration

After OAuth authentication, create an MCP integration in the database:

```sql
INSERT INTO mcp_integrations (
  user_id,
  name,
  provider,
  endpoint,
  mcp_type,
  connection_status,
  auth_type,
  description
) VALUES (
  'user_id_here',
  'Google Calendar',
  'google_calendar',
  'http://localhost:3002/mcp',
  'remote_mcp',
  'connected',
  'oauth',
  'Google Calendar integration via MCP'
);
```

## Architecture

```
┌─────────────────┐
│   Frontend      │
│   (ZeroTwo)     │
└────────┬────────┘
         │
         │ OAuth Flow
         ▼
┌─────────────────┐      ┌──────────────────┐
│  Calendar MCP   │◄────►│  Google OAuth    │
│  Server         │      │  & Calendar API  │
└────────┬────────┘      └──────────────────┘
         │
         │ MCP Protocol
         ▼
┌─────────────────┐
│   Backend       │
│   (ZeroTwoApi)  │
└─────────────────┘
```

## Development

### Project Structure

```
google-calendar-mcp-server/
├── src/
│   ├── auth/
│   │   └── oauth-manager.ts    # OAuth token management
│   ├── config/
│   │   └── index.ts            # Configuration management
│   ├── calendar/
│   │   └── client.ts           # Calendar API wrapper
│   ├── mcp/
│   │   ├── server.ts           # MCP server implementation
│   │   └── tools.ts            # MCP tool definitions
│   ├── types/
│   │   └── index.ts            # TypeScript type definitions
│   ├── utils/
│   │   └── logger.ts           # Logging utility
│   └── index.ts                # Entry point
├── package.json
├── tsconfig.json
├── env.example
└── README.md
```

### Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build TypeScript to JavaScript
- `npm start` - Start production server
- `npm run lint` - Run ESLint
- `npm run format` - Format code with Prettier

## Security Considerations

1. **OAuth Tokens**: Tokens are stored in memory. For production, use a secure database or encrypted storage.
2. **CORS**: Configure CORS origins appropriately for production.
3. **HTTPS**: Use HTTPS in production for secure communication.
4. **Environment Variables**: Never commit `.env` files. Use secure secret management in production.
5. **Rate Limiting**: Implement rate limiting for production deployments.

## Troubleshooting

### OAuth Errors

- **"Missing required environment variables"**: Check your `.env` file has all required variables
- **"Failed to exchange authorization code"**: Verify your redirect URI matches exactly in Google Cloud Console
- **"Token expired"**: The server automatically refreshes tokens if a refresh token is available

### MCP Connection Issues

- **"No valid session ID"**: Ensure the MCP client sends proper session headers
- **"Authentication required"**: User needs to complete OAuth flow first

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.








---

## Powered by ZeroTwo

This Google Calendar MCP connector is part of the [ZeroTwo AI platform](https://zerotwo.ai) — the all-in-one AI workspace that lets you schedule meetings, manage events, and automate your calendar through GPT-5, Claude, and Gemini.

| | |
|---|---|
| 🌐 **[ZeroTwo — All AI Models in One App](https://zerotwo.ai)** | Schedule, reschedule, and manage Google Calendar events with AI — all in one app. |
| ✨ **[ZeroTwo Features](https://zerotwo.ai/features)** | AI scheduling, document analysis, web search, and MCP-powered calendar automation. |
| 🤖 **[AI Models — GPT-5, Claude & Gemini](https://zerotwo.ai/zerotwo-models)** | Use the world's best AI to plan your day, find availability, and set reminders. |
| 🔌 **[ZeroTwo Connectors & Integrations](https://zerotwo.ai/connectors)** | Connect Google Calendar, Gmail, Google Contacts, Outlook, and more to your AI workflow. |
| 💰 **[ZeroTwo Pricing](https://zerotwo.ai/pricing)** | One subscription that replaces ChatGPT Plus, Claude Pro, and Gemini Advanced. |
| 📝 **[ZeroTwo Blog](https://zerotwo.ai/blog)** | AI productivity tips, scheduling guides, and ZeroTwo product updates. |
| 🚀 **[Try ZeroTwo Free](https://app.zerotwo.ai/auth/login)** | Let AI manage your schedule — get started free today. |

> **Built for ZeroTwo** — Use this Google Calendar MCP server with [ZeroTwo's AI connector system](https://zerotwo.ai/connectors) to create events, check availability, and manage your calendar through natural language in your AI assistant.
