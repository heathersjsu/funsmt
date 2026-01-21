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

/**
 * Builds the command to get demodulator parameters (Mixer, IF AMP, Threshold).
 * Command: BB 00 F1 00 00 F1 7E
 */
export const buildGetDemodulatorParamsCmd = (): string => {
  return "BB 00 F1 00 00 F1 7E";
};

/**
 * Builds the command to set demodulator parameters.
 * @param mixer Mixer Gain (0x00 - 0x06)
 * @param ifAmp IF AMP Gain (0x00 - 0x07)
 * @param threshold Signal Demodulation Threshold (16-bit hex value)
 */
export const buildSetDemodulatorParamsCmd = (mixer: number, ifAmp: number, threshold: number): string => {
  // Command: BB 00 F0 00 04 [Mixer] [IF] [ThrdH] [ThrdL] [CS] 7E
  const cmd = 0xF0;
  const plMsb = 0x00;
  const plLsb = 0x04;
  
  const thrdMsb = (threshold >> 8) & 0xFF;
  const thrdLsb = threshold & 0xFF;

  const ck = calcChecksum([cmd, plMsb, plLsb, mixer, ifAmp, thrdMsb, thrdLsb]);

  return `BB 00 ${toHex(cmd)} ${toHex(plMsb)} ${toHex(plLsb)} ${toHex(mixer)} ${toHex(ifAmp)} ${toHex(thrdMsb)} ${toHex(thrdLsb)} ${toHex(ck)} 7E`;
};

/**
 * Builds the command to get the current Gen2 Query parameters.
 * Command: BB 00 0D 00 00 0D 7E
 */
export const buildGetQueryCmd = (): string => {
  return "BB 00 0D 00 00 0D 7E";
};

/**
 * Builds the command to set Gen2 Query parameters.
 * @param session Session (0-3: S0, S1, S2, S3)
 * @param q Q Value (0-15)
 * @param target Target (0: A, 1: B) - Default 0
 * @param dr DR (0: DR=8, 1: DR=64/3) - Default 0
 * @param m Modulation (0: FM0, 1: M2, 2: M4, 3: M8) - Default 0
 * @param trext Pilot Tone (0: No, 1: Use) - Default 1
 * @param sel Select (0: All, 1: ~SL, 2: SL, 3: RSV) - Default 0
 */
export const buildSetQueryCmd = (
  session: number, 
  q: number, 
  target: number = 0, 
  dr: number = 0, 
  m: number = 0, 
  trext: number = 1, 
  sel: number = 0
): string => {
  // Command: BB 00 0E 00 02 [Byte1] [Byte2] [CS] 7E
  // Note: Standard Gen2 Set Query is often 0x0E, while Get is 0x0D.
  
  // Byte 1: [DR(1)][M(2)][TRext(1)][Sel(2)][Session(2)]
  // Bit 7: DR
  // Bit 6-5: M
  // Bit 4: TRext
  // Bit 3-2: Sel
  // Bit 1-0: Session
  let byte1 = 0;
  byte1 |= (dr & 0x01) << 7;
  byte1 |= (m & 0x03) << 5;
  byte1 |= (trext & 0x01) << 4;
  byte1 |= (sel & 0x03) << 2;
  byte1 |= (session & 0x03);

  // Byte 2: [Target(1)][Q(4)][Reserved(3)]
  // Bit 7: Target
  // Bit 6-3: Q
  let byte2 = 0;
  byte2 |= (target & 0x01) << 7;
  byte2 |= (q & 0x0F) << 3;

  const cmd = 0x0E;
  const plMsb = 0x00;
  const plLsb = 0x02;

  const ck = calcChecksum([cmd, plMsb, plLsb, byte1, byte2]);
  
  return `BB 00 ${toHex(cmd)} ${toHex(plMsb)} ${toHex(plLsb)} ${toHex(byte1)} ${toHex(byte2)} ${toHex(ck)} 7E`;
};

/**
 * Builds the command to set the region.
 * @param region Region Code (01: China 900MHz, 02: US, 03: EU, etc.)
 */
export const buildSetRegionCmd = (region: number): string => {
  // Command: BB 00 07 00 01 [Region] [CS] 7E
  const cmd = 0x07;
  const plMsb = 0x00;
  const plLsb = 0x01;
  const ck = calcChecksum([cmd, plMsb, plLsb, region]);
  return `BB 00 ${toHex(cmd)} ${toHex(plMsb)} ${toHex(plLsb)} ${toHex(region)} ${toHex(ck)} 7E`;
};

/**
 * Builds the command to set Auto Frequency Hopping.
 * @param enable true to enable (0xFF), false to disable (0x00)
 */
export const buildSetAutoFhCmd = (enable: boolean): string => {
  // Command: BB 00 AD 00 01 [00|FF] [CS] 7E
  const cmd = 0xAD;
  const plMsb = 0x00;
  const plLsb = 0x01;
  const val = enable ? 0xFF : 0x00;
  const ck = calcChecksum([cmd, plMsb, plLsb, val]);
  return `BB 00 ${toHex(cmd)} ${toHex(plMsb)} ${toHex(plLsb)} ${toHex(val)} ${toHex(ck)} 7E`;
};

/**
 * Builds the command to set the working channel.
 * @param channelIndex Channel Index (0-N depending on region)
 */
export const buildSetChannelCmd = (channelIndex: number): string => {
  // Command: BB 00 AB 00 01 [Index] [CS] 7E
  const cmd = 0xAB;
  const plMsb = 0x00;
  const plLsb = 0x01;
  const ck = calcChecksum([cmd, plMsb, plLsb, channelIndex]);
  return `BB 00 ${toHex(cmd)} ${toHex(plMsb)} ${toHex(plLsb)} ${toHex(channelIndex)} ${toHex(ck)} 7E`;
};

/**
 * Builds the command to get the working channel.
 */
export const buildGetChannelCmd = (): string => {
  // Command: BB 00 AA 00 00 AA 7E
  return "BB 00 AA 00 00 AA 7E";
};

/**
 * Builds the command to start multi-poll (continuous scan).
 * @param count Number of times to poll (0-65535)
 */
export const buildMultiPollCmd = (count: number): string => {
  // Command: BB 00 27 00 03 22 [CNT_H] [CNT_L] [CS] 7E
  const cmd = 0x27;
  const plMsb = 0x00;
  const plLsb = 0x03;
  const reserved = 0x22;
  const cntMsb = (count >> 8) & 0xFF;
  const cntLsb = count & 0xFF;
  
  const ck = calcChecksum([cmd, plMsb, plLsb, reserved, cntMsb, cntLsb]);
  
  return `BB 00 ${toHex(cmd)} ${toHex(plMsb)} ${toHex(plLsb)} ${toHex(reserved)} ${toHex(cntMsb)} ${toHex(cntLsb)} ${toHex(ck)} 7E`;
};

/**
 * Builds the command to stop multi-poll.
 */
export const buildStopPollCmd = (): string => {
  // Command: BB 00 28 00 00 28 7E
  return "BB 00 28 00 00 28 7E";
};
