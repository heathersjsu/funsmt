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
#include <time.h>

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
volatile bool wifiConnectBusy = false; // 防止并发重复配网/重试导致 "sta is connecting, cannot set config"
volatile bool wifiListBusy = false;   // 防止并发扫描与连接/重试相互干扰
volatile unsigned long wifiScanLockUntilMs = 0; // 扫描窗口期内禁止任何自动连接尝试
Preferences prefs;
String gSupaCfgBuf = "";
String gJwtSetBuf = "";
volatile bool gSupaReceiving = false;
volatile bool gJwtReceiving = false;
String gCaSetBuf = "";
volatile bool gCaReceiving = false;
String gCaBundle = "";

String gSavedSsid = "";
String gSavedPwd = "";
String gStoredJwt = "";
String gSupabaseUrl = "https://kjitkkeerytijbcgkqjj.supabase.co"; // 可通过 BLE 配置覆盖
String gAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtqaXRra2Vlcnl0aWpiY2drcWpqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA1MzgxMjUsImV4cCI6MjA3NjExNDEyNX0.isMJIUbp7pDTxs3RBA1-paGVvQUl-TQS6t1GcwtD1Vc";
bool gHbVerbose = false; // 心跳调试：返回 representation 并解析 last_seen
bool gAllowInsecure = false; // 允许不安全 TLS 回退（默认关闭，仅用于开发调试）
bool gInsecureUsed = false;  // 每次上电最多回退一次
const char* gFwVersion = "device_setup v2025-11-22"; // 固件版本号，用于心跳遥测

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

static const char SUPABASE_ROOT_BUNDLE[] PROGMEM = R"PEM(
-----BEGIN CERTIFICATE-----
MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvc
NAQELBQAw
TzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR
5IFJlc2Vh
cmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA
0MTEwNDM4
WhcNMzUwNjA0MTEwNDM4WjBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChM
gSW50ZXJu
ZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkc
gUm9vdCBY
MTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAK3oJHP0FDf
zm54rVygc
h77ct984kIxuPOZXoHj3dcKi/vVqbvYATyjb3miGbESTtrFj/RQSa78
f0uoxmyF+
0TM8ukj13Xnfs7j/EvEhmkvBioZxaUpmZmyPfjxwv60pIgbz5MDmgK7
iS4+3mX6U
A5/TR5d8mUgjU+g4rk8Kb4Mu0UlXjIB0ttov0DiNewNwIRt18jA8+o+
u3dpjq+sW
T8KOEUt+zwvo/7V3LvSye0rgTBIlDHCNAymg4VMk7BPZ7hm/ELNKjD+
Jo2FR3qyH
B5T0Y3HsLuJvW5iB4YlcNHlsdu87kGJ55tukmi8mxdAQ4Q7e2RCOFvu
396j3x+UC
B5iPNgiV5+I3lg02dZ77DnKxHZu8A/lJBdiB3QW0KtZB6awBdpUKD9j
f1b0SHzUv
KBds0pjBqAlkd25HN7rOrFleaJ1/ctaJxQZBKT5ZPt0m9STJEadao0x
AH0ahmbWn
OlFuhjuefXKnEgV4We0+UXgVCwOPjdAvBbI+e0ocS3MFEvzG6uBQE3x
Dk3SzynTn
jh8BCNAw1FtxNrQHusEwMFxIt4I7mKZ9YIqioymCzLq9gwQbooMDQaH
WBfEbwrbw
qHyGO0aoSCqI3Haadr8faqU9GY/rOPNk3sgrDQoo//fb4hVC1CLQJ13
hef4Y53CI
rU7m2Ys6xt0nUW7/vGT1M0NPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwI
BBjAPBgNV
HRMBAf8EBTADAQH/MB0GA1UdDgQWBBR5tFnme7bl5AFzgAiIyBpY9um
bbjANBgkq
hkiG9w0BAQsFAAOCAgEAVR9YqbyyqFDQDLHYGmkgJykIrGF1XIpu+IL
laS/V9lZL
ubhzEFnTIZd+50xx+7LSYK05qAvqFyFWhfFQDlnrzuBZ6brJFe+GnY+
EgPbk6ZGQ
3BebYhtF8GaV0nxvwuo77x/Py9auJ/GpsMiu/X1+mvoiBOv/2X/qkSs
isRcOj/KK
NFtY2PwByVS5uCbMiogziUwthDyC3+6WVwW6LLv3xLfHTjuCvjHIInN
zktHCgKQ5
ORAzI4JMPJ+GslWYHb4phowim57iaztXOoJwTdwJx4nLCgdNbOhdjsn
vzqvHu7Ur
TkXWStAmzOVyyghqpZXjFaH3pO3JLF+l+/+sKAIuvtd7u+Nxe5AW0wd
eRlN8NwdC
jNPElpzVmbUq4JUagEiuTDkHzsxHpFKVK7q4+63SM1N95R1NbdWhscd
Cb+ZAJzVc
oyi3B43njTOQ5yOf+1CceWxG1bQVs5ZufpsMljq4Ui0/1lvh+wjChP4
kqKOJ2qxq
4RgqsahDYVvTH9w7jXbyLeiNdd8XM2w9U/t7y0Ff/9yi0GE44Za4rF2
LN9d11TPA
mRGunUHBcnWEvgJBQl9nJEiU0Zsnvgc/ubhPgXRR4Xq37Z0j4r7g1Sg
EEzwxA57d
emyPxgcYxn/eR44/KJ4EBs+lVDR3veyJm+kXQ99b21/+jh5Xos1AnX5
iItreGCc=
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIIFFjCCAv6gAwIBAgIRAJErCErPDBinU/bWLiWnX1owDQYJKoZIhvc
NAQELBQAw
TzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR
5IFJlc2Vh
cmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMjAwOTA
0MDAwMDAw
WhcNMjUwOTE1MTYwMDAwWjAyMQswCQYDVQQGEwJVUzEWMBQGA1UEChM
NTGV0J3Mg
RW5jcnlwdDELMAkGA1UEAxMCUjMwggEiMA0GCSqGSIb3DQEBAQUAA4I
BDwAwggEK
AoIBAQC7AhUozPaglNMPEuyNVZLD+ILxmaZ6QoinXSaqtSu5xUyxr45
r+XXIo9cP
R5QUVTVXjJ6oojkZ9YI8QqlObvU7wy7bjcCwXPNZOOftz2nwWgsbvsC
UJCWH+jdx
sxPnHKzhm+/b5DtFUkWWqcFTzjTIUu61ru2P3mBw4qVUq7ZtDpelQDR
rK9O8Zutm
NHz6a4uPVymZ+DAXXbpyb/uBxa3Shlg9F8fnCbvxK/eG3MHacV3URuP
MrSXBiLxg
Z3Vms/EY96Jc5lP/Ooi2R6X/ExjqmAl3P51T+c8B5fWmcBcUr2Ok/5m
zk53cU6cG
/kiFHaFpriV1uxPMUgP17VGhi9sVAgMBAAGjggEIMIIBBDAOBgNVHQ8
BAf8EBAMC
AYYwHQYDVR0lBBYwFAYIKwYBBQUHAwIGCCsGAQUFBwMBMBIGA1UdEwE
B/wQIMAYB
Af8CAQAwHQYDVR0OBBYEFBQusxe3WFbLrlAJQOYfr52LFMLGMB8GA1U
dIwQYMBaA
FHm0WeZ7tuXkAXOACIjIGlj26ZtuMDIGCCsGAQUFBwEBBCYwJDAiBgg
rBgEFBQcw
AoYWaHR0cDovL3gxLmkubGVuY3Iub3JnLzAnBgNVHR8EIDAeMBygGqA
YhhZodHRw
Oi8veDEuYy5sZW5jci5vcmcvMCIGA1UdIAQbMBkwCAYGZ4EMAQIBMA0
GCysGAQQB
gt8TAQEBMA0GCSqGSIb3DQEBCwUAA4ICAQCFyk5HPqP3hUSFvNVneLK
YY611TR6W
PTNlclQtgaDqw+34IL9fzLdwALduO/ZelN7kIJ+m74uyA+eitRY8kc6
07TkC53wl
ikfmZW4/RvTZ8M6UK+5UzhK8jCdLuMGYL6KvzXGRSgi3yLgjewQtCPk
IVz6D2QQz
CkcheAmCJ8MqyJu5zlzyZMjAvnnAT45tRAxekrsu94sQ4egdRCnbWSD
tY7kh+BIm
lJNXoB1lBMEKIq4QDUOXoRgffuDghje1WrG9ML+Hbisq/yFOGwXD9Ri
X8F6sw6W4
avAuvDszue5L3sz85K+EC4Y/wFVDNvZo4TYXao6Z0f+lQKc0t8DQYzk
1OXVu8rp2
yJMC6alLbBfODALZvYH7n7do1AZls4I9d1P4jnkDrQoxB3UqQ9hVl3L
EKQ73xF1O
yK5GhDDX8oVfGKF5u+decIsH4YaTw7mP3GFxJSqv3+0lUFJoi5Lc5da
149p90Ids
hCExroL1+7mryIkXPeFM5TgO9r0rvZaBFOvV2z0gp35Z0+L4WPlbuEj
N/lxPFin+
HlUjr8gRsI3qfJOQFy/9rKIJR0Y/8Omwt/8oTWgy1mdeHmmjk7j1nYs
vC9JSQ6Zv
MldlTTKB3zhThV1+XWYp6rjd5JW1zbVWEkLNxE7GJThEUG3szgBVGP7
pSWTUTsqX
nLRbwHOoq7hHwg==
-----END CERTIFICATE-----
)PEM";

static const char* currentCa() {
  if (gCaBundle.length() > 0) return gCaBundle.c_str();
  return SUPABASE_ROOT_BUNDLE;
}

#if __has_include("Warp.h")
#include "Warp.h"
#define PINME_WARP_AVAILABLE 1
#else
#define PINME_WARP_AVAILABLE 0
#endif

void startWarp() {
#if PINME_WARP_AVAILABLE
  Serial.println("Starting Cloudflare Warp...");
  warp_begin();
  warp_set_dns("1.1.1.1");
  delay(3000);
#else
  Serial.println("Warp unavailable");
#endif
}

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
  if (wifiListBusy) { txNotify("WIFI_LIST_BUSY"); return; }
  wifiConnectBusy = false;
  wifiListBusy = true;
  wifiScanLockUntilMs = millis() + 20000; // 扫描锁 20s，期间禁止自动重连
  txNotify("WIFI_LIST_BEGIN");
  Serial.println("🔎 WIFI_LIST: scanning...");
  WiFi.disconnect(true, true);
  WiFi.scanDelete();
  delay(120);
  WiFi.mode(WIFI_STA);
  delay(60);

  wifi_mode_t mode = WiFi.getMode();
  bool staConnected = (WiFi.status() == WL_CONNECTED);
  int n = -1;

  // 优先非破坏性扫描：在 STA 已连接时不主动断开
  if (mode == WIFI_STA && staConnected) {
    WiFi.scanDelete();
    delay(80);
    n = WiFi.scanNetworks(false, true, false, 400 /*ms per channel*/);
    if (n <= 0) {
      WiFi.scanDelete();
      delay(200);
      n = WiFi.scanNetworks(false, true, false, 800);
    }
    // 仍失败则兜底执行一次彻底重置后的扫描
    if (n <= 0) {
      Serial.println("⚠️ Scan failed while STA connected, fallback to reset-and-scan");
      WiFi.mode(WIFI_OFF);
      delay(100);
      WiFi.disconnect(true, true);
      WiFi.scanDelete();
      delay(120);
      WiFi.mode(WIFI_STA);
      delay(60);
      n = WiFi.scanNetworks(false, true, false, 800);
      if (n <= 0) {
        WiFi.scanDelete();
        delay(200);
        WiFi.scanNetworks(true, true, false, 800);
        uint32_t start = millis();
        while (millis() - start < 3000) {
          int res = WiFi.scanComplete();
          if (res >= 0) { n = res; break; }
          delay(200);
        }
      }
    }
  } else {
    // AP 或 AP+STA 模式下，优先确保仅 STA，再进行扫描
    if (mode == WIFI_AP || mode == WIFI_AP_STA) {
      WiFi.mode(WIFI_OFF);
      delay(100);
      WiFi.disconnect(true, true);
      WiFi.scanDelete();
      delay(120);
      WiFi.mode(WIFI_STA);
      delay(60);
    } else {
      // 确保处于 STA 模式，但不强制断开
      WiFi.mode(WIFI_STA);
      delay(50);
    }
    WiFi.scanDelete();
    delay(80);
    n = WiFi.scanNetworks(false, true, false, 400);
    if (n <= 0) {
      WiFi.scanDelete();
      delay(200);
      n = WiFi.scanNetworks(false, true, false, 800);
      if (n <= 0) {
        WiFi.scanDelete();
        delay(200);
        WiFi.scanNetworks(true, true, false, 800);
        uint32_t start = millis();
        while (millis() - start < 3000) {
          int res = WiFi.scanComplete();
          if (res >= 0) { n = res; break; }
          delay(200);
        }
      }
    }
  }

  if (n <= 0) {
    
    WiFi.scanDelete();
    delay(120);
    n = WiFi.scanNetworks(false, true, false, 800);
  }
  if (n <= 0) {
    
    WiFi.scanDelete();
    delay(120);
    n = WiFi.scanNetworks(false, true, false, 800);
  }
  if (n <= 0) {
    
    WiFi.scanDelete();
    delay(120);
    n = WiFi.scanNetworks(false, true, false, 800);
  }
  if (n <= 0) {
    // Final fallback: aggressive reset and active scan with completion wait
    WiFi.mode(WIFI_OFF);
    delay(100);
    WiFi.disconnect(true, true);
    WiFi.scanDelete();
    delay(120);
    WiFi.mode(WIFI_STA);
    delay(60);
    WiFi.scanNetworks(true, true, false, 800);
    uint32_t start2 = millis();
    while (millis() - start2 < 4000) {
      int res2 = WiFi.scanComplete();
      if (res2 >= 0) { n = res2; break; }
      delay(200);
    }
  }
  if (n <= 0) {
    Serial.println("⚠️ No networks found (after retries)");
    txNotify("WIFI_LIST_NONE");
    txNotify(String("WIFI_LIST_COUNT ") + String(0));
    txNotify("WIFI_LIST_END");
    wifiListBusy = false;
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
  wifiListBusy = false;
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
  if (wifiListBusy) {
    return;
  }
  if (wifiConnectBusy) {
    Serial.println("⏳ connectToWiFi: busy, aborting previous attempt and restarting");
  }
  wifiConnectBusy = true;
  Serial.printf("📶 Connecting to Wi-Fi: %s\n", ssid);
  txNotify("WIFI_CONNECTING");
  setupWifiEvents();
  // 彻底重置 Wi‑Fi 无线栈，避免 AP+STA 粘连或连接中的状态阻塞配置
  WiFi.mode(WIFI_OFF);
  delay(80);
  WiFi.disconnect(true, true);
  WiFi.scanDelete();
  delay(120);
  
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);
  WiFi.scanDelete();
  delay(80);
  int n = WiFi.scanNetworks(false, true, false, 400);
  int chan = 0;
  uint8_t bssid[6] = {0};
  bool found = false;
  if (n > 0) {
    for (int i = 0; i < n; ++i) {
      String s = WiFi.SSID(i);
      if (s == String(ssid)) {
        chan = WiFi.channel(i);
        const uint8_t* b = WiFi.BSSID(i);
        for (int k = 0; k < 6; ++k) bssid[k] = b[k];
        found = true;
        break;
      }
    }
  }
  if (found) {
    WiFi.begin(ssid, password, chan, bssid);
  } else {
    WiFi.begin(ssid, password);
  }
  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 50) {
    delay(500);
    tries++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("✅ Wi-Fi connected. IP=%s RSSI=%d\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
    txNotify("WIFI_OK");
    // 建议：Wi‑Fi 连接成功后立刻进行 NTP 校时，避免 TLS 因设备时间不准而失败
    // 注意：configTime 是非阻塞的，这里轮询等待时间就绪（epoch 大于约 2023 年）
    Serial.println("⏱ Syncing time via NTP...");
    configTime(0, 0, "pool.ntp.org", "time.google.com");
    int ntpTries = 0;
    time_t now = 0;
    while (ntpTries < 20) { // 最长等待 ~10 秒
      now = time(nullptr);
      if (now > 1700000000) break; // 约 2023-11-14，避免 1970 年时间导致证书校验失败
      delay(500);
      ntpTries++;
    }
    if (now > 1700000000) {
      Serial.printf("✅ Time synced. epoch=%lu\n", (unsigned long)now);
    } else {
      Serial.println("⚠️ NTP time sync timeout; TLS may still fail");
    }
    wifiConnectBusy = false;
  } else {
    Serial.println("❌ Wi-Fi connect failed");
    txNotify("WIFI_FAIL");
    wifiConnectBusy = false;
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
  body += "\"status\":\"" + jsonEscape(status) + "\",";
  // 遥测字段：固件版本、设备运行时长（秒）、空闲堆内存（字节）
  body += "\"fw_version\":\"" + jsonEscape(String(gFwVersion)) + "\",";
  body += "\"uptime_s\":" + String((unsigned long)(millis()/1000)) + ",";
  body += "\"free_heap\":" + String((int)ESP.getFreeHeap());
  body += "}";
  return body;
}

bool patchDeviceStatusOnce(WiFiClientSecure& client, int wifiSignal, const String& wifiSsid, const String& status) {
  HTTPClient http;
  String deviceId = getDeviceId();
  String uri = gSupabaseUrl + "/rest/v1/devices?device_id=eq." + deviceId;
  // ==== Detailed logging before request ====
  Serial.println("==== Heartbeat PATCH: preparing ====");
  Serial.printf("DeviceID=%s SSID=%s RSSI=%d Status=%s\n", deviceId.c_str(), wifiSsid.c_str(), wifiSignal, status.c_str());
  Serial.printf("Target=%s\n", uri.c_str());
  // 优先使用 host+path 形式，确保 SNI 主机名正确
  String host = String(normalizeHttpsUrl(gSupabaseUrl));
  if (host.startsWith("https://")) host.remove(0, 8);
  int slash = host.indexOf('/');
  if (slash >= 0) host = host.substring(0, slash);
  String path = String("/rest/v1/devices?device_id=eq.") + deviceId;
  {
    WiFiClientSecure probe;
    probe.setCACert(currentCa());
    probe.setTimeout(8000);
    bool ok = probe.connect(host.c_str(), 443);
    Serial.printf("TLS preconnect %s:443 => %s\n", host.c_str(), ok ? "OK" : "FAIL");
    if (ok) { probe.stop(); }
    else {
      if (gAllowInsecure) {
        // SECURE: DEV ONLY fallback, 跳过证书校验
        probe.stop();
        client.setInsecure();
        Serial.println("TLS preconnect failed, forcing setInsecure() (DEV ONLY)");
      } else {
        return false;
      }
    }
  }
  if (!gAllowInsecure) client.setCACert(currentCa());
  client.setTimeout(15000);
  bool begun = http.begin(client, host.c_str(), 443, path.c_str(), true /*https*/);
  if (!begun) {
    if (!http.begin(client, uri)) {
      Serial.println("HTTP begin failed");
      return false;
    }
  }
  // 避免在无响应体或 204 的情况下读取阻塞
  http.setTimeout(8000);
  http.setReuse(false);
  if (gAnonKey.length() > 0) {
    http.addHeader("apikey", gAnonKey);
    Serial.printf("Header apikey: present (len=%d)\n", gAnonKey.length());
  }
  if (gStoredJwt.length() > 0) {
    http.addHeader("Authorization", String("Bearer ") + gStoredJwt);
    Serial.printf("Header Authorization: Bearer <device_jwt> present (len=%d)\n", gStoredJwt.length());
  } else {
    Serial.println("⚠️ No JWT stored; heartbeat will likely be rejected by RLS");
  }
  http.addHeader("Host", host);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Accept", "application/json");
  // 调试模式下返回 representation，便于从设备端解析 last_seen；默认 minimal
  http.addHeader("Prefer", gHbVerbose ? "return=representation" : "return=minimal");
  // 明确要求服务端关闭连接，避免某些情况下 getString 阻塞
  http.addHeader("Connection", "close");
  String body = buildPatchBody(wifiSignal, wifiSsid, status);
  unsigned int bodyPreviewLen = (body.length() < 60U) ? (unsigned int)body.length() : 60U;
  Serial.printf("Body length=%u, preview=%s\n", (unsigned int)body.length(), body.substring(0, bodyPreviewLen).c_str());
  int code = http.PATCH(body);
  Serial.printf("PATCH %s => %d\n", uri.c_str(), code);
  if (code <= 0) {
    Serial.printf("HTTP error: %s\n", http.errorToString(code).c_str());
  }
  if (code <= 0) {
    http.end();
    HTTPClient http2;
    String host2 = String(normalizeHttpsUrl(gSupabaseUrl));
    if (host2.startsWith("https://")) host2.remove(0, 8);
    int slash2 = host2.indexOf('/');
    if (slash2 >= 0) host2 = host2.substring(0, slash2);
    String path2 = String("/rest/v1/devices?device_id=eq.") + deviceId;
    bool begun2 = http2.begin(client, host2.c_str(), 443, path2.c_str(), true);
    if (!begun2) {
      if (!http2.begin(client, uri)) {
        Serial.println("HTTP begin failed (fallback)");
        return false;
      }
    }
    http2.setTimeout(8000);
    if (gAnonKey.length() > 0) http2.addHeader("apikey", gAnonKey);
    if (gStoredJwt.length() > 0) http2.addHeader("Authorization", String("Bearer ") + gStoredJwt);
    http2.addHeader("Content-Type", "application/json");
    http2.addHeader("Accept", "application/json");
    http2.addHeader("Prefer", gHbVerbose ? "return=representation" : "return=minimal");
    http2.addHeader("Connection", "close");
    http2.addHeader("X-HTTP-Method-Override", "PATCH");
    Serial.println("PATCH failed, trying POST+X-HTTP-Method-Override");
    code = http2.POST(body);
    Serial.printf("POST (override=PATCH) %s => %d\n", uri.c_str(), code);
    if (code <= 0) {
      Serial.printf("HTTP error (override): %s\n", http2.errorToString(code).c_str());
    }
    http2.end();
  }
  // 204 表示无响应体，避免调用 getString 导致阻塞
  if (code == 204) {
    Serial.println("No Content (204), skip reading body");
    http.end();
    return true;
  }
  // 对于其他返回码，若响应体长度不可用或为 0，同样跳过读取
  int respSize = http.getSize();
  if (respSize <= 0) {
    Serial.println("No response body (Prefer=return=minimal or unknown length)");
  } else {
    String resp = http.getString();
    if (resp.length() > 0) {
      unsigned int respPreviewLen = (resp.length() < 120U) ? (unsigned int)resp.length() : 120U;
      String head = resp.substring(0, respPreviewLen);
      Serial.printf("Resp length=%u\nResp preview=%s\n", (unsigned int)resp.length(), head.c_str());
      // 如果是 representation，尝试解析 last_seen 等关键字段
      if (gHbVerbose && code == 200) {
        DynamicJsonDocument doc(1024);
        auto err = deserializeJson(doc, resp);
        if (!err) {
          // PostgREST 默认返回数组
          if (doc.is<JsonArray>()) {
            JsonArray arr = doc.as<JsonArray>();
            if (!arr.isNull() && arr.size() > 0) {
              JsonObject row = arr[0];
              const char* dev = row["device_id"] | "";
              const char* st  = row["status"] | "";
              const char* ls  = row["last_seen"] | ""; // ISO 字符串
              int ws           = row["wifi_signal"] | 0;
              const char* ssid = row["wifi_ssid"] | "";
              Serial.printf("↩️ Echo row: device_id=%s status=%s last_seen=%s wifi_signal=%d wifi_ssid=%s\n",
                            dev, st, ls, ws, ssid);
            } else {
              Serial.println("↩️ Echo row: empty array");
            }
          } else if (doc.is<JsonObject>()) {
            JsonObject row = doc.as<JsonObject>();
            const char* dev = row["device_id"] | "";
            const char* st  = row["status"] | "";
            const char* ls  = row["last_seen"] | "";
            int ws           = row["wifi_signal"] | 0;
            const char* ssid = row["wifi_ssid"] | "";
            Serial.printf("↩️ Echo obj: device_id=%s status=%s last_seen=%s wifi_signal=%d wifi_ssid=%s\n",
                          dev, st, ls, ws, ssid);
          }
        } else {
          Serial.printf("JSON parse error: %s\n", err.c_str());
        }
      }
    } else {
      Serial.println("Empty response body");
    }
  }
  http.end();
  return (code == 204 || code == 200);
}

// GET 一次 devices 行，便于调试 last_seen/status 等字段
bool readDeviceRowOnce(WiFiClientSecure& client) {
  HTTPClient http;
  String deviceId = getDeviceId();
  String uri = gSupabaseUrl + "/rest/v1/devices?select=device_id,status,last_seen,wifi_signal,wifi_ssid&device_id=eq." + deviceId + "&limit=1";
  Serial.printf("READ Target=%s\n", uri.c_str());
  // 优先使用 host+path 形式，确保 SNI 主机名正确
  String host = String(normalizeHttpsUrl(gSupabaseUrl));
  if (host.startsWith("https://")) host.remove(0, 8);
  int slash = host.indexOf('/');
  if (slash >= 0) host = host.substring(0, slash);
  String path = String("/rest/v1/devices?select=device_id,status,last_seen,wifi_signal,wifi_ssid&device_id=eq.") + deviceId + String("&limit=1");
  {
    WiFiClientSecure probe;
    probe.setCACert(currentCa());
    probe.setTimeout(8000);
    bool ok = probe.connect(host.c_str(), 443);
    Serial.printf("TLS preconnect %s:443 => %s\n", host.c_str(), ok ? "OK" : "FAIL");
    if (ok) { probe.stop(); } else { return false; }
  }
  client.setCACert(currentCa());
  client.setTimeout(15000);
  bool begun = http.begin(client, host.c_str(), 443, path.c_str(), true /*https*/);
  if (!begun) {
    if (!http.begin(client, uri)) {
      Serial.println("HTTP begin failed (GET)");
      return false;
    }
  }
  http.setTimeout(8000);
  if (gAnonKey.length() > 0) {
    http.addHeader("apikey", gAnonKey);
  }
  if (gStoredJwt.length() > 0) {
    http.addHeader("Authorization", String("Bearer ") + gStoredJwt);
  }
  http.addHeader("Host", host);
  http.addHeader("Accept", "application/json");
  http.addHeader("Connection", "close");
  int code = http.GET();
  Serial.printf("GET => %d\n", code);
  if (code <= 0) {
    Serial.printf("HTTP error: %s\n", http.errorToString(code).c_str());
    http.end();
    return false;
  }
  String resp = http.getString();
  unsigned int respPreviewLen = (resp.length() < 160U) ? (unsigned int)resp.length() : 160U;
  Serial.printf("GET resp length=%u preview=%s\n", (unsigned int)resp.length(), resp.substring(0, respPreviewLen).c_str());
  // 解析 JSON
  DynamicJsonDocument doc(1024);
  auto err = deserializeJson(doc, resp);
  if (!err && doc.is<JsonArray>()) {
    JsonArray arr = doc.as<JsonArray>();
    if (arr.size() > 0) {
      JsonObject row = arr[0];
      const char* dev = row["device_id"] | "";
      const char* st  = row["status"] | "";
      const char* ls  = row["last_seen"] | "";
      int ws           = row["wifi_signal"] | 0;
      const char* ssid = row["wifi_ssid"] | "";
      Serial.printf("🔎 Row: device_id=%s status=%s last_seen=%s wifi_signal=%d wifi_ssid=%s\n",
                    dev, st, ls, ws, ssid);
    } else {
      Serial.println("🔎 Row: empty array");
    }
  } else {
    Serial.printf("GET JSON parse error: %s\n", err.c_str());
  }
  http.end();
  return (code == 200);
}

bool heartbeatWithRetry(int maxAttempts = 5) {
  WiFiClientSecure client;
  // 首选根证书，若因证书问题失败，可切换 setInsecure()（开发环境）
  client.setCACert(currentCa());
  Serial.println("TLS: Using ISRG Root X1 (Let's Encrypt) CA");
  int attempt = 0;
  int32_t rssi = WiFi.RSSI();
  String ssid = String(WiFi.SSID());
  while (attempt < maxAttempts) {
    Serial.printf("Heartbeat attempt #%d\n", attempt + 1);
    bool ok = patchDeviceStatusOnce(client, (int)rssi, ssid, "online");
    if (ok) return true;
    // 指数退避 + 抖动
    int baseMs = 800;
    int jitterMs = (int)random(0, 300);
    int backoffMs = baseMs * (1 << attempt) + jitterMs; // 800, 1600, 3200, ... + jitter
    if (backoffMs > 60000) backoffMs = 60000;
    Serial.printf("Retry backoff %d ms (jitter=%d)\n", backoffMs, jitterMs);
    delay(backoffMs);
    attempt++;
  }
  // Fallback: try insecure client once for开发联调（不建议生产环境）
  if (!gAllowInsecure) {
    Serial.println("TLS fallback blocked (gAllowInsecure=false)");
    return false;
  }
  if (gInsecureUsed) {
    Serial.println("TLS fallback already used once this boot");
    return false;
  }
  gInsecureUsed = true;
  WiFiClientSecure clientInsecure;
  clientInsecure.setInsecure();
  Serial.println("TLS fallback: setInsecure() (DEV ONLY)");
  return patchDeviceStatusOnce(clientInsecure, (int)rssi, ssid, "online");
}

bool netProbeSupabase() {
  String host = String(gSupabaseUrl);
  if (host.startsWith("https://")) host.remove(0, 8);
  int slash = host.indexOf('/');
  if (slash >= 0) host = host.substring(0, slash);
  IPAddress ip;
  bool dnsOk = WiFi.hostByName(host.c_str(), ip);
  Serial.printf("DNS %s => %s\n", host.c_str(), dnsOk ? ip.toString().c_str() : "<fail>");
  WiFiClientSecure c;
  c.setCACert(currentCa());
  c.setTimeout(8000);
  bool conn = c.connect(host.c_str(), 443);
  Serial.printf("TLS connect %s:443 => %s\n", host.c_str(), conn ? "OK" : "FAIL");
  if (conn) {
    c.stop();
    return true;
  }
  if (gAllowInsecure) {
    WiFiClientSecure ci;
    ci.setInsecure(); // SECURE: DEV ONLY
    bool conni = ci.connect(host.c_str(), 443);
    Serial.printf("Insecure connect %s:443 => %s\n", host.c_str(), conni ? "OK" : "FAIL");
    if (conni) { ci.stop(); return true; }
  }
  return false;
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
        // 避免并发重复连接：如果当前正在连接且配置相同，则忽略本次请求
        if (wifiConnectBusy && ssid == gSavedSsid && pwd == gSavedPwd) {
          txNotify("WIFI_BUSY");
          return;
        }
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

    if (s.startsWith("SUPA_CFG_BEGIN")) {
      gSupaReceiving = true;
      gSupaCfgBuf = "";
      return;
    }
    if (s.startsWith("SUPA_CFG_DATA")) {
      if (gSupaReceiving) {
        int sp = s.indexOf(' ');
        String rest = sp >= 0 ? s.substring(sp + 1) : "";
        int sp2 = rest.indexOf(' ');
        String chunk = sp2 >= 0 ? rest.substring(sp2 + 1) : rest;
        gSupaCfgBuf += chunk;
      }
      return;
    }
    if (s.startsWith("SUPA_CFG_END")) {
      if (gSupaReceiving) {
        gSupaReceiving = false;
        String j = gSupaCfgBuf;
        DynamicJsonDocument doc(1024);
        auto err = deserializeJson(doc, j);
        if (!err) {
          bool any = false;
          if (doc.containsKey("anon")) { gAnonKey = doc["anon"].as<String>(); prefs.putString("anon", gAnonKey); any = true; }
          if (doc.containsKey("supabase_url")) { gSupabaseUrl = normalizeHttpsUrl(doc["supabase_url"].as<String>()); prefs.putString("sburl", gSupabaseUrl); any = true; }
          txNotify(any ? "CONFIG_SAVED" : "CONFIG_EMPTY");
        } else {
          txNotify("JSON_INVALID");
        }
        gSupaCfgBuf = "";
      }
      return;
    }

    // JWT_SET 支持：
    // 1) JWT_SET {"jwt":"..."}
    // 2) 直接发送 {"jwt":"..."}
    // 3) 发送 Base64(JSON)
    if (s.startsWith("JWT_SET_BEGIN")) {
      gJwtReceiving = true;
      gJwtSetBuf = "";
      return;
    }
    if (s.startsWith("JWT_SET_DATA")) {
      if (gJwtReceiving) {
        int sp = s.indexOf(' ');
        String rest = sp >= 0 ? s.substring(sp + 1) : "";
        int sp2 = rest.indexOf(' ');
        String chunk = sp2 >= 0 ? rest.substring(sp2 + 1) : rest;
        gJwtSetBuf += chunk;
      }
      return;
    }
    if (s.startsWith("JWT_SET_END")) {
      if (gJwtReceiving) {
        gJwtReceiving = false;
        String j = gJwtSetBuf;
        DynamicJsonDocument doc(1024);
        auto err = deserializeJson(doc, j);
        if (!err && doc.containsKey("jwt")) {
          gStoredJwt = doc["jwt"].as<String>();
          prefs.putString("jwt", gStoredJwt);
          txNotify("JWT_SAVED");
        } else {
          txNotify("JWT_SET_INVALID");
        }
        gJwtSetBuf = "";
      }
      return;
    }
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
    if (s.startsWith("CA_SET_BEGIN")) {
      gCaReceiving = true;
      gCaSetBuf = "";
      return;
    }
    if (s.startsWith("CA_SET_DATA")) {
      if (gCaReceiving) {
        int sp = s.indexOf(' ');
        String rest = sp >= 0 ? s.substring(sp + 1) : "";
        int sp2 = rest.indexOf(' ');
        String chunk = sp2 >= 0 ? rest.substring(sp2 + 1) : rest;
        gCaSetBuf += chunk;
      }
      return;
    }
    if (s.startsWith("CA_SET_END")) {
      if (gCaReceiving) {
        gCaReceiving = false;
        gCaBundle = gCaSetBuf;
        prefs.putString("ca_bundle", gCaBundle);
        gCaSetBuf = "";
        txNotify("CA_SAVED");
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
          gSupabaseUrl = normalizeHttpsUrl(doc["supabase_url"].as<String>());
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

    // 开启/关闭心跳 verbose（return=representation），便于查看 last_seen 回显
    if (s.equalsIgnoreCase("HB_VERBOSE_ON")) {
      gHbVerbose = true;
      txNotify("HB_VERBOSE_ON");
      return;
    }
    if (s.equalsIgnoreCase("HB_VERBOSE_OFF")) {
      gHbVerbose = false;
      txNotify("HB_VERBOSE_OFF");
      return;
    }

    // 控制是否允许 TLS 不安全回退（开发联调用）
    if (s.equalsIgnoreCase("DEV_INSECURE_ON")) {
      gAllowInsecure = true;
      prefs.putBool("allow_insec", true);
      txNotify("DEV_INSECURE_ON");
      return;
    }
    if (s.equalsIgnoreCase("DEV_INSECURE_OFF")) {
      gAllowInsecure = false;
      prefs.putBool("allow_insec", false);
      txNotify("DEV_INSECURE_OFF");
      return;
    }

    // 主动读取一次设备行（GET），观察 last_seen/status
    if (s.equalsIgnoreCase("HB_READ")) {
      if (WiFi.status() == WL_CONNECTED) {
        WiFiClientSecure client;
        client.setCACert(currentCa());
        bool ok = readDeviceRowOnce(client);
        txNotify(ok ? "HB_READ_OK" : "HB_READ_FAIL");
      } else {
        txNotify("WIFI_NOT_CONNECTED");
      }
      return;
    }

    if (s.equalsIgnoreCase("NET_PROBE")) {
      if (WiFi.status() == WL_CONNECTED) {
        bool ok = netProbeSupabase();
        txNotify(ok ? "NET_OK" : "NET_FAIL");
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
  randomSeed(micros());

  // 加载持久化配置
  prefs.begin("pinme", false);
  gSavedSsid = prefs.getString("ssid", "");
  gSavedPwd  = prefs.getString("pwd", "");
  gStoredJwt = prefs.getString("jwt", "");
  gAnonKey   = prefs.getString("anon", "");
  gSupabaseUrl = normalizeHttpsUrl(prefs.getString("sburl", gSupabaseUrl));
  gAllowInsecure = prefs.getBool("allow_insec", false);
  gCaBundle = prefs.getString("ca_bundle", "");

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
  if (WiFi.status() != WL_CONNECTED && gSavedSsid.length() > 0 && !wifiConnectBusy && !wifiListBusy && (millis() >= wifiScanLockUntilMs)) {
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
static String normalizeHttpsUrl(const String& in) {
  String u = String(in);
  u.trim();
  if (u.startsWith("http://")) {
    u.remove(0, 7);
    u = String("https://") + u;
  }
  if (!u.startsWith("https://")) {
    u = String("https://") + u;
  }
  // 去掉结尾斜杠，避免 Host 头或路径解析异常
  while (u.length() > 0 && u.endsWith("/")) {
    u.remove(u.length() - 1);
  }
  return u;
}