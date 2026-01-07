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
#define PERIPHERAL_RX_PIN 16
#define PERIPHERAL_TX_PIN 17

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
  
  // Configure Serial2 with 8N1
  // Explicitly verifying pins: RX=16, TX=17
  // On ESP32-S3, passing pins to begin() is usually enough, but we'll double check.
  MyPeripheralSerial.begin(PERIPHERAL_BAUD_RATE, SERIAL_8N1, PERIPHERAL_RX_PIN, PERIPHERAL_TX_PIN);
  delay(100); 

  // Force pin re-muxing if begin() didn't take
  // Note: This is a fallback that sometimes helps on S3 if the default mapping is stuck
  // But we must NOT use pinMode() as that breaks UART.
  // We rely on begin() to do the work.
  
  Serial.println(String("[UART] RX=") + PERIPHERAL_RX_PIN + " TX=" + PERIPHERAL_TX_PIN + " B=" + PERIPHERAL_BAUD_RATE);
#if defined(CONFIG_IDF_TARGET_ESP32S3)
  Serial.println("[UART] Platform: ESP32-S3 (Pins 16/17 are safe)");
#elif defined(ESP32) && !defined(CONFIG_IDF_TARGET_ESP32C3)
  // Simple check if user might be on a WROVER board where 16/17 are internal
  // (Not a perfect check, but a hint)
  Serial.println("[UART] Note: If ESP32-WROVER, GPIO 16/17 are internal (PSRAM) and unusable for UART.");
#endif
}

void sendRfidCommand(const uint8_t* cmd, int len) {
  while (MyPeripheralSerial.available()) MyPeripheralSerial.read();

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

// Helper to wait and read response
String readRfidResponse() {
  unsigned long startWait = millis();
  uint8_t rxBuf[256];
  int rxLen = 0;
  bool anyData = false;
  
  lastUartRxHex = ""; // Clear previous RX
  Serial.println("[UART] wait RX...");
  
  // Wait up to 3000ms (Increased again for safety)
  while (millis() - startWait < 3000) {
    while (MyPeripheralSerial.available()) {
      anyData = true;
      int b = MyPeripheralSerial.read();
      
      // Simple debug print for EVERY byte received
      // Serial.print(String(b, HEX) + " "); 

      if (rxLen < 255) {
        rxBuf[rxLen++] = b;
      }
      // If we found the end byte 0x7E, we might be done. 
      // But let's verify min length (at least 6 bytes for a valid frame)
      if (b == 0x7E && rxLen >= 6) {
         goto frame_received; // Break out of both loops
      }
    }
    delay(2); // Short yield
  }

  if (rxLen > 0) {
    Serial.print("[UART] Partial RX: ");
    for(int i=0; i<rxLen; i++) Serial.print(String(rxBuf[i], HEX) + " ");
    Serial.println();
  } else if (anyData) {
    Serial.println("[UART] Data detected but not stored?");
  }
  return "Error: Timeout";

frame_received:
  if (rxLen > 0) {
    String rxHex = "";
    for(int i=0; i<rxLen; i++) {
        if (rxBuf[i] < 0x10) rxHex += "0";
        rxHex += String(rxBuf[i], HEX) + " ";
    }
    rxHex.toUpperCase();
    lastUartRxHex = rxHex;
    Serial.println("[UART] RX(" + String(rxLen) + "): " + rxHex);
    return parseRfidFrame(rxBuf, rxLen);
  } else {
    Serial.println("[UART] timeout RX=" + String(PERIPHERAL_RX_PIN));
    return "Error: Timeout";
  }
}

String testGetInfo() {
  Serial.println("[UART] info");
  while (MyPeripheralSerial.available()) MyPeripheralSerial.read();
  
  RfidCommands::buildGetInfo();
  sendRfidCommand(RfidCommands::cmdBuf, RfidCommands::cmdLen);
  return readRfidResponse();
}

String testGetPower() {
  Serial.println("[UART] pow_get");
  while (MyPeripheralSerial.available()) MyPeripheralSerial.read();
  
  RfidCommands::buildGetPower();
  sendRfidCommand(RfidCommands::cmdBuf, RfidCommands::cmdLen);
  return readRfidResponse();
}

String testSetPower(int dbm) {
  Serial.println(String("[UART] pow_set ") + dbm);
  while (MyPeripheralSerial.available()) MyPeripheralSerial.read();
  
  RfidCommands::buildSetPower(dbm);
  sendRfidCommand(RfidCommands::cmdBuf, RfidCommands::cmdLen);
  return readRfidResponse();
}

String testSinglePoll() {
  Serial.println("[UART] poll_single");
  while (MyPeripheralSerial.available()) MyPeripheralSerial.read();
  
  RfidCommands::buildSinglePoll();
  sendRfidCommand(RfidCommands::cmdBuf, RfidCommands::cmdLen);
  return readRfidResponse();
}

String testMultiPoll(uint16_t count) {
  Serial.println(String("[UART] poll_multi ") + count);
  while (MyPeripheralSerial.available()) MyPeripheralSerial.read();
  
  RfidCommands::buildMultiPoll(count);
  sendRfidCommand(RfidCommands::cmdBuf, RfidCommands::cmdLen);
  
  // For Multi-poll, we might receive many notifications.
  // This helper currently reads just one frame or timeout.
  // We'll read the first response (notification or error) to confirm start.
  // In a real app, we'd need a continuous loop or interrupt handler.
  return readRfidResponse();
}

String testStopPoll() {
  Serial.println("[UART] poll_stop");
  while (MyPeripheralSerial.available()) MyPeripheralSerial.read();
  
  RfidCommands::buildStopPoll();
  sendRfidCommand(RfidCommands::cmdBuf, RfidCommands::cmdLen);
  return readRfidResponse();
}

String testGetSelectParam() {
  Serial.println("[UART] sel_get");
  while (MyPeripheralSerial.available()) MyPeripheralSerial.read();
  
  RfidCommands::buildGetSelectParam();
  sendRfidCommand(RfidCommands::cmdBuf, RfidCommands::cmdLen);
  return readRfidResponse();
}

String testSetSelectMode(uint8_t mode) {
  Serial.println(String("[UART] sel_mode ") + mode);
  while (MyPeripheralSerial.available()) MyPeripheralSerial.read();
  
  RfidCommands::buildSetSelectMode(mode);
  sendRfidCommand(RfidCommands::cmdBuf, RfidCommands::cmdLen);
  return readRfidResponse();
}

// Default test for Set Select Param with example values from user doc
// Mask: 30751FEB705C5904E3D50D70 (12 bytes)
String testSetSelectParamDefault() {
  Serial.println("[UART] sel_set_default");
  while (MyPeripheralSerial.available()) MyPeripheralSerial.read();
  
  uint8_t selParam = 0x01; // Target:0, Action:0, Mem:1(EPC)
  uint32_t ptr = 0x20;     // 32 bits offset
  uint8_t maskLen = 0x60;  // 96 bits
  bool truncate = false;
  uint8_t mask[] = {0x30, 0x75, 0x1F, 0xEB, 0x70, 0x5C, 0x59, 0x04, 0xE3, 0xD5, 0x0D, 0x70};
  
  RfidCommands::buildSetSelectParam(selParam, ptr, maskLen, truncate, mask, sizeof(mask));
  sendRfidCommand(RfidCommands::cmdBuf, RfidCommands::cmdLen);
  return readRfidResponse();
}

String testSetRegion(uint8_t region) {
  Serial.println(String("[UART] region_set ") + region);
  while (MyPeripheralSerial.available()) MyPeripheralSerial.read();
  
  RfidCommands::buildSetRegion(region);
  sendRfidCommand(RfidCommands::cmdBuf, RfidCommands::cmdLen);
  return readRfidResponse();
}

String testGetRegion() {
  Serial.println("[UART] region_get");
  while (MyPeripheralSerial.available()) MyPeripheralSerial.read();
  
  RfidCommands::buildGetRegion();
  sendRfidCommand(RfidCommands::cmdBuf, RfidCommands::cmdLen);
  return readRfidResponse();
}

String testGetQuery() {
  Serial.println("[UART] query_get");
  while (MyPeripheralSerial.available()) MyPeripheralSerial.read();
  
  RfidCommands::buildGetQuery();
  sendRfidCommand(RfidCommands::cmdBuf, RfidCommands::cmdLen);
  return readRfidResponse();
}

String testSetQuery(uint8_t dr, uint8_t m, uint8_t trext, uint8_t sel, uint8_t session, uint8_t target, uint8_t q) {
  Serial.println(String("[UART] query_set DR=") + dr + " M=" + m + " Q=" + q);
  while (MyPeripheralSerial.available()) MyPeripheralSerial.read();
  
  RfidCommands::buildSetQuery(dr, m, trext, sel, session, target, q);
  sendRfidCommand(RfidCommands::cmdBuf, RfidCommands::cmdLen);
  return readRfidResponse();
}

String testSetChannel(uint8_t chIndex) {
  Serial.println(String("[UART] ch_set ") + chIndex);
  while (MyPeripheralSerial.available()) MyPeripheralSerial.read();
  
  RfidCommands::buildSetChannel(chIndex);
  sendRfidCommand(RfidCommands::cmdBuf, RfidCommands::cmdLen);
  return readRfidResponse();
}

String testGetChannel() {
  Serial.println("[UART] ch_get");
  while (MyPeripheralSerial.available()) MyPeripheralSerial.read();
  
  RfidCommands::buildGetChannel();
  sendRfidCommand(RfidCommands::cmdBuf, RfidCommands::cmdLen);
  return readRfidResponse();
}

String testReadData(uint32_t ap, uint8_t mb, uint16_t sa, uint16_t dl) {
  Serial.println(String("[UART] read MB=") + mb + " SA=" + sa + " DL=" + dl);
  while (MyPeripheralSerial.available()) MyPeripheralSerial.read();
  
  RfidCommands::buildReadData(ap, mb, sa, dl);
  sendRfidCommand(RfidCommands::cmdBuf, RfidCommands::cmdLen);
  return readRfidResponse();
}

String testWriteData(uint32_t ap, uint8_t mb, uint16_t sa, uint16_t dl, const uint8_t* data, uint16_t dataLen) {
  Serial.println(String("[UART] write MB=") + mb + " SA=" + sa + " DL=" + dl);
  while (MyPeripheralSerial.available()) MyPeripheralSerial.read();
  
  RfidCommands::buildWriteData(ap, mb, sa, dl, data, dataLen);
  sendRfidCommand(RfidCommands::cmdBuf, RfidCommands::cmdLen);
  return readRfidResponse();
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
    } else {
      Serial.println("Unknown command. Type 'help' for list.");
    }
  }
}

#endif
