// RFID Reader Command Utilities

/**
 * Calculates the checksum for the command packet.
 * Checksum is the lower 8 bits of the sum of all bytes in the payload.
 */
export const calcChecksum = (bytes: number[]): number => {
  const sum = bytes.reduce((a, b) => a + b, 0);
  return sum & 0xFF;
};

/**
 * Helper to convert a number to a 2-digit hex string.
 */
const toHex = (n: number): string => {
  return n.toString(16).toUpperCase().padStart(2, '0');
};

/**
 * Builds the command to get the current power setting.
 * Command: BB 00 B7 00 00 B7 7E
 */
export const buildGetPowerCmd = (): string => {
  return "BB 00 B7 00 00 B7 7E";
};

/**
 * Builds the command to set the TX power.
 * @param powerDec Power in dBm * 100 (e.g., 2400 for 24dBm, 1000 for 10dBm)
 */
export const buildSetPowerCmd = (powerDec: number): string => {
  // Command Structure: Header(BB) Type(00) Cmd(B6) PL_MSB(00) PL_LSB(02) Param_MSB Param_LSB Checksum End(7E)
  const cmd = 0xB6;
  const plMsb = 0x00;
  const plLsb = 0x02;
  const pMsb = (powerDec >> 8) & 0xFF;
  const pLsb = powerDec & 0xFF;
  
  // Checksum: Command + PL + Params
  const ck = calcChecksum([cmd, plMsb, plLsb, pMsb, pLsb]);
  
  return `BB 00 ${toHex(cmd)} ${toHex(plMsb)} ${toHex(plLsb)} ${toHex(pMsb)} ${toHex(pLsb)} ${toHex(ck)} 7E`;
};

/**
 * Builds the command to read the device hardware version.
 * Command: BB 00 03 00 01 00 04 7E
 */
export const buildGetVersionCmd = (): string => {
  return "BB 00 03 00 01 00 04 7E";
};
