#ifndef RFID_PARSER_H
#define RFID_PARSER_H

#include <Arduino.h>

// Frame Constants
#define RFID_FRAME_HEADER 0xBB
#define RFID_FRAME_END    0x7E
#define RFID_TYPE_RESPONSE 0x01
#define RFID_TYPE_NOTIFICATION 0x02
#define RFID_CMD_GET_INFO   0x03
#define RFID_CMD_GET_POWER  0xB7
#define RFID_CMD_SET_POWER  0xB6
#define RFID_CMD_INVENTORY  0x22
#define RFID_CMD_STOP_MULTI 0x28
#define RFID_CMD_ERROR      0xFF
#define RFID_CMD_SET_SELECT_PARAM 0x0C
#define RFID_CMD_GET_SELECT_PARAM 0x0B
#define RFID_CMD_SET_SELECT_MODE  0x12

#define RFID_CMD_SET_REGION       0x07
#define RFID_CMD_GET_REGION       0x08
#define RFID_CMD_SET_QUERY        0x0E
#define RFID_CMD_GET_QUERY        0x0D
#define RFID_CMD_SET_CHANNEL      0xAB
#define RFID_CMD_GET_CHANNEL      0xAA
#define RFID_CMD_READ_DATA        0x39
#define RFID_CMD_WRITE_DATA       0x49

String parseRfidFrame(const uint8_t* buf, int len) {
  if (len < 6) { 
    // Min length check: Header(1)+Type(1)+Cmd(1)+PL(2)+CS(1)+End(1) = 7
    // Allowing smaller just in case, but structure requires at least PL.
    Serial.println("[rfid] Frame too short");
    return "Error: Frame too short";
  }

  // 1. Check Header
  if (buf[0] != RFID_FRAME_HEADER) {
    Serial.println("[rfid] Invalid Header");
    return "Error: Invalid Header";
  }

  // 2. Check End
  if (buf[len - 1] != RFID_FRAME_END) {
    Serial.println("[rfid] Invalid End Byte");
    return "Error: Invalid End Byte";
  }

  // 3. Extract Fields
  uint8_t type = buf[1];
  uint8_t cmd = buf[2];
  uint16_t pl = (buf[3] << 8) | buf[4]; // PL(MSB) PL(LSB)

  // Validate Length
  // Total len should be: 1(Header) + 1(Type) + 1(Cmd) + 2(PL) + PL_bytes + 1(CS) + 1(End)
  // = 7 + PL
  if (len != 7 + pl) {
    Serial.println(String("[rfid] Length mismatch. Expected=") + (7 + pl) + " Got=" + len);
    return "Error: Length mismatch";
  }

  // 4. Verify Checksum
  // Checksum range: Type ... Info (last byte of payload)
  // Indices: 1 to (len - 3) inclusive
  uint8_t csCalc = 0;
  for (int i = 1; i < len - 2; i++) { 
    csCalc += buf[i];
  }
  
  uint8_t csReceived = buf[len - 2];
  if (csCalc != csReceived) {
    Serial.println(String("[rfid] Checksum fail. Calc=") + String(csCalc, HEX) + " Recv=" + String(csReceived, HEX));
    return "Error: Checksum fail";
  }

  Serial.println("[rfid] Frame Valid");
  
  // 5. Parse Data based on Command
  if (type == RFID_TYPE_RESPONSE && cmd == RFID_CMD_GET_INFO) {
    if (pl < 1) return "Error: PL < 1"; // Need at least Info Type
    uint8_t infoType = buf[5]; // First byte of payload (index 5)
    String infoStr = "";
    for (int i = 6; i < 5 + pl; i++) {
      infoStr += (char)buf[i];
    }
    
    String typeLabel = "Unknown";
    if (infoType == 0x00) typeLabel = "Hardware Ver";
    else if (infoType == 0x01) typeLabel = "Software Ver";
    else if (infoType == 0x02) typeLabel = "Manufacturer";

    String res = String("Info: ") + typeLabel + " = " + infoStr;
    Serial.println("[rfid] " + res);
    return res;
  } 
  else if (type == RFID_TYPE_RESPONSE && cmd == RFID_CMD_GET_POWER) {
    // 4.21.2 响应帧
    // PL=2. Data=Pow(MSB) Pow(LSB)
    if (pl != 2) { Serial.println("[rfid] GetPower PL Err"); return "Error: GetPower PL!=2"; }
    uint16_t powVal = (buf[5] << 8) | buf[6];
    String res = String("Power: ") + powVal + " (" + (powVal/100) + " dBm)";
    Serial.println("[rfid] " + res);
    return res;
  }
  else if (type == RFID_TYPE_RESPONSE && cmd == RFID_CMD_SET_POWER) {
    // 4.22.2 响应帧
    // PL=1. Data=Parameter (0x00 Success)
    if (pl != 1) { Serial.println("[rfid] SetPower PL Err"); return "Error: SetPower PL!=1"; }
    uint8_t status = buf[5];
    String res = String("SetPower: ") + (status == 0x00 ? "Success" : "Fail");
    Serial.println("[rfid] " + res);
    return res;
  }
  else if (type == RFID_TYPE_NOTIFICATION && cmd == RFID_CMD_INVENTORY) {
    // 4.2.2 / 4.3.2 Notification Frame (Tag Found)
    // RSSI(1) PC(2) EPC(12) CRC(2) -> PL=17
    // Actually PL depends on EPC length, but example shows PL=11 (17 decimal)
    // RSSI is signed hex (e.g. C9 = -55dBm)
    
    if (pl < 5) return "Error: Inv PL too short"; // At least RSSI+PC+CRC? EPC can be variable?
    
    // Parse RSSI
    int8_t rssi = (int8_t)buf[5];
    
    // Parse PC (2 bytes)
    uint16_t pc = (buf[6] << 8) | buf[7];
    
    // Parse EPC (PL - 1(RSSI) - 2(PC) - 2(CRC))
    int epcLen = pl - 5;
    String epcStr = "";
    for(int i=0; i<epcLen; i++) {
      uint8_t b = buf[8+i];
      if (b < 0x10) epcStr += "0";
      epcStr += String(b, HEX);
    }
    epcStr.toUpperCase();
    
    String res = String("Tag: EPC=") + epcStr + " RSSI=" + rssi + "dBm";
    Serial.println("[rfid] " + res);
    return res;
  }
  else if (type == RFID_TYPE_RESPONSE && cmd == RFID_CMD_STOP_MULTI) {
    // 4.4.2 Stop Response
    // PL=1. Parameter=00 (Success)
    if (pl != 1) return "Error: Stop PL!=1";
    uint8_t status = buf[5];
    String res = String("StopPoll: ") + (status == 0x00 ? "Success" : "Fail");
    Serial.println("[rfid] " + res);
    return res;
  }
  else if (type == RFID_TYPE_RESPONSE && cmd == RFID_CMD_SET_SELECT_PARAM) {
    // 4.5.2 Set Select Param Response
    // PL=1, Data=00 (Success)
    if (pl != 1) return "Error: SetSel PL!=1";
    uint8_t status = buf[5];
    String res = String("SetSelectParam: ") + (status == 0x00 ? "Success" : "Fail");
    Serial.println("[rfid] " + res);
    return res;
  }
  else if (type == RFID_TYPE_RESPONSE && cmd == RFID_CMD_GET_SELECT_PARAM) {
    // 4.6.2 Get Select Param Response
    // Structure: SelParam(1) Ptr(4) MaskLen(1) Truncate(1) Mask(N)
    if (pl < 7) return "Error: GetSel PL too short";
    
    uint8_t selParam = buf[5];
    uint32_t ptr = ((uint32_t)buf[6] << 24) | ((uint32_t)buf[7] << 16) | ((uint32_t)buf[8] << 8) | buf[9];
    uint8_t maskLen = buf[10];
    uint8_t truncate = buf[11];
    
    String maskStr = "";
    int maskBytes = pl - 7;
    for(int i=0; i<maskBytes; i++) {
      uint8_t b = buf[12+i];
      if (b < 0x10) maskStr += "0";
      maskStr += String(b, HEX);
    }
    maskStr.toUpperCase();
    
    String res = "SelectParam: Target=" + String((selParam >> 5) & 0x07) + 
                 " Action=" + String((selParam >> 2) & 0x07) + 
                 " Mem=" + String(selParam & 0x03) + 
                 " Ptr=" + String(ptr) + 
                 " Len=" + String(maskLen) + 
                 " Trunc=" + String(truncate ? "Enable" : "Disable") + 
                 " Mask=" + maskStr;
    Serial.println("[rfid] " + res);
    return res;
  }
  else if (type == RFID_TYPE_RESPONSE && cmd == RFID_CMD_SET_SELECT_MODE) {
    if (pl != 1) return "Error: SetMode PL!=1";
    uint8_t status = buf[5];
    String res = String("SetSelectMode: ") + (status == 0x00 ? "Success" : "Fail");
    Serial.println("[rfid] " + res);
    return res;
  }
  else if (type == RFID_TYPE_RESPONSE && cmd == RFID_CMD_SET_REGION) {
    // 4.15.2 Set Region Response
    if (pl != 1) return "Error: SetRegion PL!=1";
    uint8_t status = buf[5];
    String res = String("SetRegion: ") + (status == 0x00 ? "Success" : "Fail");
    Serial.println("[rfid] " + res);
    return res;
  }
  else if (type == RFID_TYPE_RESPONSE && cmd == RFID_CMD_GET_REGION) {
    // 4.16.2 Get Region Response
    // PL=1, Param=Region
    if (pl != 1) return "Error: GetRegion PL!=1";
    uint8_t region = buf[5];
    String rName = "Unknown";
    switch(region) {
      case 0x01: rName = "China 900MHz"; break;
      case 0x04: rName = "China 800MHz"; break;
      case 0x02: rName = "USA"; break;
      case 0x03: rName = "Europe"; break;
      case 0x06: rName = "Korea"; break;
    }
    String res = "Region: " + rName + " (" + String(region, HEX) + ")";
    Serial.println("[rfid] " + res);
    return res;
  }
  else if (type == RFID_TYPE_RESPONSE && cmd == RFID_CMD_SET_CHANNEL) {
    // 4.17.2 Set Channel Response
    if (pl != 1) return "Error: SetChan PL!=1";
    uint8_t status = buf[5];
    String res = String("SetChannel: ") + (status == 0x00 ? "Success" : "Fail");
    Serial.println("[rfid] " + res);
    return res;
  }
  else if (type == RFID_TYPE_RESPONSE && cmd == 0xAD) { // RFID_CMD_SET_FREQ_HOPPING
    if (pl != 1) return "Error: SetFreqHopping PL!=1";
    uint8_t status = buf[5];
    String res = String("SetFreqHopping: ") + (status == 0x00 ? "Success" : "Fail");
    Serial.println("[rfid] " + res);
    return res;
  }
  else if (type == RFID_TYPE_RESPONSE && cmd == RFID_CMD_GET_CHANNEL) {
    // 4.18.2 Get Channel Response
    // PL=1, Param=Channel Index
    if (pl != 1) return "Error: GetChan PL!=1";
    uint8_t chIndex = buf[5];
    String res = "Channel Index: " + String(chIndex);
    Serial.println("[rfid] " + res);
    return res;
  }
  else if (type == RFID_TYPE_RESPONSE && cmd == RFID_CMD_SET_QUERY) {
    // 4.19.2 Set Query Response
    // PL=1. Parameter=00 (Success)
    if (pl != 1) return "Error: SetQuery PL!=1";
    uint8_t status = buf[5];
    String res = String("SetQuery: ") + (status == 0x00 ? "Success" : "Fail");
    Serial.println("[rfid] " + res);
    return res;
  }
  else if (type == RFID_TYPE_RESPONSE && cmd == RFID_CMD_GET_QUERY) {
    // 4.20.2 Get Query Response
    // PL=2. Data=QueryParam(MSB) QueryParam(LSB)
    if (pl != 2) return "Error: GetQuery PL!=2";
    uint16_t qParam = (buf[5] << 8) | buf[6];
    
    // Decode: DR(15) M(13-14) TRext(12) Sel(10-11) Session(8-9) Target(7) Q(3-6)
    uint8_t dr = (qParam >> 15) & 0x01;
    uint8_t m = (qParam >> 13) & 0x03;
    uint8_t trext = (qParam >> 12) & 0x01;
    uint8_t sel = (qParam >> 10) & 0x03;
    uint8_t session = (qParam >> 8) & 0x03;
    uint8_t target = (qParam >> 7) & 0x01;
    uint8_t q = (qParam >> 3) & 0x0F;
    
    String res = "QueryParam: DR=" + String(dr) + 
                 " M=" + String(m) + 
                 " TRext=" + String(trext) + 
                 " Sel=" + String(sel) + 
                 " Sess=" + String(session) + 
                 " Tgt=" + String(target) + 
                 " Q=" + String(q);
    Serial.println("[rfid] " + res);
    return res;
  }
  else if (type == RFID_TYPE_RESPONSE && cmd == RFID_CMD_READ_DATA) {
    // 4.8.2 Read Response
    // UL(1) PC(2) EPC(UL-2) Data(N)
    if (pl < 3) return "Error: Read PL too short";
    
    uint8_t ul = buf[5];
    uint16_t pc = (buf[6] << 8) | buf[7];
    int epcLen = ul - 2;
    
    String epcStr = "";
    for(int i=0; i<epcLen; i++) {
      uint8_t b = buf[8+i];
      if (b < 0x10) epcStr += "0";
      epcStr += String(b, HEX);
    }
    epcStr.toUpperCase();
    
    int dataIdx = 8 + epcLen;
    int dataLen = pl - 1 - ul; // Total PL - UL byte - (PC+EPC)
    
    String dataStr = "";
    for(int i=0; i<dataLen; i++) {
      uint8_t b = buf[dataIdx+i];
      if (b < 0x10) dataStr += "0";
      dataStr += String(b, HEX);
    }
    dataStr.toUpperCase();
    
    String res = "ReadData: EPC=" + epcStr + " Data=" + dataStr;
    Serial.println("[rfid] " + res);
    return res;
  }
  else if (type == RFID_TYPE_RESPONSE && cmd == RFID_CMD_WRITE_DATA) {
    // 4.9.2 Write Response
    // UL(1) PC(2) EPC(UL-2) Param(1)
    if (pl < 4) return "Error: Write PL too short";
    
    uint8_t ul = buf[5];
    // PC, EPC skipped for brevity, but could parse if needed
    // Param is at end: buf[5 + 1 + ul - 1] ?? No, UL includes PC+EPC.
    // Structure: UL(1) + PC_EPC(UL) + Param(1)
    // Param Index = 5 + 1 + UL
    // Wait, let's check index carefully.
    // Index 5: UL
    // Index 6...6+UL-1: PC+EPC
    // Index 6+UL: Param
    
    int paramIdx = 6 + ul; // Actually 5 + 1 + ul?
    // Example: UL=0E. 5->0E. 6..(6+14-1=19) is PC+EPC. 20 is Param.
    // 6 + 14 = 20. Correct.
    
    if (paramIdx >= len - 2) return "Error: Write Frame too short";
    
    uint8_t status = buf[paramIdx];
    String res = String("WriteData: ") + (status == 0x00 ? "Success" : "Fail");
    Serial.println("[rfid] " + res);
    return res;
  }
  else if (type == RFID_TYPE_RESPONSE && cmd == RFID_CMD_ERROR) {
    // Error Response
    // Standard: PL=1, Param=ErrCode
    // Extended (AP Err, Protocol Err): PL>1, ErrCode, UL, PC, EPC
    
    if (pl == 1) {
       uint8_t errCode = buf[5];
       String res = "Error: Code " + String(errCode, HEX);
       if (errCode == 0x15) res += " (No Tag Found)";
       Serial.println("[rfid] " + res);
       return res;
    } else {
       // Extended Error
       uint8_t errCode = buf[5];
       // Check if it's 0x16 or 0xA0+ or 0xB0+
       String errType = "Unknown";
       if (errCode == 0x16) errType = "Access Pwd Err";
       else if ((errCode & 0xF0) == 0xA0) errType = "Read Protocol Err " + String(errCode & 0x0F, HEX);
       else if ((errCode & 0xF0) == 0xB0) errType = "Write Protocol Err " + String(errCode & 0x0F, HEX);
       
       // Try to parse EPC if present
       // Structure: ErrCode(1) UL(1) PC(2) EPC(UL-2)
       // Index 5: ErrCode
       // Index 6: UL
       uint8_t ul = buf[6];
       int epcLen = ul - 2;
       String epcStr = "";
       if (pl >= 2 + ul) { // 1(Err) + 1(UL) + UL(PC+EPC)
         for(int i=0; i<epcLen; i++) {
           uint8_t b = buf[9+i]; // 5+1+1+2 = 9? 
           // Index 5: Err
           // Index 6: UL
           // Index 7: PC_H
           // Index 8: PC_L
           // Index 9: EPC start
           if (b < 0x10) epcStr += "0";
           epcStr += String(b, HEX);
         }
       }
       epcStr.toUpperCase();
       String res = "Error: " + errType + " (Code " + String(errCode, HEX) + ") EPC=" + epcStr;
       Serial.println("[rfid] " + res);
       return res;
    }
  }
  
  return "Unknown Frame: Cmd=" + String(cmd, HEX);
}

#endif
