/**
 * MCP Tool definitions for Google Calendar operations
 */

import { z } from 'zod';
import { calendarClient } from '../calendar/client.js';
import { oauthManager } from '../auth/oauth-manager.js';
import { logger } from '../utils/logger.js';

/**
 * Get Profile Tool
 */
export const getProfileTool = {
  name: 'google_calendar_get_profile',
  definition: {
    title: 'Get Calendar Profile',
    description: 'Use this when you need the authenticated Google Calendar account settings/profile context. It does not search, list, or modify events.',
    inputSchema: {
      userId: z.string().describe('User ID for authentication'),
    },
    outputSchema: {
      settings: z.record(z.any()),
    },
  },
  handler: async (args: any, oauthManagerOverride?: any) => {
    try {
      const { userId } = args;

      logger.info('[Tool:google_calendar_get_profile] Executing', { userId });

      // Use provided oauth manager (for Cloudflare Workers) or default
      const manager = oauthManagerOverride || oauthManager;

      // Get valid access token
      const accessToken = await manager.getValidAccessToken(userId);
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

      // Get profile
      const profile = await calendarClient.getProfile(accessToken);

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
        structuredContent: output,
      };
    } catch (error: any) {
      logger.error('[Tool:google_calendar_get_profile] Error:', error);
      return {
        content: [
          {
            type: 'text',
            text: `Error getting profile: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  },
};

/**
 * Search Tool
 */
export const searchTool = {
  name: 'google_calendar_search',
  definition: {
    title: 'Search Calendar Events',
    description: 'Use this to find Google Calendar events by free text and an optional time window. It returns event IDs and `htmlLink` URLs so the model can inspect candidate events first and then read a specific one by ID.',
    inputSchema: {
      userId: z.string().describe('User ID for authentication'),
      calendarId: z.string().default('primary').describe('Calendar ID (default: primary)'),
      query: z.string().optional().describe('Free text search query'),
      timeMin: z.string().optional().describe('Start time (ISO 8601 format)'),
      timeMax: z.string().optional().describe('End time (ISO 8601 format)'),
      maxResults: z.number().min(1).max(2500).default(50).describe('Maximum number of events to return'),
    },
    outputSchema: {
      events: z.array(
        z.object({
          id: z.string(),
          summary: z.string(),
          description: z.string().optional(),
          location: z.string().optional(),
          start: z.object({
            dateTime: z.string().optional(),
            date: z.string().optional(),
            timeZone: z.string().optional(),
          }),
          end: z.object({
            dateTime: z.string().optional(),
            date: z.string().optional(),
            timeZone: z.string().optional(),
          }),
          attendees: z.array(z.object({
            email: z.string(),
            displayName: z.string().optional(),
            responseStatus: z.string().optional(),
          })).optional(),
          status: z.string().optional(),
          htmlLink: z.string().optional(),
        })
      ),
      count: z.number(),
    },
  },
  handler: async (args: any, oauthManagerOverride?: any) => {
    try {
      const {
        userId,
        calendarId,
        query,
        timeMin,
        timeMax,
        maxResults,
      } = args;

      logger.info('[Tool:search] Executing', { userId, calendarId, query, maxResults });

      // Use provided oauth manager (for Cloudflare Workers) or default
      const manager = oauthManagerOverride || oauthManager;

      // Get valid access token
      const accessToken = await manager.getValidAccessToken(userId);
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

      // Fetch events
      const events = await calendarClient.listEvents(accessToken, {
        calendarId,
        timeMin,
        timeMax,
        maxResults,
        singleEvents: true,
        orderBy: 'startTime',
        q: query,
      });

      const output = {
        events: events.map((event) => ({
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
        structuredContent: output,
      };
    } catch (error: any) {
      logger.error('[Tool:google_calendar_search] Error:', error);
      return {
        content: [
          {
            type: 'text',
            text: `Error searching events: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  },
};

/**
 * Fetch Tool
 */
export const fetchTool = {
  name: 'google_calendar_fetch',
  definition: {
    title: 'Get Calendar Event',
    description: 'Use this to retrieve one specific Google Calendar event when you already know its `eventId`, usually from `google_calendar_search` or `google_calendar_search_events`. It returns the full event details.',
    inputSchema: {
      userId: z.string().describe('User ID for authentication'),
      calendarId: z.string().default('primary').describe('Calendar ID (default: primary)'),
      eventId: z.string().describe('Google Calendar event ID returned by `google_calendar_search` or `google_calendar_search_events`.'),
    },
    outputSchema: {
      event: z.object({
        id: z.string(),
        summary: z.string(),
        description: z.string().optional(),
        location: z.string().optional(),
        start: z.object({
          dateTime: z.string().optional(),
          date: z.string().optional(),
          timeZone: z.string().optional(),
        }),
        end: z.object({
          dateTime: z.string().optional(),
          date: z.string().optional(),
          timeZone: z.string().optional(),
        }),
        attendees: z.array(z.object({
          email: z.string(),
          displayName: z.string().optional(),
          responseStatus: z.string().optional(),
        })).optional(),
        status: z.string().optional(),
        htmlLink: z.string().optional(),
      }),
    },
  },
  handler: async (args: any, oauthManagerOverride?: any) => {
    try {
      const { userId, calendarId, eventId } = args;

      logger.info('[Tool:fetch] Executing', { userId, calendarId, eventId });

      // Use provided oauth manager (for Cloudflare Workers) or default
      const manager = oauthManagerOverride || oauthManager;

      // Get valid access token
      const accessToken = await manager.getValidAccessToken(userId);
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

      // Fetch event
      const event = await calendarClient.getEvent(accessToken, calendarId, eventId);

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
        },
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(output, null, 2),
          },
        ],
        structuredContent: output,
      };
    } catch (error: any) {
      logger.error('[Tool:google_calendar_fetch] Error:', error);
      return {
        content: [
          {
            type: 'text',
            text: `Error fetching event: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  },
};

/**
 * Search Events Tool
 */
export const searchEventsTool = {
  name: 'google_calendar_search_events',
  definition: {
    title: 'Look Up Calendar Events',
    description: 'Use this filtered event lookup when you want a date-window search with an optional text query. It is functionally similar to `google_calendar_search` and returns event IDs and `htmlLink` URLs for follow-up reads.',
    inputSchema: {
      userId: z.string().describe('User ID for authentication'),
      calendarId: z.string().default('primary').describe('Calendar ID (default: primary)'),
      timeMin: z.string().optional().describe('Start time (ISO 8601 format)'),
      timeMax: z.string().optional().describe('End time (ISO 8601 format)'),
      maxResults: z.number().min(1).max(2500).default(50).describe('Maximum number of events to return'),
      query: z.string().optional().describe('Free text search query'),
    },
    outputSchema: {
      events: z.array(
        z.object({
          id: z.string(),
          summary: z.string(),
          description: z.string().optional(),
          location: z.string().optional(),
          start: z.object({
            dateTime: z.string().optional(),
            date: z.string().optional(),
            timeZone: z.string().optional(),
          }),
          end: z.object({
            dateTime: z.string().optional(),
            date: z.string().optional(),
            timeZone: z.string().optional(),
          }),
          attendees: z.array(z.object({
            email: z.string(),
            displayName: z.string().optional(),
            responseStatus: z.string().optional(),
          })).optional(),
          status: z.string().optional(),
          htmlLink: z.string().optional(),
        })
      ),
      count: z.number(),
    },
  },
  handler: async (args: any, oauthManagerOverride?: any) => {
    try {
      const {
        userId,
        calendarId,
        timeMin,
        timeMax,
        maxResults,
        query,
      } = args;

      logger.info('[Tool:google_calendar_search_events] Executing', { userId, calendarId, maxResults });

      // Use provided oauth manager (for Cloudflare Workers) or default
      const manager = oauthManagerOverride || oauthManager;

      // Get valid access token
      const accessToken = await manager.getValidAccessToken(userId);
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

      // Fetch events
      const events = await calendarClient.listEvents(accessToken, {
        calendarId,
        timeMin,
        timeMax,
        maxResults,
        singleEvents: true,
        orderBy: 'startTime',
        q: query,
      });

      const output = {
        events: events.map((event) => ({
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
        structuredContent: output,
      };
    } catch (error: any) {
      logger.error('[Tool:google_calendar_search_events] Error:', error);
      return {
        content: [
          {
            type: 'text',
            text: `Error searching events: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  },
};

/**
 * Read Event Tool
 */
export const readEventTool = {
  name: 'google_calendar_read_event',
  definition: {
    title: 'Read Calendar Event',
    description: 'Use this single-event reader when you already have an `eventId` from a calendar search result and need the full event details. It is the direct follow-up tool after the Google Calendar search tools.',
    inputSchema: {
      userId: z.string().describe('User ID for authentication'),
      calendarId: z.string().default('primary').describe('Calendar ID (default: primary)'),
      eventId: z.string().describe('Google Calendar event ID returned by `google_calendar_search` or `google_calendar_search_events`.'),
    },
    outputSchema: {
      event: z.object({
        id: z.string(),
        summary: z.string(),
        description: z.string().optional(),
        location: z.string().optional(),
        start: z.object({
          dateTime: z.string().optional(),
          date: z.string().optional(),
          timeZone: z.string().optional(),
        }),
        end: z.object({
          dateTime: z.string().optional(),
          date: z.string().optional(),
          timeZone: z.string().optional(),
        }),
        attendees: z.array(z.object({
          email: z.string(),
          displayName: z.string().optional(),
          responseStatus: z.string().optional(),
        })).optional(),
        status: z.string().optional(),
        htmlLink: z.string().optional(),
      }),
    },
  },
  handler: async (args: any, oauthManagerOverride?: any) => {
    try {
      const { userId, calendarId, eventId } = args;

      logger.info('[Tool:read_event] Executing', { userId, calendarId, eventId });

      // Use provided oauth manager (for Cloudflare Workers) or default
      const manager = oauthManagerOverride || oauthManager;

      // Get valid access token
      const accessToken = await manager.getValidAccessToken(userId);
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

      // Fetch event
      const event = await calendarClient.getEvent(accessToken, calendarId, eventId);

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
        },
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(output, null, 2),
          },
        ],
        structuredContent: output,
      };
    } catch (error: any) {
      logger.error('[Tool:google_calendar_read_event] Error:', error);
      return {
        content: [
          {
            type: 'text',
            text: `Error reading event: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  },
};

/**
 * Create Event Tool
 */
export const createEventTool = {
  name: 'google_calendar_create_event',
  definition: {
    title: 'Create Google Calendar Event',
    description: 'Use this to create a new Google Calendar event with start/end times, attendees, and reminders. Do not use it for searching or reading existing events.',
    inputSchema: {
      userId: z.string().describe('User ID for authentication'),
      calendarId: z.string().default('primary').describe('Calendar ID (default: primary)'),
      summary: z.string().describe('Event title/summary'),
      description: z.string().optional().describe('Event description'),
      location: z.string().optional().describe('Event location'),
      start: z.object({
        dateTime: z.string().optional().describe('Start date-time (ISO 8601)'),
        date: z.string().optional().describe('Start date (for all-day events, YYYY-MM-DD)'),
        timeZone: z.string().optional().describe('Time zone (e.g., America/Los_Angeles)'),
      }).refine(
        (data) => data.dateTime || data.date,
        {
          message: 'Either dateTime or date must be provided for start time',
        }
      ).describe('Event start time'),
      end: z.object({
        dateTime: z.string().optional().describe('End date-time (ISO 8601)'),
        date: z.string().optional().describe('End date (for all-day events, YYYY-MM-DD)'),
        timeZone: z.string().optional().describe('Time zone (e.g., America/Los_Angeles)'),
      }).refine(
        (data) => data.dateTime || data.date,
        {
          message: 'Either dateTime or date must be provided for end time',
        }
      ).describe('Event end time'),
      attendees: z.array(z.object({
        email: z.string(),
      })).optional().describe('Event attendees'),
      reminders: z.object({
        useDefault: z.boolean().optional(),
        overrides: z.array(z.object({
          method: z.string(),
          minutes: z.number(),
        })).optional(),
      }).optional().describe('Event reminders'),
    },
    outputSchema: {
      success: z.boolean(),
      event: z.object({
        id: z.string(),
        summary: z.string(),
        htmlLink: z.string().optional(),
        start: z.object({
          dateTime: z.string().optional(),
          date: z.string().optional(),
        }),
        end: z.object({
          dateTime: z.string().optional(),
          date: z.string().optional(),
        }),
      }),
    },
  },
  handler: async (args: any, oauthManagerOverride?: any) => {
    try {
      const { userId, calendarId, ...eventData } = args;

      logger.info('[Tool:google_calendar_create_event] Executing', {
        userId,
        calendarId,
        summary: eventData.summary,
        hasStart: !!eventData.start,
        hasEnd: !!eventData.end,
        startType: typeof eventData.start,
        endType: typeof eventData.end,
      });

      // Validate and normalize start/end times
      // Handle case where agent passes strings instead of objects
      if (eventData.start) {
        if (typeof eventData.start === 'string') {
          // Convert string to object with dateTime
          eventData.start = {
            dateTime: eventData.start,
          };
          logger.info('[Tool:google_calendar_create_event] Converted start string to object', {
            dateTime: eventData.start.dateTime,
          });
        } else if (typeof eventData.start === 'object') {
          // Validate object has at least dateTime or date
          if (!eventData.start.dateTime && !eventData.start.date) {
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
        }
      } else {
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

      if (eventData.end) {
        if (typeof eventData.end === 'string') {
          // Convert string to object with dateTime
          eventData.end = {
            dateTime: eventData.end,
          };
          logger.info('[Tool:google_calendar_create_event] Converted end string to object', {
            dateTime: eventData.end.dateTime,
          });
        } else if (typeof eventData.end === 'object') {
          // Validate object has at least dateTime or date
          if (!eventData.end.dateTime && !eventData.end.date) {
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
        }
      } else {
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

      // Use provided oauth manager (for Cloudflare Workers) or default
      const manager = oauthManagerOverride || oauthManager;

      // Get valid access token
      const accessToken = await manager.getValidAccessToken(userId);
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

      // Create event
      const event = await calendarClient.createEvent(accessToken, calendarId, eventData);

      const output = {
        success: true,
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
        structuredContent: output,
      };
    } catch (error: any) {
      logger.error('[Tool:google_calendar_create_event] Error:', error);
      return {
        content: [
          {
            type: 'text',
            text: `Error creating event: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  },
};

/**
 * Export all tools
 */
export const calendarTools = [
  getProfileTool,
  searchTool,
  fetchTool,
  searchEventsTool,
  readEventTool,
  createEventTool,
];






