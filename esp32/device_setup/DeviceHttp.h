#ifndef DEVICE_HTTP_H
#define DEVICE_HTTP_H

#include <WebServer.h>
#include <ArduinoJson.h>

// Forward declaration for peripheral testing
extern String testGetInfo();
extern String testGetPower();
extern String testSetPower(int dbm);
extern String testSinglePoll();
extern String testMultiPoll(uint16_t count);
extern String testStopPoll();
extern String testGetSelectParam();
extern String testSetSelectMode(uint8_t mode);
extern String testSetSelectParamDefault();
extern String testSetRegion(uint8_t region);
extern String testGetRegion();
extern String testSetChannel(uint8_t chIndex);
extern String testGetChannel();
extern String testReadData(uint32_t ap, uint8_t mb, uint16_t sa, uint16_t dl);
extern String testWriteData(uint32_t ap, uint8_t mb, uint16_t sa, uint16_t dl, const uint8_t* data, uint16_t dataLen);

WebServer server(80);

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

void setupHttp() {
  Serial.println("[http] setup begin");
  server.on("/info", handleInfo);
  server.on("/debug", [](){ handleTextEndpoint("debug"); });
  server.on("/lcd", [](){ handleTextEndpoint("lcd"); });
  server.on("/notify", [](){ handleTextEndpoint("notify"); });
  // Test UART Peripheral (manual trigger)
  server.on("/rfid_fetch", [](){
    String res = testGetInfo();
    server.send(200, "text/plain", res);
  });
  
  server.on("/rfid_get_power", [](){
    String res = testGetPower();
    server.send(200, "text/plain", res);
  });
  
  server.on("/rfid_set_power", [](){
    if (!server.hasArg("dbm")) {
      server.send(400, "text/plain", "Missing dbm arg");
      return;
    }
    int dbm = server.arg("dbm").toInt();
    String res = testSetPower(dbm);
    server.send(200, "text/plain", res);
  });
  
  server.on("/rfid_single_poll", [](){
    String res = testSinglePoll();
    server.send(200, "text/plain", res);
  });
  
  server.on("/rfid_multi_poll", [](){
    int count = 100;
    if (server.hasArg("count")) count = server.arg("count").toInt();
    String res = testMultiPoll(count);
    server.send(200, "text/plain", res);
  });
  
  server.on("/rfid_stop_poll", [](){
    String res = testStopPoll();
    server.send(200, "text/plain", res);
  });
  
  server.on("/rfid_get_select", [](){
    String res = testGetSelectParam();
    server.send(200, "text/plain", res);
  });
  
  server.on("/rfid_set_select_default", [](){
    String res = testSetSelectParamDefault();
    server.send(200, "text/plain", res);
  });
  
  server.on("/rfid_set_select_mode", [](){
    int mode = 0;
    if (server.hasArg("mode")) mode = server.arg("mode").toInt();
    String res = testSetSelectMode(mode);
    server.send(200, "text/plain", res);
  });
  
  server.on("/rfid_set_region", [](){
    int region = 1;
    if (server.hasArg("region")) region = server.arg("region").toInt();
    String res = testSetRegion(region);
    server.send(200, "text/plain", res);
  });
  
  server.on("/rfid_get_region", [](){
    String res = testGetRegion();
    server.send(200, "text/plain", res);
  });
  
  server.on("/rfid_set_channel", [](){
    int ch = 1;
    if (server.hasArg("ch")) ch = server.arg("ch").toInt();
    String res = testSetChannel(ch);
    server.send(200, "text/plain", res);
  });
  
  server.on("/rfid_get_channel", [](){
    String res = testGetChannel();
    server.send(200, "text/plain", res);
  });
  
  server.on("/rfid_read_data", [](){
    // args: ap, mb, sa, dl
    uint32_t ap = 0;
    if (server.hasArg("ap")) ap = strtoul(server.arg("ap").c_str(), NULL, 16);
    
    uint8_t mb = 3; // Default User
    if (server.hasArg("mb")) mb = server.arg("mb").toInt();
    
    uint16_t sa = 0;
    if (server.hasArg("sa")) sa = server.arg("sa").toInt();
    
    uint16_t dl = 2; // Default 2 words (4 bytes)
    if (server.hasArg("dl")) dl = server.arg("dl").toInt();
    
    String res = testReadData(ap, mb, sa, dl);
    server.send(200, "text/plain", res);
  });
  
  server.on("/rfid_write_data", [](){
    // args: ap, mb, sa, dl, data(hex string)
    uint32_t ap = 0;
    if (server.hasArg("ap")) ap = strtoul(server.arg("ap").c_str(), NULL, 16);
    
    uint8_t mb = 3; 
    if (server.hasArg("mb")) mb = server.arg("mb").toInt();
    
    uint16_t sa = 0;
    if (server.hasArg("sa")) sa = server.arg("sa").toInt();
    
    uint16_t dl = 2;
    if (server.hasArg("dl")) dl = server.arg("dl").toInt();
    
    String dataHex = "12345678";
    if (server.hasArg("data")) dataHex = server.arg("data");
    
    // Parse hex data
    int len = dataHex.length();
    if (len % 2 != 0) {
      server.send(400, "text/plain", "Data length must be even hex digits");
      return;
    }
    
    uint8_t* buf = new uint8_t[len/2];
    for (int i = 0; i < len; i += 2) {
       char tmp[3];
       tmp[0] = dataHex[i];
       tmp[1] = dataHex[i+1];
       tmp[2] = 0;
       buf[i/2] = strtoul(tmp, NULL, 16);
    }
    
    String res = testWriteData(ap, mb, sa, dl, buf, len/2);
    delete[] buf;
    server.send(200, "text/plain", res);
  });

  // Start HTTP server now that AP is up (AP setup moved to DeviceConfig)
  server.begin();
  httpStarted = true;
  Serial.println("[http] server started at AP ip=" + WiFi.softAPIP().toString());
}

void handleHttpLoop() {
  server.handleClient();
}

#endif
