#include "DeviceConfig.h"
#include "DeviceHttp.h"
#include "RfidParser.h"
#include "PeripheralUart.h"
#include "Provisioning.h"
#include "SupabaseHeartbeat.h"
#include "SupabaseCommands.h"

void setup() {
  Serial.begin(115200);
  delay(3000); // Increased boot delay for stability and manual command check
  Serial.println("\n[boot] setup begin");
  
  // Initialize config, prefs, and basic network (AP)
  setupDeviceConfig();
  
  // Setup functional modules
  setupBleProvisioning();
  setupPeripheralUart();
  
  // Run RFID Hardware Initialization
  // Wait a bit more to ensure reader is powered up
  delay(1000);
  runRfidInitialization();
  
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
  handleContinuousLoop(); // Process continuous scanning if active
  handlePeripheralLoop();
  
  delay(10);
}
