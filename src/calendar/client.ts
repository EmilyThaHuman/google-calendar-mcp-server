/**
 * Google Calendar API Client wrapper
 */

import { google } from 'googleapis';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { CalendarEvent, EventData, Calendar } from '../types/index.js';

export class CalendarClient {
  private clientId?: string;
  private clientSecret?: string;
  private redirectUri?: string;

  /**
   * Set OAuth credentials (for Cloudflare Workers environment)
   */
  setCredentials(clientId: string, clientSecret: string, redirectUri: string) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUri = redirectUri;
  }

  /**
   * Create Calendar API client with access token
   */
  private getClient(accessToken: string) {
    const clientId = this.clientId || config.google.clientId;
    const clientSecret = this.clientSecret || config.google.clientSecret;
    const redirectUri = this.redirectUri || config.google.redirectUri;

    logger.info('[CalendarClient] Creating OAuth2 client', {
      hasClientId: !!clientId,
      hasClientSecret: !!clientSecret,
      hasRedirectUri: !!redirectUri,
      hasAccessToken: !!accessToken,
      clientIdLength: clientId?.length || 0,
    });

    const oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      redirectUri
    );

    oauth2Client.setCredentials({
      access_token: accessToken,
    });

    return google.calendar({ version: 'v3', auth: oauth2Client });
  }

  /**
   * List calendar events with optional filtering
   */
  async listEvents(
    accessToken: string,
    options: {
      calendarId?: string;
      timeMin?: string;
      timeMax?: string;
      maxResults?: number;
      singleEvents?: boolean;
      orderBy?: string;
      showDeleted?: boolean;
      q?: string;
    } = {}
  ): Promise<CalendarEvent[]> {
    try {
      const calendar = this.getClient(accessToken);

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

      logger.info('[CalendarClient] Listing events', {
        calendarId,
        timeMin,
        timeMax,
        maxResults,
      });

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
      const events = (response.data.items || []) as CalendarEvent[];

      logger.info('[CalendarClient] Successfully retrieved events', {
        count: events.length,
      });

      return events;
    } catch (error) {
      logger.error('[CalendarClient] Error listing events:', error);
      throw new Error('Failed to list calendar events');
    }
  }

  /**
   * Create a calendar event
   */
  async createEvent(
    accessToken: string,
    calendarId: string = 'primary',
    eventData: EventData
  ): Promise<CalendarEvent> {
    try {
      const calendar = this.getClient(accessToken);

      logger.info('[CalendarClient] Creating event', {
        calendarId,
        summary: eventData.summary,
      });

      const response = await calendar.events.insert({
        calendarId,
        requestBody: eventData as any,
        conferenceDataVersion: eventData.conferenceData ? 1 : 0,
        sendUpdates: 'all',
      });

      const event = response.data as CalendarEvent;

      logger.info('[CalendarClient] Successfully created event', { eventId: event.id });

      return event;
    } catch (error) {
      logger.error('[CalendarClient] Error creating event:', error);
      throw new Error('Failed to create calendar event');
    }
  }

  /**
   * Update a calendar event
   */
  async updateEvent(
    accessToken: string,
    calendarId: string = 'primary',
    eventId: string,
    eventData: Partial<EventData>
  ): Promise<CalendarEvent> {
    try {
      const calendar = this.getClient(accessToken);

      logger.info('[CalendarClient] Updating event', {
        calendarId,
        eventId,
      });

      const response = await calendar.events.patch({
        calendarId,
        eventId,
        requestBody: eventData as any,
        sendUpdates: 'all',
      });

      const event = response.data as CalendarEvent;

      logger.info('[CalendarClient] Successfully updated event', { eventId: event.id });

      return event;
    } catch (error) {
      logger.error('[CalendarClient] Error updating event:', error);
      throw new Error('Failed to update calendar event');
    }
  }

  /**
   * Delete a calendar event
   */
  async deleteEvent(
    accessToken: string,
    calendarId: string = 'primary',
    eventId: string
  ): Promise<void> {
    try {
      const calendar = this.getClient(accessToken);

      logger.info('[CalendarClient] Deleting event', {
        calendarId,
        eventId,
      });

      await calendar.events.delete({
        calendarId,
        eventId,
        sendUpdates: 'all',
      });

      logger.info('[CalendarClient] Successfully deleted event', { eventId });
    } catch (error) {
      logger.error('[CalendarClient] Error deleting event:', error);
      throw new Error('Failed to delete calendar event');
    }
  }

  /**
   * Get a specific calendar event
   */
  async getEvent(
    accessToken: string,
    calendarId: string = 'primary',
    eventId: string
  ): Promise<CalendarEvent> {
    try {
      const calendar = this.getClient(accessToken);

      logger.info('[CalendarClient] Getting event', {
        calendarId,
        eventId,
      });

      const response = await calendar.events.get({
        calendarId,
        eventId,
      });

      const event = response.data as CalendarEvent;

      logger.info('[CalendarClient] Successfully retrieved event', { eventId: event.id });

      return event;
    } catch (error) {
      logger.error('[CalendarClient] Error getting event:', error);
      throw new Error('Failed to get calendar event');
    }
  }

  /**
   * List calendars
   */
  async listCalendars(accessToken: string): Promise<Calendar[]> {
    try {
      const calendar = this.getClient(accessToken);

      logger.info('[CalendarClient] Listing calendars');

      const response = await calendar.calendarList.list();
      const calendars = (response.data.items || []) as Calendar[];

      logger.info('[CalendarClient] Successfully retrieved calendars', {
        count: calendars.length,
      });

      return calendars;
    } catch (error) {
      logger.error('[CalendarClient] Error listing calendars:', error);
      throw new Error('Failed to list calendars');
    }
  }

  /**
   * Get free/busy information
   */
  async getFreeBusy(
    accessToken: string,
    options: {
      timeMin: string;
      timeMax: string;
      items: Array<{ id: string }>;
    }
  ): Promise<any> {
    try {
      const calendar = this.getClient(accessToken);

      logger.info('[CalendarClient] Getting free/busy information', {
        timeMin: options.timeMin,
        timeMax: options.timeMax,
        calendars: options.items.length,
      });

      const response = await calendar.freebusy.query({
        requestBody: {
          timeMin: new Date(options.timeMin).toISOString(),
          timeMax: new Date(options.timeMax).toISOString(),
          items: options.items,
        },
      });

      logger.info('[CalendarClient] Successfully retrieved free/busy information');

      return response.data;
    } catch (error) {
      logger.error('[CalendarClient] Error getting free/busy:', error);
      throw new Error('Failed to get free/busy information');
    }
  }

  /**
   * Get user profile/settings
   */
  async getProfile(accessToken: string): Promise<any> {
    try {
      const calendar = this.getClient(accessToken);

      logger.info('[CalendarClient] Getting user profile');

      const response = await calendar.settings.list();

      logger.info('[CalendarClient] Successfully retrieved profile');

      return response.data;
    } catch (error) {
      logger.error('[CalendarClient] Error getting profile:', error);
      throw new Error('Failed to get user profile');
    }
  }
}

// Singleton instance
export const calendarClient = new CalendarClient();







