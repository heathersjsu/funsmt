#ifndef SUPABASE_HEARTBEAT_H
#define SUPABASE_HEARTBEAT_H

#include <HTTPClient.h>
#include <WiFiClientSecure.h>

void handleHeartbeatLoop() {
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
        http.addHeader("Prefer", "return=representation");

        DynamicJsonDocument doc(256);
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
        Serial.println("[http] sending patch: " + payload); 
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
}

#endif
