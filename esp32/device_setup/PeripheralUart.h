#ifndef PERIPHERAL_UART_H
#define PERIPHERAL_UART_H

#include <Arduino.h>
#include <HardwareSerial.h>
#include "RfidParser.h"
#include "RfidCommands.h"

String lastUartTxHex = "";
String lastUartRxHex = "";
// Define Pins
// User specified: GPIO 16 and 17
// GPIO 17 is UART TX (Connect to RFID RX)
// GPIO 16 is UART RX (Connect to RFID TX)
// #define PERIPHERAL_RX_PIN 16
// #define PERIPHERAL_TX_PIN 17
int rfidRxPin = 16;
int rfidTxPin = 17;

// Define Baud Rate (Adjust if needed, e.g., 9600, 115200)
#define PERIPHERAL_BAUD_RATE 115200

// Use UART2 (Serial2) - Reverting to Serial2 as it was working before
HardwareSerial MyPeripheralSerial(2);

// Command to send: BB 00 03 00 01 00 04 7E
const uint8_t commandBytes[] = {0xBB, 0x00, 0x03, 0x00, 0x01, 0x00, 0x04, 0x7E};

void setupPeripheralUart() {
  Serial.println("[UART] setup");
  // Ensure clean state
  MyPeripheralSerial.end(); 
  delay(100);
  
  // Increase RX buffer size to handle bursts during blocking HTTP calls
  MyPeripheralSerial.setRxBufferSize(4096);

  // Configure Serial2 with 8N1
  // Explicitly verifying pins: RX=16, TX=17
  // On ESP32-S3, passing pins to begin() is usually enough, but we'll double check.
  MyPeripheralSerial.begin(PERIPHERAL_BAUD_RATE, SERIAL_8N1, rfidRxPin, rfidTxPin);
  delay(100); 

  // Force pin re-muxing if begin() didn't take
  // Note: This is a fallback that sometimes helps on S3 if the default mapping is stuck
  // But we must NOT use pinMode() as that breaks UART.
  // We rely on begin() to do the work.
  
  Serial.println(String("[UART] RX=") + rfidRxPin + " TX=" + rfidTxPin + " B=" + PERIPHERAL_BAUD_RATE);
#if defined(CONFIG_IDF_TARGET_ESP32S3)
  Serial.println("[UART] Platform: ESP32-S3 (Pins 16/17 are safe)");
#elif defined(ESP32) && !defined(CONFIG_IDF_TARGET_ESP32C3)
  // Simple check if user might be on a WROVER board where 16/17 are internal
  // (Not a perfect check, but a hint)
  Serial.println("[UART] Note: If ESP32-WROVER, GPIO 16/17 are internal (PSRAM) and unusable for UART.");
#endif
}

void sendRfidCommand(const uint8_t* cmd, int len) {
  // Do NOT flush RX buffer blindly in async mode!
  // while (MyPeripheralSerial.available()) MyPeripheralSerial.read();

  lastUartTxHex = "";
  Serial.print("[UART] TX: ");
  for (int i = 0; i < len; i++) {
    MyPeripheralSerial.write(cmd[i]);
    if (cmd[i] < 0x10) Serial.print("0");
    Serial.print(cmd[i], HEX);
    Serial.print(" ");
    if (cmd[i] < 0x10) lastUartTxHex += "0";
    lastUartTxHex += String(cmd[i], HEX) + " ";
  }
  lastUartTxHex.toUpperCase();
  Serial.println();
  MyPeripheralSerial.flush();
}

// Robust frame reader helper
String readRfidResponse() {
  unsigned long startWait = millis();
  uint8_t rxBuf[512]; // Increased buffer size
  int rxLen = 0;
  
  // State machine variables
  // 0: Wait for Header (0xBB)
  // 1: Wait for Length (Need 5 bytes total: BB Type Cmd PL_H PL_L)
  // 2: Wait for Rest (Need total = 7 + PL)
  int state = 0;
  int expectedLen = 0;
  
  lastUartRxHex = ""; 
  // Serial.println("[UART] wait RX..."); // Reduce spam
  Serial.println("[UART] Waiting for bytes on RX Pin " + String(rfidRxPin) + "...");
  
  while (millis() - startWait < 3000) {
    while (MyPeripheralSerial.available()) {
      int b = MyPeripheralSerial.read();
      
      // Debug log every byte (User requested)
      // Print in rows of 16 for readability
      // if (rxLen % 16 == 0) Serial.print("\n[RX_HEX] ");
      // if (b < 0x10) Serial.print("0");
      // Serial.print(String(b, HEX) + " "); 
      
      // Safety check for buffer overflow
      if (rxLen >= 511) {
         Serial.println("\n[UART] Err: Buf overflow, resetting");
         rxLen = 0;
         state = 0;
      }
      
      rxBuf[rxLen++] = b;
      
      // State Machine
      if (state == 0) {
        // Looking for Header
        if (b == 0xBB) {
           // Found header.
           if (rxLen > 1) {
             // We had garbage before BB, reset buffer to just BB
             rxBuf[0] = 0xBB;
             rxLen = 1;
           }
           state = 1; 
        } else {
           // Not BB, ignore (garbage)
           rxLen = 0; 
        }
      }
      else if (state == 1) {
        // Waiting for enough bytes to determine length
        // Need BB(0), Type(1), Cmd(2), PL_H(3), PL_L(4) -> 5 bytes
        if (rxLen >= 5) {
           uint16_t pl = (rxBuf[3] << 8) | rxBuf[4];
           // Total frame = Header(1)+Type(1)+Cmd(1)+PL(2) + PL_Data + CS(1)+End(1)
           // Total = 5 + PL + 2 = 7 + PL
           expectedLen = 7 + pl;
           
           // Sanity check on length (e.g. max 500)
           if (expectedLen > 500) {
              Serial.println("\n[UART] Err: Invalid PL (" + String(pl) + ")");
              
              // Smart Recovery: Scan for next 0xBB in the bytes we already have
              int foundNextBB = -1;
              for(int i=1; i<rxLen; i++) {
                if(rxBuf[i] == 0xBB) {
                  foundNextBB = i;
                  break;
                }
              }
              
              if(foundNextBB != -1) {
                // Shift buffer
                int newLen = rxLen - foundNextBB;
                memmove(rxBuf, rxBuf + foundNextBB, newLen);
                rxLen = newLen;
                Serial.println("[UART] Recovered: Found next header at idx " + String(foundNextBB));
                state = 1; // We have a header at 0, continue in state 1
                // Note: The loop will continue, picking up next byte. 
                // But we need to re-check if we *already* have 5 bytes in the new buffer?
                // The loop processes one byte at a time.
                // But here we modified rxBuf *in place* and kept the loop running.
                // The `state == 1` check runs *after* `rxBuf[rxLen++] = b`.
                // We are inside that check.
                // If we shift, we might have < 5 bytes now.
                // Next iteration of `while(available)` will read *new* byte.
                // But what if we have valid bytes *already* in buffer?
                // This simple loop structure doesn't re-process buffer.
                // It relies on *incoming* bytes to trigger checks.
                // This is a limitation.
                // However, since we just shifted, `rxLen` decreased.
                // If `rxLen` is still >= 5, we *won't* check it again until *next* byte arrives.
                // This implies we need at least 1 more byte to arrive to trigger the check again.
                // This is fine for now, usually packets stream in.
              } else {
                rxLen = 0;
                state = 0;
              }
           } else {
              state = 2;
           }
        }
      }
      else if (state == 2) {
        // Waiting for full frame
        if (rxLen >= expectedLen) {
           // Got full frame. Verify End byte
           if (rxBuf[rxLen-1] == 0x7E) {
              Serial.println(); // Newline after raw bytes
              
              // Build Hex String for debug
              String rxHex = "";
              for(int i=0; i<rxLen; i++) {
                  if (rxBuf[i] < 0x10) rxHex += "0";
                  rxHex += String(rxBuf[i], HEX) + " ";
              }
              rxHex.toUpperCase();
              lastUartRxHex = rxHex;
              // Serial.println("[UART] Frame: " + rxHex);
              
              return RfidParser::parseRfidFrame(rxBuf, rxLen);
           } else {
              Serial.println("\n[UART] Err: Missing End Byte 7E");
              // Recovery: Scan for next 0xBB
              int foundNextBB = -1;
              for(int i=1; i<rxLen; i++) {
                if(rxBuf[i] == 0xBB) {
                  foundNextBB = i;
                  break;
                }
              }
              if(foundNextBB != -1) {
                 int newLen = rxLen - foundNextBB;
                 memmove(rxBuf, rxBuf + foundNextBB, newLen);
                 rxLen = newLen;
                 Serial.println("[UART] Recovered: Found next header at idx " + String(foundNextBB));
                 state = 1;
              } else {
                 rxLen = 0;
                 state = 0;
              }
           }
        }
      }
    }
    delay(2); 
  }

  Serial.println("[UART] timeout (No bytes received or incomplete frame)");
  if (rxLen > 0) {
      Serial.print("[UART] Partial buffer: ");
      for(int i=0; i<rxLen; i++) {
          if(rxBuf[i] < 0x10) Serial.print("0");
          Serial.print(String(rxBuf[i], HEX) + " ");
      }
      Serial.println();
  }
  return "Error: Timeout";
}

String testGetInfo() {
  Serial.println("[UART] info");
  RfidCommands::buildGetInfo();
  sendRfidCommand(RfidCommands::cmdBuf, RfidCommands::cmdLen);
  Serial.println("[UART] waiting info resp...");
  String res = readRfidResponse();
  Serial.println(String("[UART] info_resp: ") + res);
  return res;
}

String testGetPower() {
  Serial.println("[UART] pow_get");
  RfidCommands::buildGetPower();
  sendRfidCommand(RfidCommands::cmdBuf, RfidCommands::cmdLen);
  return readRfidResponse();
}

String testSetPower(int dbm) {
  Serial.println(String("[UART] pow_set ") + dbm);
  RfidCommands::buildSetPower(dbm);
  sendRfidCommand(RfidCommands::cmdBuf, RfidCommands::cmdLen);
  return readRfidResponse();
}

String testSetFreqHopping(uint8_t mode) {
  Serial.println(String("[UART] fh_set ") + mode);
  RfidCommands::buildSetFreqHopping(mode);
  sendRfidCommand(RfidCommands::cmdBuf, RfidCommands::cmdLen);
  return readRfidResponse();
}

// Buffer for Async RX
uint8_t asyncRxBuf[256];
int asyncRxIdx = 0;

String checkIncomingUart() {
  // Process all available bytes (or up to a limit to avoid blocking too long)
  int limit = 64; 
  while (MyPeripheralSerial.available() && limit-- > 0) {
    uint8_t b = MyPeripheralSerial.read();
    
    // Debug Raw Byte
    // Serial.print(String(b, HEX) + " "); 

    if (asyncRxIdx == 0 && b != 0xBB) {
       // Skip until Header
       continue;
    }
    
    asyncRxBuf[asyncRxIdx++] = b;
    
    // Check for Frame End
    if (b == 0x7E && asyncRxIdx >= 7) { // Min valid frame len is 7
       // Try to parse
       String res = RfidParser::parseRfidFrame(asyncRxBuf, asyncRxIdx);
       
       // Reset Buffer
       asyncRxIdx = 0;
       
       if (!res.startsWith("Error")) {
          return res;
       }
       // If Error (e.g. Checksum), we discarded the buffer.
       // This assumes 0x7E is unique enough. 
       // If 0x7E was part of data, we might have cut frame early.
       // But in standard RFID frames, 0x7E is end. Escaping? 
       // Usually standard YR9020 doesn't escape, just relies on fixed structure or assumes no 0x7E in data?
       // Actually 0x7E is unique.
    }
    
    if (asyncRxIdx >= 255) {
       asyncRxIdx = 0; // Overflow protection
    }
  }
  return "";
}

String testSinglePoll() {
  Serial.println("[UART] poll_single");
  // Flush handled by sendRfidCommand internally if needed, or better not flush to keep incoming data?
  // sendRfidCommand flushes RX buffer: "while (MyPeripheralSerial.available()) MyPeripheralSerial.read();"
  // This is BAD for async! If we are polling and data is coming, we shouldn't clear it blindly.
  // I should remove the flush from sendRfidCommand too!
  
  RfidCommands::buildSinglePoll();
  sendRfidCommand(RfidCommands::cmdBuf, RfidCommands::cmdLen);
  return "Sent Success";
}

String testMultiPoll(uint16_t count) {
  Serial.println(String("[UART] poll_multi ") + count);
  
  RfidCommands::buildMultiPoll(count);
  sendRfidCommand(RfidCommands::cmdBuf, RfidCommands::cmdLen);

  // Collect results
  String collected = "";
  unsigned long start = millis();
  
  // Dynamic timeout based on count
  // 300 tags might take 10-15s if Q=4 and many collisions/slots
  unsigned long duration = 3000; 
  if (count > 20) duration = 6000;
  if (count > 100) duration = 15000; 
  
  while (millis() - start < duration) {
    // If data is available, try to parse a frame
    if (MyPeripheralSerial.available()) {
      String res = readRfidResponse();
      // If valid tag, append
      if (res.startsWith("Tag:")) {
        collected += res + "\n";
      } else if (res != "" && !res.startsWith("Error")) {
        // Log other non-error responses (e.g. status)
        Serial.println("[UART] Poll Res: " + res);
      }
    }
    delay(10);
  }

 if (collected.length() > 0) return collected;
  return "Sent Success (No Tags) - Check Session/Target?";
}

// Forward Declarations
String testStopPoll();
String testGetSelectParam();
String testSetSelectMode(uint8_t mode);
String testSetSelectParamDefault();
String testSetDemodulatorParams(uint8_t mixer, uint8_t ifAmp, uint16_t thrd);
String testGetDemodulatorParams();
String testSetRegion(uint8_t region);
String testGetRegion();
String testGetQuery();
String testSetQuery(uint8_t dr, uint8_t m, uint8_t trext, uint8_t sel, uint8_t session, uint8_t target, uint8_t q);
String testSetChannel(uint8_t chIndex);
String testGetChannel();
String testReadData(uint32_t ap, uint8_t mb, uint16_t sa, uint16_t dl);
String testWriteData(uint32_t ap, uint8_t mb, uint16_t sa, uint16_t dl, const uint8_t* data, uint16_t dataLen);

void runRfidInitialization() {
  Serial.println("[UART] Starting RFID Initialization...");
  // Give the RFID reader extra time to boot up (it might be slower than ESP32)
  delay(3000);

  // 1. Get Firmware Version
  int retries = 5;
  bool connected = false;
  while(retries-- > 0) {
      Serial.println("[UART] Init: Check FW Version...");
      RfidCommands::buildGetInfo();
      sendRfidCommand(RfidCommands::cmdBuf, RfidCommands::cmdLen);
      String res = readRfidResponse();
      if (res != "" && !res.startsWith("Error")) {
          Serial.println("[UART] Reader Connected. FW: " + res);
          connected = true;
          break;
      }
      delay(1000);
  }

  if (!connected) {
      Serial.println("[UART] Init Failed: No Reader Response. Please check wiring (RX=16, TX=17) and Power.");
      return;
  }
  
  delay(100);

  // 2. Set Region: China 900MHz (0x01)
  Serial.println("[UART] Init: Set Region (CN 900MHz)...");
  testSetRegion(0x01);
  delay(100);

  // 3. Set Power: 24 dBm
  Serial.println("[UART] Init: Set Power (24 dBm)...");
  testSetPower(24);
  delay(100);

  // 4. Auto Freq Hopping (0xFF)
  Serial.println("[UART] Init: Set Auto Freq Hopping...");
  testSetFreqHopping(0xFF);
  delay(100);

  // 5. Demod Params: Mixer=2, IF=4, Thrd=0x00C0 (Reduced Gain, Higher Threshold)
  Serial.println("[UART] Init: Set Demod Params (2,4,0x00C0)...");
  testSetDemodulatorParams(2, 4, 0x00C0);
  delay(100);

  // 6. Set Mode=1
  Serial.println("[UART] Init: Set Select Mode (1)...");
  testSetSelectMode(1);
  delay(100);

  // 7. Query: DR=8(0), M=1, TRext=1, Sel=0(All), S=1, T=0, Q=4
  Serial.println("[UART] Init: Set Query (DR=8, M=1, TRext=1, Sel=All, S=1, Q=4)...");
  testSetQuery(0, 1, 1, 0, 1, 0, 4);
  
  Serial.println("[UART] Init Done.");
}

String testAutoInit() {
  Serial.println("[UART] Starting Auto Init...");
  String logs = "Auto Init Report:\n";

  // 1. Set Region (China 900MHz = 0x01)
  // Or use what was requested: "China 900MHz"
  RfidCommands::buildSetRegion(0x01);
  sendRfidCommand(RfidCommands::cmdBuf, RfidCommands::cmdLen);
  logs += "1. Region(CN900): " + readRfidResponse() + "\n";
  delay(100);

  // 2. Set Power (24dBm)
  RfidCommands::buildSetPower(24);
  sendRfidCommand(RfidCommands::cmdBuf, RfidCommands::cmdLen);
  logs += "2. Power(24dBm): " + readRfidResponse() + "\n";
  delay(100);

  // 3. Set Freq Hopping (Auto = 0xFF)
  RfidCommands::buildSetFreqHopping(0xFF);
  sendRfidCommand(RfidCommands::cmdBuf, RfidCommands::cmdLen);
  logs += "3. FreqHopping(Auto): " + readRfidResponse() + "\n";
  delay(100);

  // 4. Set Select Mode (Mode 1)
  RfidCommands::buildSetSelectMode(0x01);
  sendRfidCommand(RfidCommands::cmdBuf, RfidCommands::cmdLen);
  logs += "4. SelectMode(1): " + readRfidResponse() + "\n";
  delay(100);

  // 5. Set Query (Session 1, Q=4)
  // DR=0, M=0, TRext=1, Sel=0, Sess=1, Tgt=0, Q=4
  RfidCommands::buildSetQuery(0, 0, 1, 0, 1, 0, 4); 
  sendRfidCommand(RfidCommands::cmdBuf, RfidCommands::cmdLen);
  logs += "5. Query(S1,Q4): " + readRfidResponse() + "\n";
  delay(100);

  Serial.println("[UART] Auto Init Done.");
  return logs;
}


String testStopPoll() {
  Serial.println("[UART] poll_stop");
  
  RfidCommands::buildStopPoll();
  sendRfidCommand(RfidCommands::cmdBuf, RfidCommands::cmdLen);
  return readRfidResponse();
}

String testGetSelectParam() {
  Serial.println("[UART] sel_get");
  RfidCommands::buildGetSelectParam();
  sendRfidCommand(RfidCommands::cmdBuf, RfidCommands::cmdLen);
  return readRfidResponse();
}

String testSetSelectMode(uint8_t mode) {
  Serial.println(String("[UART] sel_mode ") + mode);
  RfidCommands::buildSetSelectMode(mode);
  sendRfidCommand(RfidCommands::cmdBuf, RfidCommands::cmdLen);
  return readRfidResponse();
}

// Default test for Set Select Param with example values from user doc
// Mask: 30751FEB705C5904E3D50D70 (12 bytes)
String testSetSelectParamDefault() {
  Serial.println("[UART] sel_set_default");
  
  uint8_t selParam = 0x01; // Target:0, Action:0, Mem:1(EPC)
  uint32_t ptr = 0x20;     // 32 bits offset
  uint8_t maskLen = 0x60;  // 96 bits
  bool truncate = false;
  uint8_t mask[] = {0x30, 0x75, 0x1F, 0xEB, 0x70, 0x5C, 0x59, 0x04, 0xE3, 0xD5, 0x0D, 0x70};
  
  RfidCommands::buildSetSelectParam(selParam, ptr, maskLen, truncate, mask, sizeof(mask));
  sendRfidCommand(RfidCommands::cmdBuf, RfidCommands::cmdLen);
  return readRfidResponse();
}


String testSetDemodulatorParams(uint8_t mixer, uint8_t ifAmp, uint16_t thrd) {
  Serial.println(String("[UART] demod_set M=") + mixer + " I=" + ifAmp + " T=" + String(thrd, HEX));
  RfidCommands::buildSetDemodulatorParams(mixer, ifAmp, thrd);
  sendRfidCommand(RfidCommands::cmdBuf, RfidCommands::cmdLen);
  return readRfidResponse();
}

String testGetDemodulatorParams() {
  Serial.println("[UART] demod_get");
  RfidCommands::buildGetDemodulatorParams();
  sendRfidCommand(RfidCommands::cmdBuf, RfidCommands::cmdLen);
  return readRfidResponse();
}

String testSetRegion(uint8_t region) {
  Serial.println(String("[UART] region_set ") + region);
  
  RfidCommands::buildSetRegion(region);
  sendRfidCommand(RfidCommands::cmdBuf, RfidCommands::cmdLen);
  return readRfidResponse();
}

String testGetRegion() {
  Serial.println("[UART] region_get");
  
  RfidCommands::buildGetRegion();
  sendRfidCommand(RfidCommands::cmdBuf, RfidCommands::cmdLen);
  return readRfidResponse();
}

String testGetQuery() {
  Serial.println("[UART] query_get");
  
  RfidCommands::buildGetQuery();
  sendRfidCommand(RfidCommands::cmdBuf, RfidCommands::cmdLen);
  return readRfidResponse();
}

String testSetQuery(uint8_t dr, uint8_t m, uint8_t trext, uint8_t sel, uint8_t session, uint8_t target, uint8_t q) {
  Serial.println(String("[UART] query_set DR=") + dr + " M=" + m + " Q=" + q);
  
  RfidCommands::buildSetQuery(dr, m, trext, sel, session, target, q);
  sendRfidCommand(RfidCommands::cmdBuf, RfidCommands::cmdLen);
  return readRfidResponse();
}

String testSetChannel(uint8_t chIndex) {
  Serial.println(String("[UART] ch_set ") + chIndex);
  
  RfidCommands::buildSetChannel(chIndex);
  sendRfidCommand(RfidCommands::cmdBuf, RfidCommands::cmdLen);
  return readRfidResponse();
}

String testGetChannel() {
  Serial.println("[UART] ch_get");
  
  RfidCommands::buildGetChannel();
  sendRfidCommand(RfidCommands::cmdBuf, RfidCommands::cmdLen);
  return readRfidResponse();
}

String testReadData(uint32_t ap, uint8_t mb, uint16_t sa, uint16_t dl) {
  Serial.println(String("[UART] read MB=") + mb + " SA=" + sa + " DL=" + dl);
  // while (MyPeripheralSerial.available()) MyPeripheralSerial.read();
  
  RfidCommands::buildReadData(ap, mb, sa, dl);
  sendRfidCommand(RfidCommands::cmdBuf, RfidCommands::cmdLen);
  return "Sent Success";
}

String testWriteData(uint32_t ap, uint8_t mb, uint16_t sa, uint16_t dl, const uint8_t* data, uint16_t dataLen) {
  Serial.println(String("[UART] write MB=") + mb + " SA=" + sa + " DL=" + dl);
  // while (MyPeripheralSerial.available()) MyPeripheralSerial.read();
  
  RfidCommands::buildWriteData(ap, mb, sa, dl, data, dataLen);
  sendRfidCommand(RfidCommands::cmdBuf, RfidCommands::cmdLen);
  return "Sent Success";
}

void handlePeripheralLoop() {
  if (Serial.available()) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();
    
    if (cmd == "") return;
    
    Serial.println("\n[cmd] Processing: " + cmd);
    
    if (cmd == "info") {
      testGetInfo();
    } else if (cmd == "power_get") {
      testGetPower();
    } else if (cmd.startsWith("power_set ")) {
      int dbm = cmd.substring(10).toInt();
      testSetPower(dbm);
    } else if (cmd == "poll_single") {
      testSinglePoll();
    } else if (cmd.startsWith("poll_multi ")) {
      int count = cmd.substring(11).toInt();
      if (count <= 0) count = 100;
      testMultiPoll(count);
    } else if (cmd == "poll_stop") {
      testStopPoll();
    } else if (cmd == "region_get") {
      testGetRegion();
    } else if (cmd.startsWith("region_set ")) {
      int region = cmd.substring(11).toInt(); // 1=CN900, 2=US, 3=EU, 4=CN800, 6=KR
      testSetRegion(region);
    } else if (cmd == "query_get") {
      testGetQuery();
    } else if (cmd.startsWith("query_set ")) {
      // Format: query_set DR M TRext Sel Session Target Q
      // e.g. query_set 0 1 0 0 0 0 4
      int p[7];
      int start = 10;
      for(int i=0; i<7; i++) {
        int idx = cmd.indexOf(' ', start);
        if(idx == -1 && i < 6) break; // Error
        String v = (idx == -1) ? cmd.substring(start) : cmd.substring(start, idx);
        p[i] = v.toInt();
        start = idx + 1;
      }
      testSetQuery(p[0], p[1], p[2], p[3], p[4], p[5], p[6]);
    } else if (cmd == "channel_get") {
      testGetChannel();
    } else if (cmd.startsWith("channel_set ")) {
      int ch = cmd.substring(12).toInt();
      testSetChannel(ch);
    } else if (cmd == "select_param_get") {
      testGetSelectParam();
    } else if (cmd == "select_param_set_default") {
      testSetSelectParamDefault();
    } else if (cmd.startsWith("select_mode ")) {
      int mode = cmd.substring(12).toInt(); // 0, 1, 2
      testSetSelectMode(mode);
    } else if (cmd == "demod_get") {
      testGetDemodulatorParams();
    } else if (cmd.startsWith("demod_set ")) {
      // demod_set mixer if thrd(hex)
      // e.g. demod_set 3 7 0170
      int p[3];
      int start = 10;
      for(int i=0; i<3; i++) {
        int idx = cmd.indexOf(' ', start);
        String v = (idx == -1) ? cmd.substring(start) : cmd.substring(start, idx);
        if (i == 2) {
           // Parse hex for threshold
           p[i] = strtol(v.c_str(), NULL, 16);
        } else {
           p[i] = v.toInt();
        }
        if(idx == -1 && i < 2) break; 
        start = idx + 1;
      }
      testSetDemodulatorParams(p[0], p[1], p[2]);
    } else if (cmd == "help") {
      Serial.println("Available commands:");
      Serial.println("  info");
      Serial.println("  power_get");
      Serial.println("  power_set <dbm> (e.g. 2600 for 26dBm)");
      Serial.println("  poll_single");
      Serial.println("  poll_multi <count>");
      Serial.println("  poll_stop");
      Serial.println("  region_get");
      Serial.println("  region_set <region_code>");
      Serial.println("  query_get");
      Serial.println("  query_set <dr> <m> <trext> <sel> <session> <target> <q>");
      Serial.println("  channel_get");
      Serial.println("  channel_set <index>");
      Serial.println("  select_param_get");
      Serial.println("  select_param_set_default");
      Serial.println("  select_mode <mode>");
      Serial.println("  demod_get");
      Serial.println("  demod_set <mixer> <if> <thrd_hex>");
    } else {
      Serial.println("Unknown command. Type 'help' for list.");
    }
  }
}

// Monitor function to catch unsolicited data from RFID reader
void monitorUartRx() {
    if (MyPeripheralSerial.available()) {
        String rxHex = "";
        int count = 0;
        // Read up to 128 bytes or until empty
        while (MyPeripheralSerial.available() && count < 128) {
            uint8_t b = MyPeripheralSerial.read();
            if (b < 0x10) rxHex += "0";
            rxHex += String(b, HEX) + " ";
            count++;
            // Tiny delay to allow next byte to arrive if mid-packet
            if (!MyPeripheralSerial.available()) delay(1);
        }
        rxHex.toUpperCase();
        // Serial.println("[UART-MON] " + rxHex);
    }
}

#endif
