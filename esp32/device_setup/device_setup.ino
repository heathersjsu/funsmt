// Pinme ESP32 Combined Firmware
// Features:
// 1) BLE SPP (Service FFF0; RX=FFF1 write, TX=FFF2 notify/read, ID=FFF3 read)
// 2) Wi-Fi provisioning via BLE (WIFI_LIST / WIFI_SET / WIFI_CLEAR)
// 3) JWT provisioning via BLE (JWT_SET or JSON {"jwt":"..."}; supports Base64 JSON)
// 4) Periodic HTTPS heartbeat PATCH to Supabase PostgREST /rest/v1/devices
//    Payload: { wifi_signal, wifi_ssid, status }
//    Headers: apikey (Anon key), Authorization: Bearer <device_jwt>
//    TLS: ISRG Root X1 (Let's Encrypt) or setInsecure() fallback for dev

#include <Arduino.h>
#include <ArduinoJson.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEServer.h>
#include <BLE2902.h>
#include "mbedtls/base64.h"

// ========== UUID 定义 ==========
#define SERVICE_UUID            "0000fff0-0000-1000-8000-00805f9b34fb"
#define CHARACTERISTIC_UUID_RX  "0000fff1-0000-1000-8000-00805f9b34fb" // 手机 → ESP32
#define CHARACTERISTIC_UUID_TX  "0000fff2-0000-1000-8000-00805f9b34fb" // ESP32 → 手机
#define CHARACTERISTIC_UUID_ID  "0000fff3-0000-1000-8000-00805f9b34fb" // 设备ID（只读）

BLECharacteristic *pTxCharacteristic = nullptr;
BLECharacteristic *pIdCharacteristic = nullptr;
BLECharacteristic *pRxCharacteristic = nullptr;
BLEServer *pServer = nullptr;
bool deviceConnected = false;
volatile bool wifiEventsInitialized = false;
unsigned long lastHeartbeatMs = 0;
unsigned long lastWifiRetryMs = 0; // 未连接时每 30 秒尝试
Preferences prefs;

String gSavedSsid = "";
String gSavedPwd = "";
String gStoredJwt = "";
String gSupabaseUrl = "https://kjitkkeerytijbcgkqjj.supabase.co"; // 可通过 BLE 配置覆盖
String gAnonKey = ""; // 建议由 App 通过 BLE 下发（或在编译期写死）。

// Let’s Encrypt ISRG Root X1 (PEM)
static const char ISRG_ROOT_X1[] PROGMEM = R"PEM(
-----BEGIN CERTIFICATE-----
MIIFazCCA1OgAwIBAgISA6D9Z3Y6F2nFvF5JtQFo0WbfMA0GCSqGSIb3DQEBCwUA
MDIxCzAJBgNVBAYTAlVTMRUwEwYDVQQKEwxJbnRlcm5ldCBTZWN1cml0eTEWMBQG
A1UEAxMNSVNSRyBSb290IFgxMB4XDTIwMDkyNDE2MjEwMFoXDTMwMDkyNDE2MjEw
MFowMjELMAkGA1UEBhMCVVMxFTATBgNVBAoTDEludGVybmV0IFNlY3VyaXR5MRYw
FAYDVQQDEw1JU1JHIFJvb3QgWDEwggIiMA0GCSqGSIb3DQEBAQUAA4ICDwAwggIK
AoICAQCx4nSPrLhksqM9QwBhdn+KeQZXpAnuGz2nPgYRZt2rG3fLIBcJ0/tK8Kf0
zMxDk9qs9dZpyQIOW8DkJ17hYGdS9YV4rjzNpZL0D9WwQn8YH52UjU/0vYBxnYxy
oYVgCkIxK6gtIR2vESSK/j1qHlaRZsJRfVQp8P2OGDiGzq4r1lYwLFvyEEL3V9eQ
LhYh0cV+Z9Ph3YdB8X9bYqC8B+0y2tQWQ6JmQkB0m4gEWm2ZfCkK1POb54Q3zg0l
Q3T9e3iC3bJY7kQ4lPj0m5+0VnZJ8vP8fSypwV+6m3jOJe7n0kI3qk0EwMZQg4qE
uRw9b7S6/3rLwYh3vR0XK8nY2HkWg6wq1cXkYg6PXgCeqC9PSuZyG2n8kYgHcF0E
e7kQH1V0+Vj7WKjK2YBqR0B1z1xENiQfA14pIYpDk9kUnxjQ3BfGODOtYtgGZ3zQ
z1YwZkEBAQwAzUiYtYqHfQGdS6PGo9vJ+JObb1mG2m3T4g+cQFvG4OoIO9aYzJz5
1tJX8vXxLkA2HkF2Lr4nRzKxJzBuQAfw/8r8uJXHT5bgwS6d6k3T9gKkD7Q6pJgG
5PZVdC9bHAAyDq1rZpH/DK1hVq8uI7XzGQfzFfCzPLb6tKxWqTt1pK9vBkbQYwq3
oE3F0vQq2p6pHqfA0UQm7cLZr1+WlQIDAQABo0IwQDAOBgNVHQ8BAf8EBAMCAQYw
DwYDVR0TAQH/BAUwAwEB/zAdBgNVHQ4EFgQUYQ8eG0bkY8S8rBVUXbQw9w5i0gkw
DQYJKoZIhvcNAQELBQADggIBABO2HRf+YQjW7GkS6d+G0a9iDUGgquB9iQb14q4A
vS1xS6iX7bXbQ9FMyG17YkK1zvhP7suOa6m3QzYJwJw+O9WmDkqOQ6s1E1hSkO3C
Wqj1i9g1rQ7k+K2PYoD9o8f3YpQFzS73gBqFhPm6F9y6iHcfk6oNu5F3o5F3r3Yy
qM9bE3YwWqkQvTnRloK5XzQ0k2lD7Pl1rK9BfQWvczM8BqXUzaNf4p5eZl1bYzqH
7w9BPUzhF5Z4YtYQ7C8q2nQH2eJxw0VwNQCl0Y8A5Z0lD8bR6zXxQy7TtX4vQhp8
bf0XcC7pZpXvYkKXlVtK2vz7bIh9XF0iZFYJ7rEoQbJzYBr9B6iV3ZBa2GQrRjWZ
9JH5ZpVbV2jY4dQfG3L2OXJ9Rk6ecbD7dg1vYfJ6k2wFSF2PbmG0qG1F8s3Zr3gJ
M6cZShTqDTC6QvWZ6uJ8o4WJYvEw+fH0gM0YHkv0xvVhSxV7WQxM2kqUeKJdFvJm
QwKxE+Zl6nZfYH+3Zg8VwV7UeGqRkz7p6lN9PVaU1j4nqkU2Cq2P5wU5j2VqPUqQ
1fXwU3N6Jg6lXbYwM1d8VhDWkJv7QzG9NvVb2y7G8QJpQK0O5f5qfQ==
-----END CERTIFICATE-----
)PEM";

// ========== 工具函数 ==========
String macToShortId() {
  uint64_t mac = ESP.getEfuseMac();
  uint32_t low = (uint32_t)(mac & 0xFFFFFFFF);
  char buf[16];
  snprintf(buf, sizeof(buf), "%08X", low);
  return String(buf);
}

String getDeviceId() {
  String shortId = macToShortId();
  String suffix = shortId.substring(max(0, (int)shortId.length() - 6));
  suffix.toUpperCase();
  return String("ESP32_") + suffix;
}

bool looksBase64(const String& s) {
  if (s.length() == 0 || (s.length() % 4) != 0) return false;
  for (size_t i = 0; i < s.length(); ++i) {
    char c = s[i];
    bool ok = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
              (c >= '0' && c <= '9') || c == '+' || c == '/' || c == '=';
    if (!ok) return false;
  }
  return true;
}

String base64DecodeToString(const String& b64) {
  size_t outLen = 0;
  size_t allocLen = (b64.length() / 4) * 3 + 4;
  std::unique_ptr<unsigned char[]> out(new unsigned char[allocLen]);
  int ret = mbedtls_base64_decode(out.get(), allocLen, &outLen,
                                  (const unsigned char*)b64.c_str(), b64.length());
  if (ret == 0) {
    return String((const char*)out.get(), outLen);
  } else {
    return String("");
  }
}

void txNotify(const String& msg) {
  if (!pTxCharacteristic) return;
  pTxCharacteristic->setValue(msg.c_str());
  pTxCharacteristic->notify();
}

String encTypeToStr(wifi_auth_mode_t auth) {
  switch (auth) {
    case WIFI_AUTH_OPEN: return "OPEN";
    case WIFI_AUTH_WEP: return "WEP";
    case WIFI_AUTH_WPA_PSK: return "WPA_PSK";
    case WIFI_AUTH_WPA2_PSK: return "WPA2_PSK";
    case WIFI_AUTH_WPA_WPA2_PSK: return "WPA/WPA2_PSK";
    case WIFI_AUTH_WPA2_ENTERPRISE: return "WPA2_ENT";
    case WIFI_AUTH_WPA3_PSK: return "WPA3_PSK";
    case WIFI_AUTH_WPA2_WPA3_PSK: return "WPA2/WPA3_PSK";
    default: return "UNKNOWN";
  }
}

void notifyWifiListTop5() {
  txNotify("WIFI_LIST_BEGIN");
  Serial.println("🔎 WIFI_LIST: scanning...");
  int n = WiFi.scanNetworks();
  if (n <= 0) {
    Serial.println("⚠️ No networks found");
    txNotify("WIFI_LIST_NONE");
    txNotify("WIFI_LIST_END");
    return;
  }
  const int MAX_ITEMS = 5;
  bool selected[50];
  int maxCheck = min(50, n);
  for (int i = 0; i < maxCheck; ++i) selected[i] = false;
  int emitted = 0;
  while (emitted < MAX_ITEMS) {
    int bestIdx = -1;
    int bestRssi = -9999;
    for (int i = 0; i < maxCheck; ++i) {
      if (selected[i]) continue;
      int rssi = WiFi.RSSI(i);
      if (rssi > bestRssi) { bestRssi = rssi; bestIdx = i; }
    }
    if (bestIdx == -1) break;
    selected[bestIdx] = true;
    String ssid = WiFi.SSID(bestIdx);
    int rssi = WiFi.RSSI(bestIdx);
    wifi_auth_mode_t enc = (wifi_auth_mode_t)WiFi.encryptionType(bestIdx);
    String encStr = encTypeToStr(enc);
    String line = String("WIFI_ITEM ") + ssid + "|" + String(rssi) + "|" + encStr;
    txNotify(line);
    Serial.println(line);
    emitted++;
  }
  txNotify(String("WIFI_LIST_COUNT ") + String(n));
  txNotify("WIFI_LIST_END");
}

void setupWifiEvents() {
  if (wifiEventsInitialized) return;
  WiFi.onEvent([](WiFiEvent_t event, WiFiEventInfo_t info){
    switch (event) {
      case ARDUINO_EVENT_WIFI_STA_CONNECTED:
        Serial.println("📡 WiFi STA connected to AP");
        txNotify("WIFI_STA_CONNECTED");
        break;
      case ARDUINO_EVENT_WIFI_STA_GOT_IP:
        Serial.printf("🌐 Got IP: %s\n", WiFi.localIP().toString().c_str());
        txNotify("WIFI_OK");
        break;
      case ARDUINO_EVENT_WIFI_STA_DISCONNECTED: {
        int r = info.wifi_sta_disconnected.reason;
        Serial.printf("⚠️ WiFi STA disconnected, reason=%d\n", r);
        if (r == WIFI_REASON_AUTH_EXPIRE || r == WIFI_REASON_AUTH_LEAVE || r == WIFI_REASON_4WAY_HANDSHAKE_TIMEOUT || r == WIFI_REASON_HANDSHAKE_TIMEOUT) {
          txNotify("WIFI_AUTH_FAIL");
        } else if (r == WIFI_REASON_NO_AP_FOUND) {
          txNotify("WIFI_AP_NOT_FOUND");
        } else {
          String msg = String("WIFI_DISCONNECTED_REASON_") + String(r);
          txNotify(msg);
        }
        break;
      }
      default:
        break;
    }
  });
  wifiEventsInitialized = true;
}

class MyServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *pServer) override {
    deviceConnected = true;
    Serial.println("✅ BLE connected");
    delay(500);
    txNotify("HELLO");
    txNotify(String("ID ") + getDeviceId());
  }
  void onDisconnect(BLEServer *pServer) override {
    deviceConnected = false;
    Serial.println("❌ BLE disconnected, restart advertising");
    BLEDevice::startAdvertising();
  }
};

void connectToWiFi(const char* ssid, const char* password) {
  Serial.printf("📶 Connecting to Wi-Fi: %s\n", ssid);
  txNotify("WIFI_CONNECTING");
  setupWifiEvents();
  WiFi.disconnect(true, true);
  delay(200);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(ssid, password);
  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 50) {
    delay(500);
    tries++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("✅ Wi-Fi connected. IP=%s RSSI=%d\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
    txNotify("WIFI_OK");
  } else {
    Serial.println("❌ Wi-Fi connect failed");
    txNotify("WIFI_FAIL");
  }
}

// ======== Heartbeat ========
String jsonEscape(const String& s) {
  String out;
  for (size_t i = 0; i < s.length(); ++i) {
    char c = s.charAt(i);
    if (c == '"' || c == '\\') { out += '\\'; }
    out += c;
  }
  return out;
}

String buildPatchBody(int wifiSignal, const String& wifiSsid, const String& status) {
  String body = "{";
  body += "\"wifi_signal\":" + String(wifiSignal) + ",";
  body += "\"wifi_ssid\":\"" + jsonEscape(wifiSsid) + "\",";
  body += "\"status\":\"" + jsonEscape(status) + "\"";
  body += "}";
  return body;
}

bool patchDeviceStatusOnce(WiFiClientSecure& client, int wifiSignal, const String& wifiSsid, const String& status) {
  HTTPClient http;
  String deviceId = getDeviceId();
  String uri = gSupabaseUrl + "/rest/v1/devices?device_id=eq." + deviceId;
  if (!http.begin(client, uri)) {
    Serial.println("HTTP begin failed");
    return false;
  }
  if (gAnonKey.length() > 0) {
    http.addHeader("apikey", gAnonKey);
  }
  if (gStoredJwt.length() > 0) {
    http.addHeader("Authorization", String("Bearer ") + gStoredJwt);
  } else {
    Serial.println("⚠️ No JWT stored; heartbeat will likely be rejected by RLS");
  }
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Accept", "application/json");
  http.addHeader("Prefer", "return=minimal");
  String body = buildPatchBody(wifiSignal, wifiSsid, status);
  int code = http.PATCH(body);
  Serial.printf("PATCH %s => %d\n", uri.c_str(), code);
  String resp = http.getString();
  if (resp.length() > 0) { Serial.println(resp); }
  http.end();
  return (code == 204 || code == 200);
}

bool heartbeatWithRetry(int maxAttempts = 5) {
  WiFiClientSecure client;
  // 首选根证书，若因证书问题失败，可切换 setInsecure()（开发环境）
  client.setCACert(ISRG_ROOT_X1);
  int attempt = 0;
  int32_t rssi = WiFi.RSSI();
  String ssid = String(WiFi.SSID());
  while (attempt < maxAttempts) {
    bool ok = patchDeviceStatusOnce(client, (int)rssi, ssid, "online");
    if (ok) return true;
    int backoffMs = 500 * (1 << attempt); // 500, 1000, 2000, ...
    delay(backoffMs);
    attempt++;
  }
  // Fallback: try insecure client once for开发联调（不建议生产环境）
  WiFiClientSecure clientInsecure;
  clientInsecure.setInsecure();
  return patchDeviceStatusOnce(clientInsecure, (int)rssi, ssid, "online");
}

// ======== RX 写回调，处理命令 ========
class MyCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *pCharacteristic) override {
    auto v = pCharacteristic->getValue();
    // 兼容 std::string 或 Arduino String：两者都有 c_str()
    String s = String(v.c_str());
    if (s.length() == 0) return;
    s.trim();
    Serial.printf("📥 RX: %s\n", s.c_str());

    // WIFI_LIST
    if (s.equalsIgnoreCase("WIFI_LIST")) {
      notifyWifiListTop5();
      return;
    }

    // WIFI_SET 支持 JSON {"ssid":"...","password":"..."} 或 简单命令 WIFI_SET SSID=xxx;PWD=yyy
    if (s.startsWith("WIFI_SET")) {
      String payload = s.substring(String("WIFI_SET").length());
      payload.trim();
      String ssid = "";
      String pwd = "";
      bool parsed = false;
      if (payload.startsWith("{")) {
        DynamicJsonDocument doc(512);
        auto err = deserializeJson(doc, payload);
        if (!err) {
          ssid = doc["ssid"].as<String>();
          pwd  = doc["password"].as<String>();
          parsed = (ssid.length() > 0);
        }
      } else if (payload.length() > 0) {
        int si = payload.indexOf("SSID=");
        int pi = payload.indexOf("PWD=");
        if (si >= 0 && pi >= 0) {
          ssid = payload.substring(si + 5, payload.indexOf(';', si + 5));
          pwd  = payload.substring(pi + 4);
          parsed = (ssid.length() > 0);
        }
      }
      if (parsed) {
        gSavedSsid = ssid;
        gSavedPwd  = pwd;
        prefs.putString("ssid", gSavedSsid);
        prefs.putString("pwd", gSavedPwd);
        txNotify("WIFI_SAVED");
        connectToWiFi(gSavedSsid.c_str(), gSavedPwd.c_str());
      } else {
        txNotify("WIFI_SET_INVALID");
      }
      return;
    }

    // WIFI_CLEAR
    if (s.equalsIgnoreCase("WIFI_CLEAR")) {
      gSavedSsid = "";
      gSavedPwd = "";
      prefs.remove("ssid");
      prefs.remove("pwd");
      txNotify("WIFI_CLEARED");
      return;
    }

    // JWT_SET 支持：
    // 1) JWT_SET {"jwt":"..."}
    // 2) 直接发送 {"jwt":"..."}
    // 3) 发送 Base64(JSON)
    if (s.startsWith("JWT_SET")) {
      String j = s.substring(String("JWT_SET").length());
      j.trim();
      if (j.length() == 0) { txNotify("JWT_SET_EMPTY"); return; }
      if (looksBase64(j)) j = base64DecodeToString(j);
      DynamicJsonDocument doc(1024);
      auto err = deserializeJson(doc, j);
      if (!err && doc.containsKey("jwt")) {
        gStoredJwt = doc["jwt"].as<String>();
        prefs.putString("jwt", gStoredJwt);
        txNotify("JWT_SAVED");
      } else {
        txNotify("JWT_SET_INVALID");
      }
      return;
    }
    if (s.startsWith("{")) {
      // 直接发送 JSON：可能包含 jwt / anon / supabase_url
      String j = s;
      if (looksBase64(j)) j = base64DecodeToString(j);
      DynamicJsonDocument doc(1024);
      auto err = deserializeJson(doc, j);
      if (!err) {
        bool any = false;
        if (doc.containsKey("jwt")) {
          gStoredJwt = doc["jwt"].as<String>();
          prefs.putString("jwt", gStoredJwt);
          any = true;
        }
        if (doc.containsKey("anon")) {
          gAnonKey = doc["anon"].as<String>();
          prefs.putString("anon", gAnonKey);
          any = true;
        }
        if (doc.containsKey("supabase_url")) {
          gSupabaseUrl = doc["supabase_url"].as<String>();
          prefs.putString("sburl", gSupabaseUrl);
          any = true;
        }
        txNotify(any ? "CONFIG_SAVED" : "CONFIG_EMPTY");
      } else {
        txNotify("JSON_INVALID");
      }
      return;
    }

    // PING → PONG
    if (s.equalsIgnoreCase("PING")) {
      txNotify(String("PONG ") + getDeviceId());
      return;
    }

    // 立即触发一次心跳（便于联调）：HEARTBEAT_NOW
    if (s.equalsIgnoreCase("HEARTBEAT_NOW")) {
      if (WiFi.status() == WL_CONNECTED) {
        bool ok = heartbeatWithRetry();
        txNotify(ok ? "HEARTBEAT_OK" : "HEARTBEAT_FAIL");
      } else {
        txNotify("WIFI_NOT_CONNECTED");
      }
      return;
    }

    // 其他命令忽略或回显
    txNotify(String("ECHO ") + s);
  }
};

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("Pinme BLE + Heartbeat starting...");

  // 加载持久化配置
  prefs.begin("pinme", false);
  gSavedSsid = prefs.getString("ssid", "");
  gSavedPwd  = prefs.getString("pwd", "");
  gStoredJwt = prefs.getString("jwt", "");
  gAnonKey   = prefs.getString("anon", "");
  gSupabaseUrl = prefs.getString("sburl", gSupabaseUrl);

  // BLE 初始化，广播名带设备后缀，ID 特征读出 ESP32_XXXXXX
  String devSuffix = getDeviceId();
  // 广播名只带后 6 位后缀，避免重复 ESP32_
  String suffix = devSuffix.substring(max(0, (int)devSuffix.length() - 6));
  String advName = String("pinme-ESP32_") + suffix;
  BLEDevice::init(advName.c_str());
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());
  BLEService *pService = pServer->createService(SERVICE_UUID);

  pTxCharacteristic = pService->createCharacteristic(
    CHARACTERISTIC_UUID_TX,
    BLECharacteristic::PROPERTY_NOTIFY | BLECharacteristic::PROPERTY_READ
  );
  pTxCharacteristic->addDescriptor(new BLE2902());

  pRxCharacteristic = pService->createCharacteristic(
    CHARACTERISTIC_UUID_RX,
    BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR
  );
  pRxCharacteristic->setCallbacks(new MyCallbacks());

  pIdCharacteristic = pService->createCharacteristic(
    CHARACTERISTIC_UUID_ID,
    BLECharacteristic::PROPERTY_READ
  );
  String id = getDeviceId();
  pIdCharacteristic->setValue(id.c_str());

  pService->start();
  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  pAdvertising->setMinPreferred(0x06);
  pAdvertising->setMinPreferred(0x12);
  BLEDevice::startAdvertising();
  Serial.println("✅ BLE Advertising started");

  // 自动连接 Wi-Fi（如果已保存）
  if (gSavedSsid.length() > 0) {
    connectToWiFi(gSavedSsid.c_str(), gSavedPwd.c_str());
  }
}

void loop() {
  // 周期性 Wi-Fi 重试
  if (WiFi.status() != WL_CONNECTED && gSavedSsid.length() > 0) {
    if (millis() - lastWifiRetryMs >= 30000) {
      lastWifiRetryMs = millis();
      Serial.println("↻ Wi-Fi retry...");
      connectToWiFi(gSavedSsid.c_str(), gSavedPwd.c_str());
    }
  }

  // 心跳（每 15s）
  if (WiFi.status() == WL_CONNECTED) {
    if (millis() - lastHeartbeatMs >= 15000) {
      lastHeartbeatMs = millis();
      bool ok = heartbeatWithRetry();
      if (ok) {
        Serial.println("💓 Heartbeat OK");
      } else {
        Serial.println("❌ Heartbeat failed");
      }
    }
  }

  delay(10);
}