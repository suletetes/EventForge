/**
 * EventList component displaying the 50 most recent events.
 * Validates: Requirements 9.3
 *
 * Renders events in a table showing eventType, source, and timestamp.
 * Receives events as props from the parent Dashboard component.
 */

import React from 'react';

export interface EventItem {
  eventType: string;
  source: string;
  timestamp: string;
}

export interface EventListProps {
  events: EventItem[];
  loading: boolean;
}

export function EventList({ events, loading }: EventListProps): React.ReactElement {
  if (loading && events.length === 0) {
    return (
      <div className="event-list event-list--loading">
        <h2>Recent Events</h2>
        <p>Loading events...</p>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="event-list event-list--empty">
        <h2>Recent Events</h2>
        <p>No events to display.</p>
      </div>
    );
  }

  return (
    <div className="event-list">
      <h2>Recent Events</h2>
      <table className="event-list__table">
        <thead>
          <tr>
            <th>Event Type</th>
            <th>Source</th>
            <th>Timestamp</th>
          </tr>
        </thead>
        <tbody>
          {events.slice(0, 50).map((event, index) => (
            <tr key={`${event.timestamp}-${index}`} className="event-list__row">
              <td className="event-list__cell event-list__cell--type">
                {event.eventType}
              </td>
              <td className="event-list__cell event-list__cell--source">
                {event.source}
              </td>
              <td className="event-list__cell event-list__cell--timestamp">
                {new Date(event.timestamp).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default EventList;
