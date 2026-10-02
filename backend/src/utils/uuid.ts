import { randomBytes } from 'node:crypto';

/**
 * UUID v7 (RFC 9562): 48-bit unix-ms timestamp + 80 bits of randomness.
 * Time-sortable identifiers without a database dependency on `uuidv7()`.
 */
export function uuidv7(): string {
  const bytes = randomBytes(16);

  // 48-bit big-endian timestamp (writeUIntBE only accepts up to 6 bytes)
  bytes.writeUIntBE(Date.now(), 0, 6);

  // version 7 in the high nibble of byte 6
  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x70, 6);
  // variant 10xx in the high bits of byte 8
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8);

  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
