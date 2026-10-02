import { customType, timestamp, uuid } from 'drizzle-orm/pg-core';

import { uuidv7 } from '../../utils/uuid.js';

/** Primary key: UUID v7 generated in the application (time-sortable). */
export const id = () => uuid().primaryKey().$defaultFn(uuidv7);

/** `now()` timestamp with timezone. */
export const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/** Mutable timestamp, maintained by the application layer. */
export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/** IPv4/IPv6 address column. */
export const inet = customType<{ data: string; driverData: string }>({
  dataType: () => 'inet',
});
