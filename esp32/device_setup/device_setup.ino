#include <WiFi.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <time.h>
#include <Preferences.h>
#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEServer.h>
#include <ArduinoJson.h>
#include <esp_system.h>

Preferences prefs;
WebServer server(80);

BLEServer* bleServer = nullptr;
BLEService* bleService = nullptr;
BLECharacteristic* charWrite = nullptr;
BLECharacteristic* charNotify = nullptr;
BLECharacteristic* charReadId = nullptr;

String deviceId = "";
String wifiSsid = "";
String wifiPwd = "";
String supabaseUrl = "";
String anonKey = "";
String deviceJwt = "";
String caBundle = "";
bool insecureOn = false;
const char* fwVersion = "1.0.0";

String cfgBuf = "";
int cfgExpect = 0;
String jwtBuf = "";
int jwtExpect = 0;
String caBuf = "";
int caExpect = 0;
bool wifiConnecting = false;
unsigned long wifiStartTs = 0;
unsigned long lastWifiAttemptTs = 0;
bool httpStarted = false;
bool wifiRequested = false;
bool provisioned = false;

String toUpperHex(uint8_t* mac) {
  char buf[13];
  snprintf(buf, sizeof(buf), "%02X%02X%02X%02X%02X%02X", mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  return String(buf);
}

String deriveDeviceId() {
  uint8_t mac[6];
  WiFi.macAddress(mac);
  String hex = toUpperHex(mac);
  // User requirement: Unified use of pinme_ prefix
  return String("pinme_") + hex.substring(6);
}

void notifyMsg(const String& msg) {
  if (charNotify) {
    charNotify->setValue((uint8_t*)msg.c_str(), msg.length());
    charNotify->notify();
  }
}

void savePrefs() {
  Serial.println("[prefs] saving...");
  prefs.begin("pinme", false);
  prefs.putString("supabase_url", supabaseUrl);
  prefs.putString("anon_key", anonKey);
  prefs.putString("device_jwt", deviceJwt);
  prefs.putString("ca_bundle", caBundle);
  prefs.putBool("insecure_on", insecureOn);
  prefs.putString("wifi_ssid", wifiSsid);
  prefs.putString("wifi_pwd", wifiPwd);
  prefs.putBool("provisioned", provisioned);
  prefs.end();
  Serial.println("[prefs] saved:");
  Serial.println(String("  supabase_url=") + supabaseUrl);
  Serial.println(String("  anon_key.len=") + String(anonKey.length()));
  Serial.println(String("  device_jwt.len=") + String(deviceJwt.length()));
  Serial.println(String("  ca_bundle.len=") + String(caBundle.length()));
  Serial.println(String("  insecure_on=") + String(insecureOn ? "true" : "false"));
  Serial.println(String("  wifi_ssid=") + wifiSsid);
  Serial.println(String("  provisioned=") + String(provisioned ? "true" : "false"));
}

void loadPrefs() {
  Serial.println("[prefs] loading...");
  prefs.begin("pinme", true);
  supabaseUrl = prefs.getString("supabase_url", "");
  anonKey = prefs.getString("anon_key", "");
  deviceJwt = prefs.getString("device_jwt", "");
  caBundle = prefs.getString("ca_bundle", "");
  insecureOn = prefs.getBool("insecure_on", false);
  wifiSsid = prefs.getString("wifi_ssid", "");
  wifiPwd = prefs.getString("wifi_pwd", "");
  provisioned = prefs.getBool("provisioned", false);
  prefs.end();
  Serial.println("[prefs] loaded:");
  Serial.println(String("  supabase_url=") + supabaseUrl);
  Serial.println(String("  anon_key.len=") + String(anonKey.length()));
  Serial.println(String("  device_jwt.len=") + String(deviceJwt.length()));
  Serial.println(String("  ca_bundle.len=") + String(caBundle.length()));
  Serial.println(String("  insecure_on=") + String(insecureOn ? "true" : "false"));
  Serial.println(String("  wifi_ssid=") + wifiSsid);
  Serial.println(String("  provisioned=") + String(provisioned ? "true" : "false"));
}

void connectWifi(const String& ssid, const String& pwd) {
  Serial.println(String("[wifi] connect begin ssid=") + ssid);
  notifyMsg("WIFI_CONNECTING");
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid.c_str(), pwd.c_str());
  wifiConnecting = true;
  wifiStartTs = millis();
  lastWifiAttemptTs = wifiStartTs;
  wifiRequested = true;
}

void handleInfo() {
  Serial.println("[http] /info");
  DynamicJsonDocument doc(1024);
  doc["device_id"] = deviceId;
  doc["wifi_ssid"] = wifiSsid;
  doc["ip"] = WiFi.isConnected() ? WiFi.localIP().toString() : "";
  doc["fw_version"] = fwVersion;
  doc["uptime_s"] = (uint32_t)(millis() / 1000);
  doc["free_heap"] = (uint32_t)ESP.getFreeHeap();
  doc["wifi_signal"] = (WiFi.status() == WL_CONNECTED) ? WiFi.RSSI() : 0;
  String out; serializeJson(doc, out);
  server.send(200, "application/json", out);
}

void handleTextEndpoint(const char* name) {
  String t = server.hasArg("text") ? server.arg("text") : (server.hasArg("message") ? server.arg("message") : "");
  Serial.println(String("[http] /") + name + " text=" + t);
  server.send(200, "text/plain", String(name) + ": " + t);
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
  }
};

void setupBle() {
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

void setupHttp() {
  Serial.println("[http] setup begin");
  server.on("/info", handleInfo);
  server.on("/debug", [](){ handleTextEndpoint("debug"); });
  server.on("/lcd", [](){ handleTextEndpoint("lcd"); });
  server.on("/notify", [](){ handleTextEndpoint("notify"); });
  // defer server.begin until Wi‑Fi/AP is initialized
}

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n[boot] setup begin");
  deviceId = deriveDeviceId();
  Serial.println(String("[boot] deviceId=") + deviceId);
  loadPrefs();
  // Ensure network stack is initialized before starting HTTP server
  WiFi.mode(WIFI_AP_STA);
  String apName = String("PINME-") + deviceId.substring(deviceId.length() - 6);
  bool apOk = WiFi.softAP(apName.c_str());
  Serial.println(String("[wifi] AP start name=") + apName + String(" ok=") + String(apOk ? "true" : "false"));
  setupBle();
  setupHttp();
  // Start HTTP server now that AP is up
  server.begin();
  httpStarted = true;
  Serial.println("[http] server started at AP ip=" + WiFi.softAPIP().toString());
  // If already provisioned previously, auto-connect to saved Wi‑Fi after boot
  if (provisioned && wifiSsid.length() > 0) {
    connectWifi(wifiSsid, wifiPwd);
  }
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  Serial.println("[boot] setup done");
}

void loop() {
  server.handleClient();
  static unsigned long lastHeartbeat = 0;
  if (millis() - lastHeartbeat > 20000) {
    lastHeartbeat = millis();
    if (provisioned && WiFi.status() == WL_CONNECTED) {
      WiFiClientSecure client;
      if (insecureOn) client.setInsecure();
      else if (caBundle.length() > 0) client.setCACert(caBundle.c_str());
      else client.setInsecure(); // Default fallback

      HTTPClient http;
      http.setTimeout(10000); // Increase timeout to 10s to avoid -11 errors
      String url = supabaseUrl + "/rest/v1/devices?device_id=eq." + deviceId;
      if (http.begin(client, url)) {
        http.addHeader("apikey", anonKey);
        http.addHeader("Authorization", "Bearer " + (deviceJwt.length() > 0 ? deviceJwt : anonKey));
        http.addHeader("Content-Type", "application/json");
        // http.addHeader("Prefer", "return=minimal"); // Removed to avoid 400 Bad Request on PATCH with body
        http.addHeader("Prefer", "return=representation"); // Optional: returns the updated row

        DynamicJsonDocument doc(256);
        // doc["status"] = "online"; // Status is managed by DB trigger (online) and cron (offline)
        doc["wifi_signal"] = WiFi.RSSI();
        doc["wifi_ssid"] = wifiSsid;
        
        time_t now; time(&now);
        struct tm timeinfo;
        if (localtime_r(&now, &timeinfo) && timeinfo.tm_year > (2020 - 1900)) {
           char timeBuf[32];
           strftime(timeBuf, sizeof(timeBuf), "%Y-%m-%dT%H:%M:%SZ", gmtime(&now));
           doc["last_seen"] = timeBuf;
        }

        String payload;
        serializeJson(doc, payload);
        Serial.println("[http] sending patch: " + payload); // Debug payload
        int code = http.PATCH(payload);
        if (code >= 200 && code < 300) {
          Serial.println("heartbeat sent");
        } else {
          String resp = http.getString();
          Serial.println(String("heartbeat error code=") + code + " resp=" + resp);
        }
        http.end();
      }
    }
  }
  // Non-blocking Wi‑Fi connect/poll
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
  delay(10);
}
