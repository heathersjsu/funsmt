#include "DeviceConfig.h"
#include "DeviceHttp.h"
#include "Provisioning.h"
#include "SupabaseHeartbeat.h"
#include "SupabaseCommands.h"
#include "PeripheralUart.h"
#include "RfidParser.h"

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n[boot] setup begin");
  
  // Initialize config, prefs, and basic network (AP)
  setupDeviceConfig();
  
  // Setup functional modules
  setupBleProvisioning();
  setupPeripheralUart();
  setupHttp();

  // If already provisioned, connect to saved Wi-Fi
  if (provisioned && wifiSsid.length() > 0) {
    connectWifi(wifiSsid, wifiPwd);
  }
  
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  Serial.println("[boot] setup done");
}

void loop() {
  handleHttpLoop();
  handleProvisioningLoop();
  handleHeartbeatLoop();
  handleCommandLoop();
  handlePeripheralLoop();
  
  delay(10);
}
