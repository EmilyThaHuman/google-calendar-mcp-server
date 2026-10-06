/**
 * Cloudflare Workers Entry Point for Google Calendar MCP Server
 * Implements MCP protocol with SSE support for ChatGPT integration
 */

import { google } from 'googleapis';
import { calendarTools } from './mcp/tools.js';

// Cloudflare Workers types
declare global {
  interface KVNamespace {
    get(key: string): Promise<string | null>;
    put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
    delete(key: string): Promise<void>;
  }
  
  interface ExecutionContext {
    waitUntil(promise: Promise<any>): void;
    passThroughOnException(): void;
  }
}

// Environment interface for Cloudflare Workers
interface Env {
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REDIRECT_URI: string;
  FRONTEND_URL: string;
  BACKEND_API_URL?: string;
  MCP_SERVER_NAME: string;
  MCP_SERVER_VERSION: string;
  NODE_ENV: string;
  SESSIONS: KVNamespace;
}

// Session data structure
interface SessionData {
  userId: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  createdAt: string;
}

// OAuth token structure
interface OAuthTokens {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

// Calendar Client for Cloudflare Workers
class CalendarClientWorker {
  private accessToken: string;
  private env: Env;

  constructor(accessToken: string, env: Env) {
    this.accessToken = accessToken;
    this.env = env;
  }

  private getClient() {
    const oauth2Client = new google.auth.OAuth2(
      this.env.GOOGLE_CLIENT_ID,
      this.env.GOOGLE_CLIENT_SECRET,
      this.env.GOOGLE_REDIRECT_URI
    );

    oauth2Client.setCredentials({
      access_token: this.accessToken,
    });

    return google.calendar({ version: 'v3', auth: oauth2Client });
  }

  async listEvents(options: {
    calendarId?: string;
    timeMin?: string;
    timeMax?: string;
    maxResults?: number;
    singleEvents?: boolean;
    orderBy?: string;
    showDeleted?: boolean;
    q?: string;
  } = {}) {
    const calendar = this.getClient();
    const {
      calendarId = 'primary',
      timeMin,
      timeMax,
      maxResults = 50,
      singleEvents = true,
      orderBy = 'startTime',
      showDeleted = false,
      q,
    } = options;

    const requestParams: any = {
      calendarId,
      maxResults: Math.min(Math.max(1, maxResults), 2500),
      singleEvents,
      orderBy: singleEvents ? orderBy : undefined,
      showDeleted,
    };

    if (timeMin) {
      requestParams.timeMin = new Date(timeMin).toISOString();
    }

    if (timeMax) {
      requestParams.timeMax = new Date(timeMax).toISOString();
    }

    if (q) {
      requestParams.q = q;
    }

    const response = await calendar.events.list(requestParams);
    return response.data.items || [];
  }

  async createEvent(calendarId: string = 'primary', eventData: any) {
    const calendar = this.getClient();
    const response = await calendar.events.insert({
      calendarId,
      requestBody: eventData,
      conferenceDataVersion: eventData.conferenceData ? 1 : 0,
      sendUpdates: 'all',
    });
    return response.data;
  }

  async updateEvent(calendarId: string = 'primary', eventId: string, eventData: any) {
    const calendar = this.getClient();
    const response = await calendar.events.patch({
      calendarId,
      eventId,
      requestBody: eventData,
      sendUpdates: 'all',
    });
    return response.data;
  }

  async deleteEvent(calendarId: string = 'primary', eventId: string) {
    const calendar = this.getClient();
    await calendar.events.delete({
      calendarId,
      eventId,
      sendUpdates: 'all',
    });
  }

  async getEvent(calendarId: string = 'primary', eventId: string) {
    const calendar = this.getClient();
    const response = await calendar.events.get({
      calendarId,
      eventId,
    });
    return response.data;
  }

  async listCalendars() {
    const calendar = this.getClient();
    const response = await calendar.calendarList.list();
    return response.data.items || [];
  }

  async getFreeBusy(options: {
    timeMin: string;
    timeMax: string;
    items: Array<{ id: string }>;
  }) {
    const calendar = this.getClient();
    const response = await calendar.freebusy.query({
      requestBody: {
        timeMin: new Date(options.timeMin).toISOString(),
        timeMax: new Date(options.timeMax).toISOString(),
        items: options.items,
      },
    });
    return response.data;
  }

  async getProfile() {
    const calendar = this.getClient();
    const response = await calendar.settings.list();
    return response.data;
  }
}

/**
 * OAuth Manager for Cloudflare Workers
 */
class CloudflareOAuthManager {
  private env: Env;

  constructor(env: Env) {
    this.env = env;
  }

  private getOAuth2Client() {
    return new google.auth.OAuth2(
      this.env.GOOGLE_CLIENT_ID,
      this.env.GOOGLE_CLIENT_SECRET,
      this.env.GOOGLE_REDIRECT_URI
    );
  }

  getAuthorizationUrl(state: string): string {
    const oauth2Client = this.getOAuth2Client();
    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/calendar.readonly',
        'https://www.googleapis.com/auth/calendar.events',
      ],
      state,
      prompt: 'consent',
    });
  }

  async exchangeCodeForTokens(code: string): Promise<OAuthTokens> {
    const oauth2Client = this.getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);

    return {
      access_token: tokens.access_token!,
      refresh_token: tokens.refresh_token || undefined,
      expires_in: tokens.expiry_date
        ? Math.floor((tokens.expiry_date - Date.now()) / 1000)
        : 3600,
      token_type: tokens.token_type || 'Bearer',
      scope: tokens.scope || undefined,
    };
  }

  async refreshAccessToken(refreshToken: string): Promise<OAuthTokens> {
    const oauth2Client = this.getOAuth2Client();
    oauth2Client.setCredentials({ refresh_token: refreshToken });

    const { credentials } = await oauth2Client.refreshAccessToken();

    return {
      access_token: credentials.access_token!,
      refresh_token: refreshToken,
      expires_in: credentials.expiry_date
        ? Math.floor((credentials.expiry_date - Date.now()) / 1000)
        : 3600,
      token_type: credentials.token_type || 'Bearer',
      scope: credentials.scope || undefined,
    };
  }

  async storeSession(userId: string, tokens: OAuthTokens): Promise<void> {
    const expiresAt = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : undefined;

    const sessionData: SessionData = {
      userId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt,
      createdAt: new Date().toISOString(),
    };

    await this.env.SESSIONS.put(
      `session:${userId}`,
      JSON.stringify(sessionData),
      { expirationTtl: 60 * 60 * 24 * 30 }
    );
  }

  async getSession(userId: string): Promise<SessionData | null> {
    const data = await this.env.SESSIONS.get(`session:${userId}`);
    return data ? JSON.parse(data) : null;
  }

  async isSessionValid(userId: string): Promise<boolean> {
    const session = await this.getSession(userId);
    if (!session) return false;
    if (!session.expiresAt) return true;
    return new Date(session.expiresAt) > new Date();
  }

  async getValidAccessToken(userId: string): Promise<string | null> {
    const session = await this.getSession(userId);
    if (session && await this.isSessionValid(userId)) {
      return session.accessToken;
    }

    if (session && session.refreshToken) {
      try {
        const newTokens = await this.refreshAccessToken(session.refreshToken);
        await this.storeSession(userId, newTokens);
        return newTokens.access_token;
      } catch (error) {
        console.error('Failed to refresh token from KV:', error);
      }
    }

    // Fallback to backend API
    try {
      const backendUrl = this.env.BACKEND_API_URL || 
                        (this.env.FRONTEND_URL ? this.env.FRONTEND_URL.replace(/\/$/, '') : null) ||
                        'https://api.zerotwo.app';
      
      const response = await fetch(`${backendUrl}/api/ai/tools/google-calendar/token?userId=${userId}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (response.ok) {
        const data = await response.json() as {
          accessToken?: string;
          refreshToken?: string;
          expiresIn?: number;
        };
        if (data.accessToken) {
          await this.storeSession(userId, {
            access_token: data.accessToken,
            refresh_token: data.refreshToken,
            expires_in: data.expiresIn,
            token_type: 'Bearer',
          });
          return data.accessToken;
        }
      }
    } catch (error) {
      console.error('Failed to fetch token from backend API:', error);
    }

    return null;
  }

  async removeSession(userId: string): Promise<void> {
    await this.env.SESSIONS.delete(`session:${userId}`);
  }
}

/**
 * CORS headers
 */
function getCorsHeaders(origin?: string): Record<string, string> {
  const allowedOrigins = [
    'http://localhost:5173',
    'http://localhost:3000',
    'https://zerotwo.ai',
  ];

  const requestOrigin = origin || '';
  const allowOrigin = allowedOrigins.includes(requestOrigin)
    ? requestOrigin
    : allowedOrigins[0];

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, mcp-session-id, Authorization',
    'Access-Control-Expose-Headers': 'Mcp-Session-Id',
    'Access-Control-Allow-Credentials': 'true',
  };
}

/**
 * Handle OPTIONS requests
 */
function handleOptions(request: Request): Response {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(request.headers.get('Origin') || undefined),
  });
}

/**
 * Execute MCP tool
 */
async function executeTool(
  toolName: string,
  args: any,
  oauthManager: CloudflareOAuthManager,
  env: Env,
  requestHeaders?: Headers
): Promise<any> {
  // Get userId from args or from X-User-Id header
  let userId = args?.userId;
  if (!userId && requestHeaders) {
    userId = requestHeaders.get('X-User-Id');
  }
  
  if (!userId) {
    return {
      content: [
        {
          type: 'text',
          text: 'User ID is required for all Calendar operations. Please provide userId in tool arguments or X-User-Id header.',
        },
      ],
      isError: true,
    };
  }

  // First, try to get access token from X-Access-Token header (passed directly from backend)
  let accessToken = requestHeaders?.get('X-Access-Token') || null;
  
  // If not in header, fall back to KV storage lookup
  if (!accessToken) {
    accessToken = await oauthManager.getValidAccessToken(userId);
  }
  
  if (!accessToken) {
    return {
      content: [
        {
          type: 'text',
          text: 'Authentication required. Please authenticate with Google Calendar first.',
        },
      ],
      isError: true,
    };
  }

  const calendarClient = new CalendarClientWorker(accessToken, env);

  try {
    switch (toolName) {
      case 'google_calendar_get_profile': {
        const profile = await calendarClient.getProfile();
        const output = {
          settings: profile.items || [],
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(output, null, 2),
            },
          ],
        };
      }

      case 'google_calendar_search':
      case 'google_calendar_search_events': {
        const { calendarId, query, timeMin, timeMax, maxResults } = args;
        const events = await calendarClient.listEvents({
          calendarId,
          timeMin,
          timeMax,
          maxResults,
          singleEvents: true,
          orderBy: 'startTime',
          q: query,
        });

        const output = {
          events: events.map((event: any) => ({
            id: event.id,
            summary: event.summary,
            description: event.description,
            location: event.location,
            start: event.start,
            end: event.end,
            attendees: event.attendees,
            status: event.status,
            htmlLink: event.htmlLink,
          })),
          count: events.length,
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(output, null, 2),
            },
          ],
        };
      }

      case 'google_calendar_fetch':
      case 'google_calendar_read_event': {
        const { calendarId, eventId } = args;
        const event = await calendarClient.getEvent(calendarId || 'primary', eventId);

        const output = {
          event: {
            id: event.id,
            summary: event.summary,
            description: event.description,
            location: event.location,
            start: event.start,
            end: event.end,
            attendees: event.attendees,
            status: event.status,
            htmlLink: event.htmlLink,
            created: event.created,
            updated: event.updated,
            creator: event.creator,
            organizer: event.organizer,
          },
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(output, null, 2),
            },
          ],
        };
      }

      case 'google_calendar_create_event': {
        const { calendarId, summary, description, location, start, end, attendees, conferenceData } = args;
        
        // Validate and normalize start/end times
        // Handle case where agent passes strings instead of objects
        let normalizedStart = start;
        let normalizedEnd = end;

        if (!start) {
          return {
            content: [
              {
                type: 'text',
                text: 'Error: start time is required',
              },
            ],
            isError: true,
          };
        }

        if (typeof start === 'string') {
          // Convert string to object with dateTime
          normalizedStart = {
            dateTime: start,
          };
        } else if (typeof start === 'object') {
          // Validate object has at least dateTime or date
          if (!start.dateTime && !start.date) {
            return {
              content: [
                {
                  type: 'text',
                  text: 'Error: start time must have either dateTime or date field',
                },
              ],
              isError: true,
            };
          }
          normalizedStart = start;
        } else {
          return {
            content: [
              {
                type: 'text',
                text: 'Error: start time must be a string (ISO 8601) or an object with dateTime/date',
              },
            ],
            isError: true,
          };
        }

        if (!end) {
          return {
            content: [
              {
                type: 'text',
                text: 'Error: end time is required',
              },
            ],
            isError: true,
          };
        }

        if (typeof end === 'string') {
          // Convert string to object with dateTime
          normalizedEnd = {
            dateTime: end,
          };
        } else if (typeof end === 'object') {
          // Validate object has at least dateTime or date
          if (!end.dateTime && !end.date) {
            return {
              content: [
                {
                  type: 'text',
                  text: 'Error: end time must have either dateTime or date field',
                },
              ],
              isError: true,
            };
          }
          normalizedEnd = end;
        } else {
          return {
            content: [
              {
                type: 'text',
                text: 'Error: end time must be a string (ISO 8601) or an object with dateTime/date',
              },
            ],
            isError: true,
          };
        }
        
        const eventData: any = {
          summary,
          description,
          location,
          start: normalizedStart,
          end: normalizedEnd,
        };

        if (attendees && attendees.length > 0) {
          eventData.attendees = attendees.map((email: string) => ({ email }));
        }

        if (conferenceData) {
          eventData.conferenceData = conferenceData;
        }

        const event = await calendarClient.createEvent(calendarId || 'primary', eventData);

        const output = {
          event: {
            id: event.id,
            summary: event.summary,
            htmlLink: event.htmlLink,
            start: event.start,
            end: event.end,
          },
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(output, null, 2),
            },
          ],
        };
      }

      case 'google_calendar_update_event': {
        const { calendarId, eventId, summary, description, location, start, end, attendees, status } = args;
        
        const eventData: any = {};
        if (summary !== undefined) eventData.summary = summary;
        if (description !== undefined) eventData.description = description;
        if (location !== undefined) eventData.location = location;
        if (start !== undefined) eventData.start = start;
        if (end !== undefined) eventData.end = end;
        if (status !== undefined) eventData.status = status;
        
        if (attendees && attendees.length > 0) {
          eventData.attendees = attendees.map((email: string) => ({ email }));
        }

        const event = await calendarClient.updateEvent(calendarId || 'primary', eventId, eventData);

        const output = {
          event: {
            id: event.id,
            summary: event.summary,
            htmlLink: event.htmlLink,
            start: event.start,
            end: event.end,
            updated: event.updated,
          },
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(output, null, 2),
            },
          ],
        };
      }

      case 'google_calendar_delete_event': {
        const { calendarId, eventId } = args;
        await calendarClient.deleteEvent(calendarId || 'primary', eventId);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ success: true, message: 'Event deleted successfully' }, null, 2),
            },
          ],
        };
      }

      case 'google_calendar_list_calendars': {
        const calendars = await calendarClient.listCalendars();

        const output = {
          calendars: calendars.map((cal: any) => ({
            id: cal.id,
            summary: cal.summary,
            description: cal.description,
            timeZone: cal.timeZone,
            primary: cal.primary,
            accessRole: cal.accessRole,
          })),
          count: calendars.length,
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(output, null, 2),
            },
          ],
        };
      }

      case 'google_calendar_get_free_busy': {
        const { timeMin, timeMax, calendarIds } = args;
        const items = calendarIds.map((id: string) => ({ id }));
        const freeBusy = await calendarClient.getFreeBusy({ timeMin, timeMax, items });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(freeBusy, null, 2),
            },
          ],
        };
      }

      default:
        return {
          content: [
            {
              type: 'text',
              text: `Unknown tool: ${toolName}`,
            },
          ],
          isError: true,
        };
    }
  } catch (error: any) {
    console.error(`Error executing tool ${toolName}:`, error);
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Handle MCP protocol requests
 */
async function handleMcpRequest(
  request: Request,
  env: Env,
  oauthManager: CloudflareOAuthManager
): Promise<Response> {
  try {
    const body = await request.json() as {
      method?: string;
      id?: string | number;
      params?: { name?: string; arguments?: any };
    };

    if (body.method === 'initialize') {
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: {
              name: env.MCP_SERVER_NAME || 'google-calendar-mcp-server',
              version: env.MCP_SERVER_VERSION || '1.0.0',
            },
          },
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            ...getCorsHeaders(request.headers.get('Origin') || undefined),
          },
        }
      );
    }

    if (body.method === 'tools/list') {
      const tools = calendarTools.map((tool) => {
        // Extract schema properties from Zod schema
        const schema = tool.definition.inputSchema as any;
        const properties: Record<string, any> = {};
        
        if (schema && typeof schema === 'object') {
          // Try to extract from shape if available
          if (schema.shape) {
            Object.entries(schema.shape).forEach(([key, value]: [string, any]) => {
              properties[key] = {
                type: value._def?.typeName === 'ZodString' ? 'string' : 
                      value._def?.typeName === 'ZodNumber' ? 'number' :
                      value._def?.typeName === 'ZodBoolean' ? 'boolean' :
                      value._def?.typeName === 'ZodArray' ? 'array' : 'string',
                description: value.description || value._def?.description || '',
              };
            });
          }
        }

        return {
          name: tool.name,
          description: tool.definition.description || tool.definition.title || '',
          inputSchema: {
            type: 'object',
            properties,
            required: [],
          },
        };
      });

      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: { tools },
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            ...getCorsHeaders(request.headers.get('Origin') || undefined),
          },
        }
      );
    }

    if (body.method === 'tools/call') {
      if (!body.params) {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: body.id,
            error: { code: -32602, message: 'Invalid params' },
          }),
          {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
              ...getCorsHeaders(),
            },
          }
        );
      }

      const { name, arguments: args } = body.params;
      const result = await executeTool(name!, args || {}, oauthManager, env, request.headers);

      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            content: result.content,
            isError: result.isError || false,
          },
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            ...getCorsHeaders(request.headers.get('Origin') || undefined),
          },
        }
      );
    }

    // Handle notifications (no id field, no response expected)
    // Notifications like notifications/initialized don't have an id and don't require a JSON-RPC response
    // Use 204 No Content for proper HTTP semantics
    if (body.method?.startsWith('notifications/') || (!body.id && body.method)) {
      // For notifications, just acknowledge with 204 No Content
      return new Response(null, {
        status: 204,
        headers: getCorsHeaders(request.headers.get('Origin') || undefined),
      });
    }

    // Unknown method (only for requests with id)
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: body.id,
        error: { code: -32601, message: 'Method not found' },
      }),
      {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          ...getCorsHeaders(request.headers.get('Origin') || undefined),
        },
      }
    );
  } catch (error: any) {
    console.error('MCP request error:', error);
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32603, message: 'Internal error', data: error.message },
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...getCorsHeaders(request.headers.get('Origin') || undefined),
        },
      }
    );
  }
}

/**
 * Main Worker fetch handler
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const corsHeaders = getCorsHeaders(origin || undefined);

    if (request.method === 'OPTIONS') {
      return handleOptions(request);
    }

    try {
      const oauthManager = new CloudflareOAuthManager(env);

      // Health check
      if (url.pathname === '/health' || url.pathname === '/') {
        return new Response(
          JSON.stringify({
            status: 'healthy',
            server: env.MCP_SERVER_NAME,
            version: env.MCP_SERVER_VERSION,
            timestamp: new Date().toISOString(),
          }),
          { headers: { 'Content-Type': 'application/json', ...corsHeaders } }
        );
      }

      // OAuth authorization
      if (url.pathname === '/oauth/authorize' && request.method === 'GET') {
        const userId = url.searchParams.get('userId');
        const state = url.searchParams.get('state');

        if (!userId || !state) {
          return new Response(
            JSON.stringify({ error: 'Missing required parameters: userId and state' }),
            { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
          );
        }

        const authUrl = oauthManager.getAuthorizationUrl(state);
        return new Response(
          JSON.stringify({ authorizationUrl: authUrl, state }),
          { headers: { 'Content-Type': 'application/json', ...corsHeaders } }
        );
      }

      // OAuth callback
      if (url.pathname === '/oauth/callback' && request.method === 'GET') {
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const error = url.searchParams.get('error');

        if (error) {
          return Response.redirect(
            `${env.FRONTEND_URL}/settings?oauth_error=${encodeURIComponent(error)}`,
            302
          );
        }

        if (!code || !state) {
          return new Response(
            JSON.stringify({ error: 'Missing required parameters: code and state' }),
            { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
          );
        }

        const tokens = await oauthManager.exchangeCodeForTokens(code);
        await oauthManager.storeSession(state, tokens);

        return Response.redirect(
          `${env.FRONTEND_URL}/settings?oauth_success=true&provider=google_calendar`,
          302
        );
      }

      // OAuth refresh
      if (url.pathname === '/oauth/refresh' && request.method === 'POST') {
        const body = await request.json() as { userId?: string; refreshToken?: string };
        const { userId, refreshToken } = body;

        if (!userId || !refreshToken) {
          return new Response(
            JSON.stringify({ error: 'Missing required parameters: userId and refreshToken' }),
            { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
          );
        }

        const tokens = await oauthManager.refreshAccessToken(refreshToken);
        await oauthManager.storeSession(userId, tokens);

        return new Response(
          JSON.stringify({
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            expiresIn: tokens.expires_in,
            timestamp: new Date().toISOString(),
          }),
          { headers: { 'Content-Type': 'application/json', ...corsHeaders } }
        );
      }

      // OAuth disconnect
      if (url.pathname === '/oauth/disconnect' && request.method === 'POST') {
        const body = await request.json() as { userId?: string };
        const { userId } = body;

        if (!userId) {
          return new Response(
            JSON.stringify({ error: 'Missing required parameter: userId' }),
            { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
          );
        }

        await oauthManager.removeSession(userId);

        return new Response(
          JSON.stringify({ success: true, message: 'Successfully disconnected' }),
          { headers: { 'Content-Type': 'application/json', ...corsHeaders } }
        );
      }

      // OAuth token sync
      if (url.pathname === '/oauth/sync' && request.method === 'POST') {
        const body = await request.json() as {
          userId?: string;
          accessToken?: string;
          refreshToken?: string;
          expiresIn?: number;
        };
        const { userId, accessToken, refreshToken, expiresIn } = body;

        if (!userId || !accessToken) {
          return new Response(
            JSON.stringify({ error: 'Missing required parameters: userId and accessToken' }),
            { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
          );
        }

        await oauthManager.storeSession(userId, {
          access_token: accessToken,
          refresh_token: refreshToken,
          expires_in: expiresIn,
          token_type: 'Bearer',
        });

        return new Response(
          JSON.stringify({ success: true, message: 'Tokens synced successfully' }),
          { headers: { 'Content-Type': 'application/json', ...corsHeaders } }
        );
      }

      // MCP endpoint
      if (url.pathname === '/mcp' && request.method === 'POST') {
        return handleMcpRequest(request, env, oauthManager);
      }

      // 404
      return new Response(
        JSON.stringify({ error: 'Not Found', message: 'The requested endpoint does not exist' }),
        { status: 404, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    } catch (error: any) {
      console.error('Worker error:', error);
      return new Response(
        JSON.stringify({ error: 'Internal Server Error', message: error.message }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }
  },
};

