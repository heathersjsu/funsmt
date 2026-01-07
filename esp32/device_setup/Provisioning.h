#ifndef PROVISIONING_H
#define PROVISIONING_H

#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEServer.h>
#include <ArduinoJson.h>
#include <WiFi.h>
#include <WebServer.h>

// Globals are defined in DeviceConfig.h / DeviceHttp.h
// We access them directly if this file is included after them, 
// OR we use extern if we want to be safe. 
// Since we are refactoring, let's remove externs that are now provided by DeviceConfig.h included before this.
// But to keep it valid C++, we should keep externs OR rely on the main file order.
// To be safe and cleaner, we keep using externs but remove the specific ones we don't need or rely on DeviceConfig.h

// Re-declare externs to be sure
extern String deviceId;
extern String wifiSsid;
extern String wifiPwd;
extern String supabaseUrl;
extern String anonKey;
extern String deviceJwt;
extern String caBundle;
extern bool insecureOn;
extern bool provisioned;
extern bool wifiRequested;
extern bool wifiConnecting;
extern bool httpStarted;
extern unsigned long wifiStartTs;
extern unsigned long lastWifiAttemptTs;
extern WebServer server;

extern void savePrefs();
// connectWifi is defined in DeviceConfig.h, so we can call it. 
// Wait, I defined connectWifi in DeviceConfig.h.
extern void connectWifi(const String& ssid, const String& pwd);

// BLE globals
BLEServer* bleServer = nullptr;
BLEService* bleService = nullptr;
BLECharacteristic* charWrite = nullptr;
BLECharacteristic* charNotify = nullptr;
BLECharacteristic* charReadId = nullptr;

// Buffers for multi-part data
String cfgBuf = "";
int cfgExpect = 0;
String jwtBuf = "";
int jwtExpect = 0;
String caBuf = "";
int caExpect = 0;

void notifyMsg(const String& msg) {
  if (charNotify) {
    charNotify->setValue((uint8_t*)msg.c_str(), msg.length());
    charNotify->notify();
  }
}

class WriteCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    String s = c->getValue();
    s.trim();
    Serial.println(String("[ble] onWrite len=") + String(s.length()) + " data=" + s);
    if (s.length() == 0) return;
    if (s == "PING") { notifyMsg("ACK_PING"); return; }
    if (s == "HEARTBEAT_NOW") { notifyMsg("ACK LEN"); notifyMsg("tick"); return; }
    if (s == "DEV_INSECURE_ON") { insecureOn = true; savePrefs(); return; }
    if (s == "WIFI_LIST") {
      Serial.println("[wifi] list begin");
      // If connecting, abort to allow scan
      if (wifiConnecting) {
        Serial.println("[wifi] aborting connection attempt for scan");
        wifiConnecting = false;
        WiFi.disconnect();
        delay(100);
      }
      notifyMsg("WIFI_LIST_BEGIN");
      int n = WiFi.scanNetworks();
      struct WifiEntry { String ssid; int rssi; String enc; };
      WifiEntry top[10];
      int topSize = 0;
      for (int i = 0; i < n; i++) {
        String ssid = WiFi.SSID(i);
        if (ssid.length() == 0) continue;
        int rssi = WiFi.RSSI(i);
        String enc = (WiFi.encryptionType(i) == WIFI_AUTH_OPEN) ? "OPEN" : "ENC";
        bool dup = false;
        for (int k = 0; k < topSize; k++) { if (top[k].ssid == ssid) { dup = true; break; } }
        if (dup) continue;
        int pos = topSize;
        for (int k = 0; k < topSize; k++) { if (rssi > top[k].rssi) { pos = k; break; } }
        if (topSize < 10) {
          for (int m = topSize; m > pos; m--) { top[m] = top[m - 1]; }
          top[pos].ssid = ssid; top[pos].rssi = rssi; top[pos].enc = enc;
          topSize++;
        } else if (pos < 10) {
          for (int m = 9; m > pos; m--) { top[m] = top[m - 1]; }
          top[pos].ssid = ssid; top[pos].rssi = rssi; top[pos].enc = enc;
        }
      }
      for (int k = 0; k < topSize; k++) {
        // Use compact prefix "W:" instead of "WIFI_ITEM " to save 8 bytes for payload
        String line = "W:" + top[k].ssid + "|" + String(top[k].rssi) + "|" + top[k].enc;
        notifyMsg(line);
      }
      Serial.println(String("[wifi] list end n=") + String(n) + String(" topSize=") + String(topSize));
      notifyMsg(topSize > 0 ? "WIFI_LIST_END" : "WIFI_LIST_NONE");
      return;
    }
    if (s.startsWith("SUPA_CFG_BEGIN")) {
      Serial.println("[cfg] begin");
      cfgBuf = ""; cfgExpect = s.substring(s.indexOf(' ')).toInt(); notifyMsg("ACK_RX_LEN"); return;
    }
    if (s.startsWith("SUPA_CFG_DATA")) {
      int p = s.indexOf(' ');
      p = s.indexOf(' ', p + 1);
      if (p > 0) { cfgBuf += s.substring(p + 1); }
      Serial.println(String("[cfg] data size=") + String(cfgBuf.length()));
      return;
    }
    if (s.startsWith("SUPA_CFG_END")) {
      Serial.println(String("[cfg] end total=") + String(cfgBuf.length()));
      notifyMsg("DATA_RECEIVED");
      DynamicJsonDocument doc(2048);
      DeserializationError err = deserializeJson(doc, cfgBuf);
      if (!err) {
        supabaseUrl = String(doc["supabase_url"] | "");
        anonKey = String(doc["anon"] | "");
        savePrefs();
        Serial.println("[cfg] saved supabase_url/anon");
      }
      return;
    }
    if (s.startsWith("JWT_SET_BEGIN")) {
      Serial.println("[jwt] begin");
      jwtBuf = ""; jwtExpect = s.substring(s.indexOf(' ')).toInt(); notifyMsg("ACK_RX_LEN"); return;
    }
    if (s.startsWith("JWT_SET_DATA")) {
      int p = s.indexOf(' ');
      p = s.indexOf(' ', p + 1);
      if (p > 0) { jwtBuf += s.substring(p + 1); }
      Serial.println(String("[jwt] data size=") + String(jwtBuf.length()));
      return;
    }
    if (s.startsWith("JWT_SET_END")) {
      Serial.println(String("[jwt] end total=") + String(jwtBuf.length()));
      notifyMsg("DATA_RECEIVED");
      DynamicJsonDocument doc(4096);
      DeserializationError err = deserializeJson(doc, jwtBuf);
      if (!err) {
        deviceJwt = String(doc["jwt"] | "");
        savePrefs();
        notifyMsg("ACK_JWT");
        notifyMsg("JWT_SAVED");
        Serial.println(String("[jwt] saved len=") + String(deviceJwt.length()));
      }
      return;
    }
    if (s.startsWith("CA_SET_BEGIN")) {
      Serial.println("[ca] begin");
      caBuf = ""; caExpect = s.substring(s.indexOf(' ')).toInt(); notifyMsg("ACK_RX_LEN"); return;
    }
    if (s.startsWith("CA_SET_DATA")) {
      int p = s.indexOf(' ');
      p = s.indexOf(' ', p + 1);
      if (p > 0) { caBuf += s.substring(p + 1); }
      Serial.println(String("[ca] data size=") + String(caBuf.length()));
      return;
    }
    if (s.startsWith("CA_SET_END")) {
      caBundle = caBuf; savePrefs(); notifyMsg("DATA_RECEIVED"); Serial.println(String("[ca] saved len=") + String(caBundle.length())); return;
    }
    if (s.startsWith("WIFI_SET ")) {
      String json = s.substring(9);
      Serial.println(String("[wifi] set json.len=") + String(json.length()));
      DynamicJsonDocument doc(1024);
      DeserializationError err = deserializeJson(doc, json);
      if (!err) {
        wifiSsid = String(doc["ssid"] | "");
        wifiPwd = String(doc["password"] | "");
        Serial.println(String("[wifi] set ssid=") + wifiSsid + " pwd.len=" + String(wifiPwd.length()));
        connectWifi(wifiSsid, wifiPwd);
      }
      return;
    }
    
    // RFID Test Commands via BLE
    if (s == "RFID_INFO") { notifyMsg("UART:" + testGetInfo()); return; }
    if (s == "RFID_POWER_GET") { notifyMsg("UART:" + testGetPower()); return; }
    if (s.startsWith("RFID_POWER_SET ")) { 
       int dbm = s.substring(15).toInt();
       notifyMsg("UART:" + testSetPower(dbm)); 
       return; 
    }
    if (s == "RFID_POLL_SINGLE") { notifyMsg("UART:" + testSinglePoll()); return; }
    if (s.startsWith("RFID_POLL_MULTI ")) {
       int count = s.substring(16).toInt();
       notifyMsg("UART:" + testMultiPoll(count));
       return;
    }
    if (s == "RFID_POLL_STOP") { notifyMsg("UART:" + testStopPoll()); return; }
    
    if (s == "RFID_SELECT_GET") { notifyMsg("UART:" + testGetSelectParam()); return; }
    if (s == "RFID_SELECT_SET_DEFAULT") { notifyMsg("UART:" + testSetSelectParamDefault()); return; }
    if (s.startsWith("RFID_SELECT_MODE ")) {
       int mode = s.substring(17).toInt();
       notifyMsg("UART:" + testSetSelectMode(mode));
       return;
    }
    
    if (s == "RFID_REGION_GET") { notifyMsg("UART:" + testGetRegion()); return; }
    if (s.startsWith("RFID_REGION_SET ")) {
       int r = s.substring(16).toInt();
       notifyMsg("UART:" + testSetRegion(r));
       return;
    }
    
    if (s == "RFID_CHANNEL_GET") { notifyMsg("UART:" + testGetChannel()); return; }
    if (s.startsWith("RFID_CHANNEL_SET ")) {
       int ch = s.substring(17).toInt();
       notifyMsg("UART:" + testSetChannel(ch));
       return;
    }
    
    // RFID Read/Write Data via BLE (Simplified JSON or formatted string)
    // Format: RFID_READ_DATA <ap_hex> <mb> <sa> <dl>
    if (s.startsWith("RFID_READ_DATA ")) {
       // Manual parse space separated
       String args = s.substring(15);
       int p1 = args.indexOf(' ');
       int p2 = args.indexOf(' ', p1+1);
       int p3 = args.indexOf(' ', p2+1);
       if (p1 > 0 && p2 > 0 && p3 > 0) {
         uint32_t ap = strtoul(args.substring(0, p1).c_str(), NULL, 16);
         uint8_t mb = args.substring(p1+1, p2).toInt();
         uint16_t sa = args.substring(p2+1, p3).toInt();
         uint16_t dl = args.substring(p3+1).toInt();
         notifyMsg("UART:" + testReadData(ap, mb, sa, dl));
       } else {
         notifyMsg("UART:Error: Invalid Args");
       }
       return;
    }
    
    // Format: RFID_WRITE_DATA <ap_hex> <mb> <sa> <dl> <data_hex>
    if (s.startsWith("RFID_WRITE_DATA ")) {
       String args = s.substring(16);
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
           notifyMsg("UART:" + testWriteData(ap, mb, sa, dl, buf, len/2));
           delete[] buf;
         } else {
           notifyMsg("UART:Error: Data Len Odd");
         }
       } else {
         notifyMsg("UART:Error: Invalid Args");
       }
       return;
    }
  }
};

void setupBleProvisioning() {
  Serial.println("[ble] setup begin");
  BLEDevice::init("PINME-" + deviceId.substring(deviceId.length() - 6));
  bleServer = BLEDevice::createServer();
  bleService = bleServer->createService(BLEUUID((uint16_t)0xFFF0));
  charWrite = bleService->createCharacteristic(BLEUUID((uint16_t)0xFFF1), BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
  charNotify = bleService->createCharacteristic(BLEUUID((uint16_t)0xFFF2), BLECharacteristic::PROPERTY_NOTIFY);
  charReadId = bleService->createCharacteristic(BLEUUID((uint16_t)0xFFF3), BLECharacteristic::PROPERTY_READ);
  charWrite->setCallbacks(new WriteCallbacks());
  charReadId->setValue((uint8_t*)deviceId.c_str(), deviceId.length());
  bleService->start();
  BLEAdvertising* advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(bleService->getUUID());
  advertising->start();
  Serial.println("[ble] advertising started name=" + String("PINME-") + deviceId.substring(deviceId.length() - 6));
}

void handleProvisioningLoop() {
  if (wifiRequested) {
    if (!wifiConnecting && WiFi.status() != WL_CONNECTED && (millis() - lastWifiAttemptTs > 15000)) {
      connectWifi(wifiSsid, wifiPwd);
    }
    if (wifiConnecting) {
      if (WiFi.status() == WL_CONNECTED) {
        wifiConnecting = false;
        Serial.println(String("[wifi] connected ip=") + WiFi.localIP().toString());
        notifyMsg("WIFI_OK");
        // Mark provisioned and persist credentials for next boot
        provisioned = true;
        savePrefs();
        if (!httpStarted) {
          server.begin();
          httpStarted = true;
          Serial.println("[http] server started after STA connect ip=" + WiFi.localIP().toString());
        }
      } else if (millis() - wifiStartTs > 20000) {
        wifiConnecting = false;
        WiFi.disconnect(); // Ensure we stop the ESP-IDF internal retry
        lastWifiAttemptTs = millis(); // Reset timer to enforce backoff
        
        int n = WiFi.scanNetworks();
        Serial.println(String("[wifi] connect failed, scan found n=") + String(n));
        bool found = false;
        for (int i = 0; i < n; i++) {
          String s = WiFi.SSID(i);
          if (s == wifiSsid) { found = true; break; }
        }
        if (!found) notifyMsg("WIFI_AP_NOT_FOUND");
        else notifyMsg("WIFI_AUTH_FAIL");
      }
    }
  }
}

#endif
