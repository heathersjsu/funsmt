#ifndef DEVICE_CONFIG_H
#define DEVICE_CONFIG_H

#include <WiFi.h>
#include <Preferences.h>
#include "esp_mac.h"

Preferences prefs;

// Global configuration variables
String deviceId = "";
String wifiSsid = "";
String wifiPwd = "";
String supabaseUrl = "";
String anonKey = "";
String deviceJwt = "";
String caBundle = "";
bool insecureOn = false;
const char* fwVersion = "1.0.0";
bool provisioned = false;

// Global state variables
bool wifiConnecting = false;
unsigned long wifiStartTs = 0;
unsigned long lastWifiAttemptTs = 0;
bool httpStarted = false;
bool wifiRequested = false;

String toUpperHex(uint8_t* mac) {
  char buf[13];
  snprintf(buf, sizeof(buf), "%02X%02X%02X%02X%02X%02X", mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  return String(buf);
}

String deriveDeviceId() {
  uint8_t mac[6] = {0};
  // Try esp_read_mac first as it is more robust at boot
  esp_err_t ret = esp_read_mac(mac, ESP_MAC_WIFI_STA);
  if (ret != ESP_OK) {
    Serial.println(String("[boot] esp_read_mac failed: ") + String(ret) + ", trying WiFi.macAddress");
    WiFi.macAddress(mac);
  }
  
  String hex = toUpperHex(mac);
  Serial.println(String("[boot] Raw MAC: ") + hex);
  
  if (hex == "000000000000") {
    Serial.println("[boot] MAC is all zero. Using random fallback.");
    uint32_t r = esp_random();
    char randBuf[7];
    snprintf(randBuf, sizeof(randBuf), "%06X", r & 0xFFFFFF);
    hex = String("000000") + String(randBuf);
    Serial.println(String("[boot] Fallback MAC suffix: ") + String(randBuf));
  }
  
  // User requirement: Unified use of pinme_ prefix
  return String("pinme_") + hex.substring(6);
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

// Forward declaration for Provisioning
extern void notifyMsg(const String& msg);

void connectWifi(const String& ssid, const String& pwd) {
  Serial.println(String("[wifi] connect begin ssid=") + ssid);
  if (ssid.length() == 0) return;
  
  // Clean up previous state to avoid "sta is connecting" errors
  WiFi.disconnect();
  delay(100);
  
  WiFi.begin(ssid.c_str(), pwd.c_str());
  wifiConnecting = true;
  wifiStartTs = millis();
  lastWifiAttemptTs = millis();
  wifiRequested = true;
}

void setupDeviceConfig() {
  // Initialize Wi-Fi first to ensure MAC address is available
  WiFi.mode(WIFI_AP_STA);
  
  deviceId = deriveDeviceId();
  Serial.println(String("[boot] deviceId=") + deviceId);
  loadPrefs();
  
  String apName = String("PINME-") + deviceId.substring(deviceId.length() - 6);
  bool apOk = WiFi.softAP(apName.c_str());
  Serial.println(String("[wifi] AP start name=") + apName + String(" ok=") + String(apOk ? "true" : "false"));
}

// RFID Status Logic Configuration
#define HEARTBEAT_INTERVAL_MS 60000  // 1 minute
#define RFID_SCAN_INTERVAL_MS 60000  // 1 minute
#define RFID_RSSI_THRESHOLD -65
#define RFID_STABLE_CYCLES 3
#define RFID_MISSED_CYCLES 2
#define RFID_OUT_CYCLES 3
#define RFID_DISPLACEMENT_RSSI_DIFF 10

#endif
