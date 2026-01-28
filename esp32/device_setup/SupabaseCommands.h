#ifndef SUPABASE_COMMANDS_H
#define SUPABASE_COMMANDS_H

#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include "DeviceConfig.h"
#include "PeripheralUart.h"

// Reuse the test functions declared in PeripheralUart.h

// Test Functions
// testSetQuery and testGetQuery are already defined in PeripheralUart.h


String testSetQueryRaw(uint16_t param) {
  RfidCommands::buildSetQueryRaw(param);
  sendRfidCommand(RfidCommands::cmdBuf, RfidCommands::cmdLen);
  return "Sent Success";
}

String testPollRetrySmart() {
    int maxRetry = 10;
    int retry = 0;
    String result = "";
    
    while (retry < maxRetry) {
        Serial.println("[EC] SmartPoll Retry: " + String(retry));
        
        // Poll
        RfidCommands::buildSinglePoll();
        sendRfidCommand(RfidCommands::cmdBuf, RfidCommands::cmdLen);
        result = readRfidResponse();
        
        // Check Success
        if (result.startsWith("Tag: EPC=")) {
            return result; // Success
        }
        
        // Check Code 15 (No Tag)
        // result string format from RfidParser: "Error: Code 15 (No Tag Found)"
        if (result.indexOf("Code 15") >= 0) {
            retry++;
            
            // 3rd Retry: Q=1 (Lower Q for easier hit?) 
            // Original user logic: set_query(Q=1). 
            // Let's assume DR=0, M=0, TRext=1, Sel=0, Sess=0, Tgt=0, Q=1
            // Hex: 1001? Or 1101? Let's use 1101 (S1, Q=1) to keep session logic consistent.
            if (retry == 3) {
                 Serial.println("[EC] SmartPoll: Adjusting Q=1");
                 testSetQueryRaw(0x1101); 
                 delay(50);
            }
            
            // 6th Retry: Q=0, Change Channel
            if (retry == 6) {
                 Serial.println("[EC] SmartPoll: Adjusting Q=0 & Next Channel");
                 testSetQueryRaw(0x1100); // S1, Q=0
                 delay(50);
                 // Switch Channel (Simple logic: if current < 19, +1, else 0)
                 // Since we don't track current channel easily here, let's just hop to a likely good one e.g. 5 or 10
                 // Or randomize.
                 int nextCh = random(0, 19);
                 testSetChannel(nextCh);
                 delay(50);
            }
            
            delay(100); // Wait a bit before next poll
            continue;
        }
        
        // Other Error
        return result; 
    }
    
    return "Error: Timeout (Max Retries)";
}


// Command polling interval
unsigned long lastCommandPoll = 0;
unsigned long lastHeartbeat = 0;
const unsigned long COMMAND_POLL_INTERVAL = 200; // 200ms (High Speed Polling to simulate Interrupt)
long lastExecutedId = -1;

// Continuous Polling State
bool continuousPolling = false;
String continuousCmdId = "";
unsigned long lastContinuousPoll = 0;

void handleContinuousLoop() {
    if (!continuousPolling) return;
    
    // Simple loop: Poll 30 times, report results if any
    // We don't want to block too long, but testMultiPoll(30) is blocking.
    // Given user requirement "ESP32 handles loop", blocking is acceptable if we still call yield/handleHttp.
    
    // Only poll if we have some breathing room from HTTP
    // testMultiPoll calls readRfidResponse which has timeouts.
    
    Serial.println("[EC] Continuous Poll Loop...");
    // Use smaller batch for responsiveness? User said "multipoll 30".
    String result = testMultiPoll(30);
    
    // If tags found, update DB
    if (result.indexOf("EPC=") >= 0) {
        Serial.println("[EC] Continuous: Tags Found! Updating DB...");
        
        WiFiClientSecure client;
        client.setInsecure();
        HTTPClient http;
        String url = supabaseUrl + "/rest/v1/testuart?id=eq." + continuousCmdId;
        
        if (http.begin(client, url)) {
             http.addHeader("apikey", anonKey);
             http.addHeader("Authorization", "Bearer " + (deviceJwt.length() > 0 ? deviceJwt : anonKey));
             http.addHeader("Content-Type", "application/json");
             
             DynamicJsonDocument doc(2048);
             doc["uart_result"] = result;
             // Append timestamp to debug to show liveness
             doc["uart_debug"] = "Continuous Mode Active\nLast Scan: " + String(millis()/1000) + "s\n" + result;
             
             String payload;
             serializeJson(doc, payload);
             http.PATCH(payload);
             http.end();
        }
    }
    
    // Yield to let WiFi stack process
    yield();
    // Increase delay to avoid flooding and overheating (was 100ms)
    delay(1000);
}

void markAsSkipped(String id) {
  Serial.println("[EC] Skipping old ID: " + id + ", patching DB...");
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  // PATCH /rest/v1/testuart?id=eq.id
  String url = supabaseUrl + "/rest/v1/testuart?id=eq." + id;
  if (http.begin(client, url)) {
      http.addHeader("apikey", anonKey);
      http.addHeader("Authorization", "Bearer " + (deviceJwt.length() > 0 ? deviceJwt : anonKey));
      http.addHeader("Content-Type", "application/json");
      
      int code = http.PATCH("{\"uart_result\":\"Skipped (Old)\"}");
      
      if (code == 200 || code == 204) {
         Serial.println("[EC] Skipped OK");
      } else {
         Serial.println("[EC] Skip Err: " + String(code));
      }
      http.end();
  } else {
      Serial.println("[EC] Skip Conn Err");
  }
}

String currentCmdId = "";
String asyncBatchBuffer = "";
unsigned long lastBatchSendTime = 0;
const unsigned long BATCH_SEND_INTERVAL = 1000; // 1 second batching

void processAsyncRfid() {
  // Check for incoming data
  String res = checkIncomingUart();
  
  if (res != "") {
      Serial.println("[ASYNC] " + res);
      if (asyncBatchBuffer.length() > 0) asyncBatchBuffer += "\n";
      asyncBatchBuffer += res;
  }

  // Check if we need to send batch
  // Send if:
  // 1. Buffer has data AND time interval passed
  // 2. Buffer is getting too large (> 1000 chars)
  if (asyncBatchBuffer.length() > 0 && (millis() - lastBatchSendTime > BATCH_SEND_INTERVAL || asyncBatchBuffer.length() > 1000)) {
      
      if (currentCmdId != "") {
          WiFiClientSecure client;
          client.setInsecure();
          HTTPClient http;
          String url = supabaseUrl + "/rest/v1/testuart?id=eq." + currentCmdId;
          
          if (http.begin(client, url)) {
              http.addHeader("apikey", anonKey);
              http.addHeader("Authorization", "Bearer " + (deviceJwt.length() > 0 ? deviceJwt : anonKey));
              http.addHeader("Content-Type", "application/json");
              
              DynamicJsonDocument doc(4096);
              doc["uart_result"] = asyncBatchBuffer; 
              
              String payload;
              serializeJson(doc, payload);
              int code = http.PATCH(payload);
              if (code != 200 && code != 204) {
                 Serial.println("[ASYNC] PATCH Err: " + String(code));
              } else {
                 Serial.println("[ASYNC] Batch Sent (" + String(asyncBatchBuffer.length()) + " bytes)");
              }
              http.end();
          }
      }
      
      // Clear buffer and update time
      asyncBatchBuffer = "";
      lastBatchSendTime = millis();
  }
}

void executeCommand(String cmdId, String cmdStr) {
  currentCmdId = cmdId; // Set context
  Serial.println("\n[EC] CMD: " + cmdStr);
  String result = "";
  
  // Reuse logic from Provisioning.h / PeripheralUart.h
  // We need to parse the cmdStr (e.g., "RFID_INFO", "RFID_POWER_SET 20")
  
  if (cmdStr == "RFID_INFO") {
    Serial.println("[EC] Exec: RFID_INFO");
    result = testGetInfo();
  } else if (cmdStr == "RFID_POWER_GET") {
    Serial.println("[EC] Exec: RFID_POWER_GET");
    result = testGetPower();
  } else if (cmdStr.startsWith("RFID_POWER_SET ")) {
    int dbm = cmdStr.substring(15).toInt();
    Serial.println("[EC] Exec: RFID_POWER_SET " + String(dbm));
    result = testSetPower(dbm);
  } else if (cmdStr == "RFID_POLL_SINGLE") {
    Serial.println("[EC] Exec: RFID_POLL_SINGLE");
    result = testSinglePoll();
  } else if (cmdStr.startsWith("RFID_POLL_MULTI ")) {
    int count = cmdStr.substring(16).toInt();
    Serial.println("[EC] Exec: RFID_POLL_MULTI " + String(count));
    result = testMultiPoll(count);
  } else if (cmdStr == "RFID_START_CONTINUOUS") {
    Serial.println("[EC] Exec: RFID_START_CONTINUOUS");
    continuousPolling = true;
    continuousCmdId = currentCmdId;
    result = "Continuous Mode Started";
  } else if (cmdStr == "RFID_INIT_AUTO") {
    Serial.println("[EC] Exec: RFID_INIT_AUTO");
    result = testAutoInit();
  } else if (cmdStr == "RFID_POLL_STOP") {
    Serial.println("[EC] Exec: RFID_POLL_STOP");
    continuousPolling = false;
    result = testStopPoll();
  } else if (cmdStr == "RFID_SELECT_GET") {
    Serial.println("[EC] Exec: RFID_SELECT_GET");
    result = testGetSelectParam();
  } else if (cmdStr == "RFID_SELECT_SET_DEFAULT") {
    Serial.println("[EC] Exec: RFID_SELECT_SET_DEFAULT");
    result = testSetSelectParamDefault();
  } else if (cmdStr.startsWith("RFID_SELECT_MODE ")) {
    int mode = cmdStr.substring(17).toInt();
    Serial.println("[EC] Exec: RFID_SELECT_MODE " + String(mode));
    result = testSetSelectMode(mode);
  } else if (cmdStr == "RFID_REGION_GET") {
    Serial.println("[EC] Exec: RFID_REGION_GET");
    result = testGetRegion();
  } else if (cmdStr.startsWith("RFID_REGION_SET ")) {
    int r = cmdStr.substring(16).toInt();
    Serial.println("[EC] Exec: RFID_REGION_SET " + String(r));
    result = testSetRegion(r);
  } else if (cmdStr == "RFID_QUERY_GET") {
    Serial.println("[EC] Exec: RFID_QUERY_GET");
    result = testGetQuery();
  } else if (cmdStr.startsWith("RFID_QUERY_SET ")) {
    // RFID_QUERY_SET dr m trext sel session target q
    String args = cmdStr.substring(15);
    Serial.println("[EC] Exec: RFID_QUERY_SET " + args);
    int p[7];
    int start = 0;
    bool ok = true;
    for(int i=0; i<7; i++) {
       int idx = args.indexOf(' ', start);
       if(idx == -1 && i < 6) { ok = false; break; }
       String v = (idx == -1) ? args.substring(start) : args.substring(start, idx);
       p[i] = v.toInt();
       start = idx + 1;
    }
    if (ok) {
       result = testSetQuery(p[0], p[1], p[2], p[3], p[4], p[5], p[6]);
    } else {
       result = "Error: Invalid Args";
    }
  } else if (cmdStr.startsWith("RFID_QUERY_SET_RAW ")) {
    uint16_t val = strtoul(cmdStr.substring(19).c_str(), NULL, 16);
    Serial.println("[EC] Exec: RFID_QUERY_SET_RAW " + String(val, HEX));
    result = testSetQueryRaw(val);
  } else if (cmdStr == "RFID_POLL_RETRY_SMART") {
      Serial.println("[EC] Exec: RFID_POLL_RETRY_SMART");
      result = testPollRetrySmart();
  } else if (cmdStr == "RFID_CHANNEL_GET") {
    Serial.println("[EC] Exec: RFID_CHANNEL_GET");
    result = testGetChannel();
  } else if (cmdStr.startsWith("RFID_FH_SET ")) {
    int mode = cmdStr.substring(12).toInt();
    Serial.println("[EC] Exec: RFID_FH_SET " + String(mode));
    result = testSetFreqHopping(mode);
  } else if (cmdStr == "RFID_SWAP_UART") {
    Serial.println("[EC] Exec: RFID_SWAP_UART");
    result = swapUartPins();
  } else if (cmdStr.startsWith("RFID_CHANNEL_SET ")) {
    int ch = cmdStr.substring(17).toInt();
    Serial.println("[EC] Exec: RFID_CHANNEL_SET " + String(ch));
    result = testSetChannel(ch);
  } else if (cmdStr.startsWith("RFID_READ_DATA ")) {
      // RFID_READ_DATA <ap> <mb> <sa> <dl>
      String args = cmdStr.substring(15);
      Serial.println("[EC] Exec: RFID_READ_DATA " + args);
      int p1 = args.indexOf(' ');
      int p2 = args.indexOf(' ', p1+1);
      int p3 = args.indexOf(' ', p2+1);
      if (p1 > 0 && p2 > 0 && p3 > 0) {
        uint32_t ap = strtoul(args.substring(0, p1).c_str(), NULL, 16);
        uint8_t mb = args.substring(p1+1, p2).toInt();
        uint16_t sa = args.substring(p2+1, p3).toInt();
        uint16_t dl = args.substring(p3+1).toInt();
        result = testReadData(ap, mb, sa, dl);
      } else {
        result = "Error: Invalid Args";
      }
  } else if (cmdStr.startsWith("RFID_WRITE_DATA ")) {
      // RFID_WRITE_DATA <ap> <mb> <sa> <dl> <data>
      String args = cmdStr.substring(16);
      Serial.println("[EC] Exec: RFID_WRITE_DATA " + args);
      int p1 = args.indexOf(' ');
      int p2 = args.indexOf(' ', p1+1);
      int p3 = args.indexOf(' ', p2+1);
      int p4 = args.indexOf(' ', p3+1);
      if (p1 > 0 && p2 > 0 && p3 > 0 && p4 > 0) {
        uint32_t ap = strtoul(args.substring(0, p1).c_str(), NULL, 16);
        uint8_t mb = args.substring(p1+1, p2).toInt();
        uint16_t sa = args.substring(p2+1, p3).toInt();
        uint16_t dl = args.substring(p3+1, p4).toInt();
        String dataHex = args.substring(p4+1);
        int len = dataHex.length();
        if (len % 2 == 0) {
           uint8_t* buf = new uint8_t[len/2];
           for(int i=0; i<len; i+=2) {
             char tmp[3] = {dataHex[i], dataHex[i+1], 0};
             buf[i/2] = strtoul(tmp, NULL, 16);
           }
           result = testWriteData(ap, mb, sa, dl, buf, len/2);
           delete[] buf;
        } else {
           result = "Error: Data Len Odd";
        }
      } else {
        result = "Error: Invalid Args";
      }
  } else if (cmdStr.startsWith("BB")) {
      // Raw Hex Command: BB ...
      Serial.println("[EC] Exec: Raw Hex " + cmdStr);
      String hex = cmdStr;
      hex.replace(" ", ""); // Remove spaces
      int len = hex.length();
      if (len % 2 != 0) {
          result = "Error: Odd Hex Length";
      } else {
          uint8_t* buf = new uint8_t[len/2];
          for(int i=0; i<len; i+=2) {
               char tmp[3] = {hex[i], hex[i+1], 0};
               buf[i/2] = strtoul(tmp, NULL, 16);
          }
          sendRfidCommand(buf, len/2);
          delete[] buf;
          result = readRfidResponse();
      }
  } else {
    result = "Error: Unknown Command";
  }

  Serial.println("[EC] Result: " + result);
  
  // Update the existing testuart row with the result
  {
    Serial.println("[EC] PATCH...");
    WiFiClientSecure client;
    client.setInsecure();
    HTTPClient http;
    // PATCH /rest/v1/testuart?id=eq.cmdId
    String url = supabaseUrl + "/rest/v1/testuart?id=eq." + cmdId;
    if (http.begin(client, url)) {
      http.addHeader("apikey", anonKey);
      http.addHeader("Authorization", "Bearer " + (deviceJwt.length() > 0 ? deviceJwt : anonKey));
      http.addHeader("Content-Type", "application/json");
      
      DynamicJsonDocument doc(2048);
      doc["uart_result"] = result;
      String combined = "CMD: " + cmdStr + "\nTX: " + lastUartTxHex + "\nRX: " + lastUartRxHex + "\nResult: " + result;
      doc["uart_debug"] = combined;
      
      String payload;
      serializeJson(doc, payload);
      int patchCode = http.PATCH(payload);
      
      if (patchCode == 200 || patchCode == 204) {
         Serial.println("[EC] PATCH OK");
      } else {
         Serial.println("[EC] PATCH ERR: " + String(patchCode));
      }

      http.end();
    } else {
       Serial.println("[EC] PATCH CONN ERR");
    }
  }
}

// Removed vector to save space
// #include <vector>

struct PendingCmd {
  String id;
  String cmd;
};

void handleCommandLoop() {
  // Always check for incoming UART data from Reader (Monitor Mode)
  processAsyncRfid();

  // Throttled heartbeat to confirm loop is running and ID matches
  if (millis() - lastHeartbeat > 10000) {
      lastHeartbeat = millis();
      String status = "OK";
      if (!provisioned) status = "Not Provisioned";
      else if (WiFi.status() != WL_CONNECTED) status = "WiFi Disconnected";
      
      // Serial.println("[EC] Heartbeat: Polling Supabase for " + deviceId + " Status: " + status);
  }

  if (!provisioned || WiFi.status() != WL_CONNECTED) return;
  if (millis() - lastCommandPoll < COMMAND_POLL_INTERVAL) return;
  lastCommandPoll = millis();

  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  
  // GET pending commands from testuart (order by id asc to execute in sequence)
  String base = supabaseUrl;
  if (base.endsWith("/")) base.remove(base.length() - 1);
  // Default: Get PENDING commands
  String url = base + "/rest/v1/testuart?device_id=eq." + deviceId + "&uart_result=eq.PENDING&select=id,uart_debug&order=id.asc";
  
  // CRITICAL FIX: Only fetch commands newer than what we've already processed/skipped.
  // This prevents infinite loops if the DB update (Skip) fails due to RLS.
  if (lastExecutedId > -1) {
      url += "&id=gt." + String(lastExecutedId);
  } else {
      // First boot: Do NOT execute all old pending commands.
      // We only want commands created AFTER we booted.
      
      // Implementing the "Clear Queue on Boot" logic:
      if (lastExecutedId == -1) {
          Serial.println("[EC] First Poll: Ignoring old PENDING commands...");
          
          // Give network stack some time to settle, especially if we just connected
          delay(500);
          yield();
          
          // Strategy: Fetch the single latest command ID (whether pending or not)
          // and set lastExecutedId to it.
          
          // Let's do a special query to get the max ID currently in DB for this device
          // url = ... &limit=1&order=id.desc
          
          // REUSE the client/http objects to avoid double allocation (which crashes ESP32)
          String initUrl = base + "/rest/v1/testuart?device_id=eq." + deviceId + "&select=id&limit=1&order=id.desc";
          
          if (http.begin(client, initUrl)) {
               http.addHeader("apikey", anonKey);
               http.addHeader("Authorization", "Bearer " + (deviceJwt.length() > 0 ? deviceJwt : anonKey));
               int code = http.GET();
               if (code == 200) {
                   String resp = http.getString();
                   // resp is like [{"id": 123}]
                   int firstBracket = resp.indexOf(":");
                   int lastBracket = resp.indexOf("}");
                   if (firstBracket > 0 && lastBracket > firstBracket) {
                       String idStr = resp.substring(firstBracket + 1, lastBracket);
                       lastExecutedId = idStr.toInt();
                       Serial.println("[EC] Queue Cleared. Latest ID: " + String(lastExecutedId));
                   }
               }
               http.end();
          }
          // If this fails, we stay at -1.
          // Return to avoid executing anything in this cycle
          return;
      }
  }
  
  // Debug URL to check for malformed parameters
  // Serial.println("[EC] GET: " + url);

  // Use fixed array instead of vector to reduce binary size
  #define MAX_PENDING_CMDS 10
  PendingCmd commandsToProcess[MAX_PENDING_CMDS];
  int cmdCount = 0;
  bool hasCommands = false;

  if (http.begin(client, url)) {
    http.addHeader("apikey", anonKey);
    http.addHeader("Authorization", "Bearer " + (deviceJwt.length() > 0 ? deviceJwt : anonKey));
    
    int code = http.GET();
    if (code == 200) {
      String resp = http.getString();
      if (resp != "[]") {
        DynamicJsonDocument doc(4096); // Increased buffer for 10 commands
        DeserializationError error = deserializeJson(doc, resp);
        if (!error) {
          JsonArray arr = doc.as<JsonArray>();
          int total = arr.size();
          if (total > 0) {
             hasCommands = true;
             Serial.println("[EC] Found " + String(total) + " pending.");
             for (JsonObject obj : arr) {
                if (cmdCount < MAX_PENDING_CMDS) {
                  commandsToProcess[cmdCount].id = obj["id"].as<String>();
                  commandsToProcess[cmdCount].cmd = obj["uart_debug"].as<String>();
                  cmdCount++;
                } else {
             Serial.println("[EC] Warning: Too many pending commands, processing first " + String(MAX_PENDING_CMDS));
                  break;
                }
             }
          }
        }
      }
    } else {
      Serial.println("[EC] GET Error: " + String(code) + " " + http.errorToString(code));
      if (code > 0) Serial.println("[EC] Resp: " + http.getString());
    }
    // IMPORTANT: Close the GET connection BEFORE opening new connections for PATCH
    http.end();
  } else {
     Serial.println("[EC] GET Failed (Conn/HTTP) - Check Network/URL");
  }

  // Now process the commands
  if (hasCommands && cmdCount > 0) {
     
     // Special handling for backlog or first run: 
     // If we have many commands (backlog) or it's the first run, 
     // we might want to skip old ones and only execute the latest (or skip all on boot).
     
     // Strategy: 
      // 1. If it's the FIRST run (Boot), skip ALL commands to clear backlog.
      // 2. If it's a normal run, execute ALL commands in sequence (Initialization sends 5 cmds).
      
      long maxId = -1;
      
      // Find max ID for updating lastExecutedId later
      for(int i=0; i<cmdCount; i++) {
         long cid = commandsToProcess[i].id.toInt();
         if(cid > maxId) maxId = cid;
      }
      
      if (lastExecutedId == -1) {
          // --- BOOT / FIRST RUN: SKIP ALL ---
          String idsToSkip = "";
          for(int i=0; i<cmdCount; i++) {
             if (i > 0) idsToSkip += ",";
             idsToSkip += commandsToProcess[i].id;
          }
          
          Serial.println("[EC] Boot Cleanup: Skipping IDs: " + idsToSkip);
          WiFiClientSecure client;
          client.setInsecure();
          HTTPClient http;
          String url = supabaseUrl + "/rest/v1/testuart?id=in.(" + idsToSkip + ")";
          if (http.begin(client, url)) {
             http.addHeader("apikey", anonKey);
             http.addHeader("Authorization", "Bearer " + (deviceJwt.length() > 0 ? deviceJwt : anonKey));
             http.addHeader("Content-Type", "application/json");
             http.PATCH("{\"uart_result\":\"Skipped (Boot Cleanup)\"}");
             http.end();
          }
          
          // Update lastExecutedId so we don't fetch them again
          lastExecutedId = maxId;
          Serial.println("[EC] Boot Synced lastExecutedId to " + String(maxId));
          
      } else {
          // --- NORMAL RUN: EXECUTE ALL ---
          for (int i = 0; i < cmdCount; i++) {
             PendingCmd cmd = commandsToProcess[i];
             long cmdId = cmd.id.toInt();
             
             // Double check it's new (should be guaranteed by GET params, but safety first)
             if (cmdId > lastExecutedId) {
                Serial.println("[EC] Exec ID: " + cmd.id);
                executeCommand(cmd.id, cmd.cmd);
                lastExecutedId = cmdId;
             }
          }
      }
  }
}

#endif
