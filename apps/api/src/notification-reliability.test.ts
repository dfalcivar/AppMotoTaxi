import {describe,expect,it} from 'vitest';
import {immediatePriorities,isRetriablePushError,notificationTtlMs,retryDelaySeconds} from './notification-reliability.js';
import {notificationClassification} from './user-notifications.js';

describe('notification reliability policy regression matrix',()=>{
  const classifications:[string,string,string][]=[
    ['SECURITY_PASSWORD_CHANGED','SYSTEM','SECURITY'],['TRIP_OFFER','TRANSACTIONAL','TRIP_CRITICAL'],['TRIP_ASSIGNED','TRANSACTIONAL','TRIP_CRITICAL'],
    ['DRIVER_EN_ROUTE','TRANSACTIONAL','TRIP_CRITICAL'],['DRIVER_ARRIVED','TRANSACTIONAL','TRIP_CRITICAL'],['IN_PROGRESS','TRANSACTIONAL','TRIP_CRITICAL'],
    ['COMPLETED','TRANSACTIONAL','TRIP_CRITICAL'],['TRIP_CANCELLED','TRANSACTIONAL','TRIP_CRITICAL'],['NO_DRIVER','TRANSACTIONAL','TRIP_CRITICAL'],
    ['MEMBERSHIP_ACTIVATED','OPERATIONAL','OPERATIONAL'],['SUPPORT_RESPONSE','OPERATIONAL','OPERATIONAL'],['SCHEDULED_TRIP_REMINDER','REMINDER','REMINDER'],
    ['SMART_RETURN_HOME','SMART','SMART'],['SYSTEM','SYSTEM','SYSTEM'],['APP_UPDATE','SYSTEM','SYSTEM'],['CAMPAIGN','CAMPAIGN','CAMPAIGN'],
    ['EVENT','CAMPAIGN','CAMPAIGN'],['PROMOTIONAL','PROMOTIONAL','PROMOTIONAL']
  ];
  it.each(classifications)('%s keeps category and priority', (type,category,priority)=>{
    expect(notificationClassification(type)).toEqual({category,priority});
  });
  it('only security and trip-critical bypass the queue',()=>expect([...immediatePriorities]).toEqual(['SECURITY','TRIP_CRITICAL']));
  it('trip offers expire quickly',()=>expect(notificationTtlMs('TRIP_CRITICAL','TRIP_OFFER')).toBe(90_000));
  it('operational notices survive one day',()=>expect(notificationTtlMs('OPERATIONAL')).toBe(86_400_000));
  it('campaigns have a bounded lifetime',()=>expect(notificationTtlMs('CAMPAIGN')).toBe(259_200_000));
  it('backoff is exponential',()=>expect([1,2,3,4].map(value=>retryDelaySeconds(value))).toEqual([30,60,120,240]));
  it('backoff is capped',()=>expect(retryDelaySeconds(20)).toBe(3600));
  it('provider outages retry while invalid tokens do not',()=>{
    expect(isRetriablePushError('messaging/server-unavailable')).toBe(true);
    expect(isRetriablePushError('messaging/registration-token-not-registered')).toBe(false);
  });
});
