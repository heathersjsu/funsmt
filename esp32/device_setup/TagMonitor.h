#ifndef TAG_MONITOR_H
#define TAG_MONITOR_H

#include <map>
#include "DeviceConfig.h"
#include "PeripheralUart.h"
#include "SupabaseCommands.h"

enum TagState {
  STATE_UNKNOWN,
  STATE_IN_PLACE,
  STATE_IN_PLAYING,
  STATE_OUT
};

struct TagInfo {
  String epc;
  int rssi;
  int stableCount;
  int missedCount;
  TagState state;
  unsigned long lastSeen;
  time_t playStartTime;
};

// Global map to track tags
// Note: std::map usage on embedded systems requires care with heap, but for < 200 tags it's fine.
std::map<String, TagInfo> trackedTags;

time_t getCurrentTime() {
    time_t now = time(nullptr);
    // If year is < 2020 (1577836800), NTP probably not synced
    if (now < 1577836800) return 0;
    return now;
}

void updateTag(String epc, int rssi) {
    // Normalize EPC
    epc.replace(" ", "");
    
    if (trackedTags.find(epc) == trackedTags.end()) {
        TagInfo t;
        t.epc = epc;
        t.rssi = rssi;
        t.stableCount = 1;
        t.missedCount = 0;
        // If RSSI is very strong initially, assume In Place immediately
        if (rssi > -55) {
            t.state = STATE_IN_PLACE;
            updateToyStatus(epc, "in");
        } else {
            t.state = STATE_UNKNOWN;
        }
        t.lastSeen = millis();
        t.playStartTime = 0;
        trackedTags[epc] = t;
        Serial.println("[TM] New Tag: " + epc + " RSSI=" + String(rssi) + " State=" + String(t.state));
    } else {
        TagInfo &t = trackedTags[epc];
        
        // 2.3 Real-time Displacement Detection
        // "RSSI value sudden change (> 10dB)"
        // Note: RSSI fluctuates naturally, so we might want to check against an average, but simple diff for now.
        if (t.state == STATE_IN_PLACE && abs(rssi - t.rssi) > RFID_DISPLACEMENT_RSSI_DIFF) {
            Serial.println("[TM] Displacement! Tag=" + epc + " RSSI diff=" + String(rssi - t.rssi));
            // Trigger Event: Displacement -> In Playing -> Out
            t.state = STATE_OUT;
            t.stableCount = 0;
            t.playStartTime = getCurrentTime();
            updateToyStatus(epc, "out");
        }
        
        t.rssi = rssi; 
        t.lastSeen = millis();
        t.missedCount = 0; // Reset missed count
        
        // 2.2 State Logic
        if (rssi >= RFID_RSSI_THRESHOLD) {
             // Strong Signal
             if (t.state != STATE_IN_PLACE) {
                 t.stableCount++;
                 // Use a more lenient condition for quick testing or robust environments
                 // If signal is very strong, consider it IN_PLACE immediately or with fewer cycles
                 if (rssi > -50 || t.stableCount >= RFID_STABLE_CYCLES) {
                     // Transition: Playing/Out -> In Place
                     if ((t.state == STATE_IN_PLAYING || t.state == STATE_OUT) && t.playStartTime > 0) {
                         time_t now = getCurrentTime();
                         if (now > 0) {
                             recordPlaySession(t.epc, t.playStartTime, now);
                         }
                         t.playStartTime = 0;
                     }
                     
                     t.state = STATE_IN_PLACE;
                     Serial.println("[TM] Tag In Place: " + epc);
                     updateToyStatus(epc, "in");
                 }
             } else {
                 // Already In Place, maintain
                 t.stableCount = RFID_STABLE_CYCLES; 
             }
        } else {
             // Weak Signal
             // "Or RSSI < Threshold ... -> In Playing"
             if (t.state == STATE_IN_PLACE) {
                 Serial.println("[TM] Tag Weak Signal: " + epc + " (" + String(rssi) + ")");
                 // Optional: Debounce weak signal to avoid flickering? 
                 // For now, strict threshold logic as requested.
                 t.state = STATE_OUT;
                 t.stableCount = 0;
                 t.playStartTime = getCurrentTime();
                 updateToyStatus(epc, "out");
             }
        }
    }
}

void checkMissingTags(unsigned long scanStartParams) {
    for (auto &kv : trackedTags) {
        TagInfo &t = kv.second;
        // If not seen in this cycle (lastSeen < scanStartParams)
        if (t.lastSeen < scanStartParams) {
            t.missedCount++;
            t.stableCount = 0;
            
            // 1. Internal State Transition at 2 missed cycles (RFID_MISSED_CYCLES)
            if (t.missedCount == RFID_MISSED_CYCLES) {
                if (t.state != STATE_IN_PLAYING) {
                    t.state = STATE_IN_PLAYING;
                    t.playStartTime = getCurrentTime();
                    Serial.println("[TM] Tag Missing " + String(RFID_MISSED_CYCLES) + "x (Playing internal): " + t.epc);
                    // No cloud update yet, wait for confirmation
                }
            }

            // 2. Cloud Status Update at N missed cycles (RFID_OUT_CYCLES)
            if (t.missedCount >= RFID_OUT_CYCLES) {
                 // Always try to ensure cloud is in sync if we think it's OUT.
                 // We only transition internal state to OUT if cloud update succeeds.
                 // This acts as a retry mechanism: if update fails, missedCount continues to grow,
                 // and we retry next cycle.
                 if (t.state != STATE_OUT) {
                      Serial.println("[TM] Tag Missing " + String(t.missedCount) + "x -> OUT: " + t.epc);
                      bool success = updateToyStatus(t.epc, "out");
                      if (success) {
                          t.state = STATE_OUT;
                          if (t.playStartTime == 0) t.playStartTime = getCurrentTime();
                      } else {
                          Serial.println("[TM] Failed to update status OUT, will retry next cycle");
                      }
                 }
            }
        }
    }
}

void runScanCycle() {
    Serial.println("[TM] Starting Scan Cycle...");
    unsigned long scanStart = millis();
    
    // Use logic similar to testMultiPoll but process immediately
    // Use a larger count to ensure we get everything
    int count = 300; 
    RfidCommands::buildMultiPoll(count);
    sendRfidCommand(RfidCommands::cmdBuf, RfidCommands::cmdLen);
    
    unsigned long start = millis();
    // Dynamic timeout based on count (matches PeripheralUart logic)
    unsigned long duration = 15000; 
    
    while (millis() - start < duration) {
        if (MyPeripheralSerial.available()) {
            String res = readRfidResponse();
            if (res.startsWith("Tag:")) {
                // Format: "Tag: EPC=... RSSI=...dBm"
                // Parse it.
                int epcStart = res.indexOf("EPC=") + 4;
                int rssiStart = res.indexOf("RSSI=");
                int rssiEnd = res.indexOf("dBm");
                
                if (epcStart > 4 && rssiStart > epcStart && rssiEnd > rssiStart) {
                    String epc = res.substring(epcStart, rssiStart);
                    epc.trim();
                    String rssiStr = res.substring(rssiStart + 5, rssiEnd);
                    int rssi = rssiStr.toInt();
                    
                    updateTag(epc, rssi);
                }
            }
        }
        // Minimal delay to allow buffer fill
        delay(5);
    }
    
    checkMissingTags(scanStart);
    Serial.println("[TM] Scan Cycle Complete.");
}

void initAssignedTags(String epcList) {
    if (epcList.length() == 0) return;
    
    // Split by comma
    int start = 0;
    while (true) {
        int idx = epcList.indexOf(',', start);
        String epc;
        if (idx == -1) {
            epc = epcList.substring(start);
        } else {
            epc = epcList.substring(start, idx);
        }
        epc.trim();
        
        if (epc.length() > 0) {
            // Add to trackedTags if not exists
            if (trackedTags.find(epc) == trackedTags.end()) {
                TagInfo t;
                t.epc = epc;
                t.rssi = -100; // Unknown/Weak
                t.stableCount = 0;
                t.missedCount = 0;
                // Initialize as OUT or UNKNOWN. 
                // If user wants to force update "out" if not found, we can start with UNKNOWN
                // and if it's not found in first scan, it will transition to OUT eventually.
                // Or start as OUT immediately? 
                // Let's start as STATE_UNKNOWN, so first scan cycle will increment missedCount.
                t.state = STATE_UNKNOWN; 
                t.lastSeen = 0; // Never seen recently
                t.playStartTime = 0;
                trackedTags[epc] = t;
                Serial.println("[TM] Loaded Assigned Tag: " + epc);
            }
        }
        
        if (idx == -1) break;
        start = idx + 1;
    }
}

#endif
