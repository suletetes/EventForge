/**
 * EventList component displaying the 50 most recent events.
 * Validates: Requirements 9.3
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
      <div className="event-list__empty">
        <div className="spinner" style={{ margin: '0 auto 8px' }} />
        Loading events...
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="event-list__empty">
        No events to display yet. Create an order to generate events.
      </div>
    );
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="event-list__table">
        <thead>
          <tr>
            <th>Event Type</th>
            <th>Source</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody>
          {events.slice(0, 50).map((event, index) => (
            <tr key={`${event.timestamp}-${index}`}>
              <td>
                <span className="event-list__type-badge">{event.eventType}</span>
              </td>
              <td>
                <span className="event-list__source">{event.source}</span>
              </td>
              <td>
                <span className="event-list__time">
                  {new Date(event.timestamp).toLocaleString()}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default EventList;
