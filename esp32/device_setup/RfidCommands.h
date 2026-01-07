#ifndef RFID_COMMANDS_H
#define RFID_COMMANDS_H

#include <Arduino.h>

// Frame Constants
#define RFID_FRAME_HEADER 0xBB
#define RFID_FRAME_END    0x7E
#define RFID_TYPE_COMMAND 0x00

// Command Codes
#define RFID_CMD_GET_INFO   0x03
#define RFID_CMD_GET_POWER  0xB7
#define RFID_CMD_SET_POWER  0xB6
#define RFID_CMD_INVENTORY_SINGLE 0x22
#define RFID_CMD_INVENTORY_MULTI  0x27
#define RFID_CMD_STOP_MULTI       0x28
#define RFID_CMD_SET_SELECT_PARAM 0x0C
#define RFID_CMD_GET_SELECT_PARAM 0x0B
#define RFID_CMD_SET_SELECT_MODE  0x12
#define RFID_CMD_SET_REGION       0x07
#define RFID_CMD_GET_REGION       0x08
#define RFID_CMD_SET_QUERY        0x0E
#define RFID_CMD_GET_QUERY        0x0D
#define RFID_CMD_SET_CHANNEL      0xAB
#define RFID_CMD_GET_CHANNEL      0xAA
#define RFID_CMD_SET_FREQ_HOPPING 0xAD
#define RFID_CMD_READ_DATA        0x39
#define RFID_CMD_WRITE_DATA       0x49

// Helper to calculate checksum: Sum(Type...Data)
uint8_t calcChecksum(const uint8_t* buf, int len) {
  uint8_t cs = 0;
  // Checksum starts from Type (index 1) to Data end (len-2)
  // But here we construct buffer fully then calc.
  // The buffer passed here is assumed to be: Header(0) Type(1) Cmd(2) PL_H(3) PL_L(4) [Data...] CS(n-2) End(n-1)
  // We need to sum from index 1 to n-3.
  // Actually, easier to sum as we build.
  return 0;
}

class RfidCommands {
public:
  // Buffer to hold generated command
  static uint8_t cmdBuf[64]; // Increased size for mask
  static int cmdLen;

  // 4.19. 设置自动跳频
  static void buildSetFreqHopping(uint8_t mode) {
    cmdLen = 0;
    cmdBuf[cmdLen++] = RFID_FRAME_HEADER;
    cmdBuf[cmdLen++] = RFID_TYPE_COMMAND;
    cmdBuf[cmdLen++] = RFID_CMD_SET_FREQ_HOPPING;
    cmdBuf[cmdLen++] = 0x00;
    cmdBuf[cmdLen++] = 0x01;
    cmdBuf[cmdLen++] = mode; // 0xFF: Auto, 0x00: Cancel
    
    uint8_t cs = 0;
    for (int i = 1; i < cmdLen; i++) cs += cmdBuf[i];
    cmdBuf[cmdLen++] = cs;
    cmdBuf[cmdLen++] = RFID_FRAME_END;
  }

  // 4.1. 获取设备信息 (Existing)
  static void buildGetInfo() {
    // BB 00 03 00 01 00 04 7E 
    // Wait, user original command was: BB 00 03 00 01 00 04 7E
    // PL=1, Data=00. Type=00 Cmd=03. 00+03+00+01+00 = 04. Correct.
    cmdLen = 0;
    cmdBuf[cmdLen++] = RFID_FRAME_HEADER;
    cmdBuf[cmdLen++] = RFID_TYPE_COMMAND;
    cmdBuf[cmdLen++] = RFID_CMD_GET_INFO;
    cmdBuf[cmdLen++] = 0x00; // PL MSB
    cmdBuf[cmdLen++] = 0x01; // PL LSB
    cmdBuf[cmdLen++] = 0x00; // Info Type: Hardware Ver (00)
    
    // Calc Checksum
    uint8_t cs = 0;
    for (int i = 1; i < cmdLen; i++) cs += cmdBuf[i];
    cmdBuf[cmdLen++] = cs;
    
    cmdBuf[cmdLen++] = RFID_FRAME_END;
  }

  // 4.21. 获取发射功率
  // BB 00 B7 00 00 B7 7E
  static void buildGetPower() {
    cmdLen = 0;
    cmdBuf[cmdLen++] = RFID_FRAME_HEADER;
    cmdBuf[cmdLen++] = RFID_TYPE_COMMAND;
    cmdBuf[cmdLen++] = RFID_CMD_GET_POWER;
    cmdBuf[cmdLen++] = 0x00; // PL MSB
    cmdBuf[cmdLen++] = 0x00; // PL LSB
    
    // Calc Checksum
    uint8_t cs = 0;
    for (int i = 1; i < cmdLen; i++) cs += cmdBuf[i];
    cmdBuf[cmdLen++] = cs;
    
    cmdBuf[cmdLen++] = RFID_FRAME_END;
  }

  // 4.22. 设置发射功率
  // Power in dBm (e.g., 20) -> 2000 (0x07D0)
  // BB 00 B6 00 02 07 D0 8F 7E
  static void buildSetPower(uint16_t dbm) {
    uint16_t val = dbm * 100; // 20 -> 2000
    
    cmdLen = 0;
    cmdBuf[cmdLen++] = RFID_FRAME_HEADER;
    cmdBuf[cmdLen++] = RFID_TYPE_COMMAND;
    cmdBuf[cmdLen++] = RFID_CMD_SET_POWER;
    cmdBuf[cmdLen++] = 0x00; // PL MSB
    cmdBuf[cmdLen++] = 0x02; // PL LSB
    cmdBuf[cmdLen++] = (val >> 8) & 0xFF; // Pow MSB
    cmdBuf[cmdLen++] = val & 0xFF;        // Pow LSB
    
    // Calc Checksum
    uint8_t cs = 0;
    for (int i = 1; i < cmdLen; i++) cs += cmdBuf[i];
    cmdBuf[cmdLen++] = cs;
    
    cmdBuf[cmdLen++] = RFID_FRAME_END;
  }

  // 4.2. 单次轮询
  // BB 00 22 00 00 22 7E
  static void buildSinglePoll() {
    cmdLen = 0;
    cmdBuf[cmdLen++] = RFID_FRAME_HEADER;
    cmdBuf[cmdLen++] = RFID_TYPE_COMMAND;
    cmdBuf[cmdLen++] = RFID_CMD_INVENTORY_SINGLE;
    cmdBuf[cmdLen++] = 0x00; // PL MSB
    cmdBuf[cmdLen++] = 0x00; // PL LSB
    
    uint8_t cs = 0;
    for (int i = 1; i < cmdLen; i++) cs += cmdBuf[i];
    cmdBuf[cmdLen++] = cs;
    
    cmdBuf[cmdLen++] = RFID_FRAME_END;
  }

  // 4.3. 多次轮询
  // BB 00 27 00 03 22 CNT_H CNT_L CS 7E
  static void buildMultiPoll(uint16_t count) {
    cmdLen = 0;
    cmdBuf[cmdLen++] = RFID_FRAME_HEADER;
    cmdBuf[cmdLen++] = RFID_TYPE_COMMAND;
    cmdBuf[cmdLen++] = RFID_CMD_INVENTORY_MULTI;
    cmdBuf[cmdLen++] = 0x00; // PL MSB
    cmdBuf[cmdLen++] = 0x03; // PL LSB
    cmdBuf[cmdLen++] = 0x22; // Reserved
    cmdBuf[cmdLen++] = (count >> 8) & 0xFF; // CNT MSB
    cmdBuf[cmdLen++] = count & 0xFF;        // CNT LSB
    
    uint8_t cs = 0;
    for (int i = 1; i < cmdLen; i++) cs += cmdBuf[i];
    cmdBuf[cmdLen++] = cs;
    
    cmdBuf[cmdLen++] = RFID_FRAME_END;
  }

  // 4.4. 停止多次轮询
  // BB 00 28 00 00 28 7E
  static void buildStopPoll() {
    cmdLen = 0;
    cmdBuf[cmdLen++] = RFID_FRAME_HEADER;
    cmdBuf[cmdLen++] = RFID_TYPE_COMMAND;
    cmdBuf[cmdLen++] = RFID_CMD_STOP_MULTI;
    cmdBuf[cmdLen++] = 0x00; // PL MSB
    cmdBuf[cmdLen++] = 0x00; // PL LSB
    
    uint8_t cs = 0;
    for (int i = 1; i < cmdLen; i++) cs += cmdBuf[i];
    cmdBuf[cmdLen++] = cs;
    
    cmdBuf[cmdLen++] = RFID_FRAME_END;
  }

  // 4.5. 设置Select 参数
  static void buildSetSelectParam(uint8_t selParam, uint32_t ptr, uint8_t maskLen, bool truncate, const uint8_t* mask, uint8_t maskByteLen) {
    // CMD: BB 00 0C PL_MSB PL_LSB SelParam Ptr(4) MaskLen Truncate Mask(N) CS 7E
    // PL = 1(SelParam) + 4(Ptr) + 1(MaskLen) + 1(Truncate) + maskByteLen
    uint16_t pl = 7 + maskByteLen;
    
    cmdLen = 0;
    cmdBuf[cmdLen++] = RFID_FRAME_HEADER;
    cmdBuf[cmdLen++] = RFID_TYPE_COMMAND;
    cmdBuf[cmdLen++] = RFID_CMD_SET_SELECT_PARAM;
    cmdBuf[cmdLen++] = (pl >> 8) & 0xFF;
    cmdBuf[cmdLen++] = pl & 0xFF;
    
    cmdBuf[cmdLen++] = selParam;
    cmdBuf[cmdLen++] = (ptr >> 24) & 0xFF;
    cmdBuf[cmdLen++] = (ptr >> 16) & 0xFF;
    cmdBuf[cmdLen++] = (ptr >> 8) & 0xFF;
    cmdBuf[cmdLen++] = ptr & 0xFF;
    cmdBuf[cmdLen++] = maskLen;
    cmdBuf[cmdLen++] = truncate ? 0x80 : 0x00;
    
    for(int i=0; i<maskByteLen; i++) {
      cmdBuf[cmdLen++] = mask[i];
    }
    
    uint8_t cs = 0;
    for (int i = 1; i < cmdLen; i++) cs += cmdBuf[i];
    cmdBuf[cmdLen++] = cs;
    cmdBuf[cmdLen++] = RFID_FRAME_END;
  }

  // 4.6. 获取Select 参数
  static void buildGetSelectParam() {
    cmdLen = 0;
    cmdBuf[cmdLen++] = RFID_FRAME_HEADER;
    cmdBuf[cmdLen++] = RFID_TYPE_COMMAND;
    cmdBuf[cmdLen++] = RFID_CMD_GET_SELECT_PARAM;
    cmdBuf[cmdLen++] = 0x00;
    cmdBuf[cmdLen++] = 0x00;
    
    uint8_t cs = 0;
    for (int i = 1; i < cmdLen; i++) cs += cmdBuf[i];
    cmdBuf[cmdLen++] = cs;
    cmdBuf[cmdLen++] = RFID_FRAME_END;
  }

  // 4.7. 设置Select 模式
  static void buildSetSelectMode(uint8_t mode) {
    cmdLen = 0;
    cmdBuf[cmdLen++] = RFID_FRAME_HEADER;
    cmdBuf[cmdLen++] = RFID_TYPE_COMMAND;
    cmdBuf[cmdLen++] = RFID_CMD_SET_SELECT_MODE;
    cmdBuf[cmdLen++] = 0x00;
    cmdBuf[cmdLen++] = 0x01;
    cmdBuf[cmdLen++] = mode;
    
    uint8_t cs = 0;
    for (int i = 1; i < cmdLen; i++) cs += cmdBuf[i];
    cmdBuf[cmdLen++] = cs;
    cmdBuf[cmdLen++] = RFID_FRAME_END;
  }

  // 4.15. 设置工作地区
  // Region: 01=CN900, 04=CN800, 02=US, 03=EU, 06=KR
  static void buildSetRegion(uint8_t region) {
    cmdLen = 0;
    cmdBuf[cmdLen++] = RFID_FRAME_HEADER;
    cmdBuf[cmdLen++] = RFID_TYPE_COMMAND;
    cmdBuf[cmdLen++] = RFID_CMD_SET_REGION;
    cmdBuf[cmdLen++] = 0x00;
    cmdBuf[cmdLen++] = 0x01;
    cmdBuf[cmdLen++] = region;
    
    uint8_t cs = 0;
    for (int i = 1; i < cmdLen; i++) cs += cmdBuf[i];
    cmdBuf[cmdLen++] = cs;
    cmdBuf[cmdLen++] = RFID_FRAME_END;
  }

  // 4.16. 获取工作地区
  static void buildGetRegion() {
    cmdLen = 0;
    cmdBuf[cmdLen++] = RFID_FRAME_HEADER;
    cmdBuf[cmdLen++] = RFID_TYPE_COMMAND;
    cmdBuf[cmdLen++] = RFID_CMD_GET_REGION;
    cmdBuf[cmdLen++] = 0x00;
    cmdBuf[cmdLen++] = 0x00;
    
    uint8_t cs = 0;
    for (int i = 1; i < cmdLen; i++) cs += cmdBuf[i];
    cmdBuf[cmdLen++] = cs;
    cmdBuf[cmdLen++] = RFID_FRAME_END;
  }

  // 4.16a 设置Query参数
  // CMD: BB 00 0E 00 02 DR_M_TRext_Sel_Session_Target_Q(2bytes) CS 7E
  // Param:
  // Bit 15: DR (1)
  // Bit 13-14: M (2)
  // Bit 12: TRext (1)
  // Bit 10-11: Sel (2)
  // Bit 8-9: Session (2)
  // Bit 7: Target (1)
  // Bit 3-6: Q (4)
  // Bit 0-2: Reserved (0)
  // Wait, standard mapping usually:
  // MSB: DR(1) M(2) TRext(1) Sel(2) Session(2)
  // LSB: Target(1) Q(4) Reserved(3)
  static void buildSetQuery(uint8_t dr, uint8_t m, uint8_t trext, uint8_t sel, uint8_t session, uint8_t target, uint8_t q) {
    uint16_t param = 0;
    param |= (dr & 0x01) << 15;
    param |= (m & 0x03) << 13;
    param |= (trext & 0x01) << 12;
    param |= (sel & 0x03) << 10;
    param |= (session & 0x03) << 8;
    param |= (target & 0x01) << 7;
    param |= (q & 0x0F) << 3;
    
    cmdLen = 0;
    cmdBuf[cmdLen++] = RFID_FRAME_HEADER;
    cmdBuf[cmdLen++] = RFID_TYPE_COMMAND;
    cmdBuf[cmdLen++] = RFID_CMD_SET_QUERY;
    cmdBuf[cmdLen++] = 0x00;
    cmdBuf[cmdLen++] = 0x02;
    cmdBuf[cmdLen++] = (param >> 8) & 0xFF;
    cmdBuf[cmdLen++] = param & 0xFF;
    
    uint8_t cs = 0;
    for (int i = 1; i < cmdLen; i++) cs += cmdBuf[i];
    cmdBuf[cmdLen++] = cs;
    cmdBuf[cmdLen++] = RFID_FRAME_END;
  }
  
  // 4.16b 获取Query参数
  static void buildGetQuery() {
    cmdLen = 0;
    cmdBuf[cmdLen++] = RFID_FRAME_HEADER;
    cmdBuf[cmdLen++] = RFID_TYPE_COMMAND;
    cmdBuf[cmdLen++] = RFID_CMD_GET_QUERY;
    cmdBuf[cmdLen++] = 0x00;
    cmdBuf[cmdLen++] = 0x00;
    
    uint8_t cs = 0;
    for (int i = 1; i < cmdLen; i++) cs += cmdBuf[i];
    cmdBuf[cmdLen++] = cs;
    cmdBuf[cmdLen++] = RFID_FRAME_END;
  }

  // 4.16c 设置Query参数 (Raw Hex)
  static void buildSetQueryRaw(uint16_t param) {
    cmdLen = 0;
    cmdBuf[cmdLen++] = RFID_FRAME_HEADER;
    cmdBuf[cmdLen++] = RFID_TYPE_COMMAND;
    cmdBuf[cmdLen++] = RFID_CMD_SET_QUERY;
    cmdBuf[cmdLen++] = 0x00;
    cmdBuf[cmdLen++] = 0x02;
    cmdBuf[cmdLen++] = (param >> 8) & 0xFF;
    cmdBuf[cmdLen++] = param & 0xFF;
    
    uint8_t cs = 0;
    for (int i = 1; i < cmdLen; i++) cs += cmdBuf[i];
    cmdBuf[cmdLen++] = cs;
    cmdBuf[cmdLen++] = RFID_FRAME_END;
  }

  // 4.17. 设置工作信道
  static void buildSetChannel(uint8_t chIndex) {
    cmdLen = 0;
    cmdBuf[cmdLen++] = RFID_FRAME_HEADER;
    cmdBuf[cmdLen++] = RFID_TYPE_COMMAND;
    cmdBuf[cmdLen++] = RFID_CMD_SET_CHANNEL;
    cmdBuf[cmdLen++] = 0x00;
    cmdBuf[cmdLen++] = 0x01;
    cmdBuf[cmdLen++] = chIndex;
    
    uint8_t cs = 0;
    for (int i = 1; i < cmdLen; i++) cs += cmdBuf[i];
    cmdBuf[cmdLen++] = cs;
    cmdBuf[cmdLen++] = RFID_FRAME_END;
  }

  // 4.18. 获取工作信道
  static void buildGetChannel() {
    cmdLen = 0;
    cmdBuf[cmdLen++] = RFID_FRAME_HEADER;
    cmdBuf[cmdLen++] = RFID_TYPE_COMMAND;
    cmdBuf[cmdLen++] = RFID_CMD_GET_CHANNEL;
    cmdBuf[cmdLen++] = 0x00;
    cmdBuf[cmdLen++] = 0x00;
    
    uint8_t cs = 0;
    for (int i = 1; i < cmdLen; i++) cs += cmdBuf[i];
    cmdBuf[cmdLen++] = cs;
    cmdBuf[cmdLen++] = RFID_FRAME_END;
  }

  // 4.8. 读标签数据存储区
  static void buildReadData(uint32_t accessPassword, uint8_t memBank, uint16_t sa, uint16_t dl) {
    // CMD: BB 00 39 00 09 AP(4) MB SA(2) DL(2) CS 7E
    cmdLen = 0;
    cmdBuf[cmdLen++] = RFID_FRAME_HEADER;
    cmdBuf[cmdLen++] = RFID_TYPE_COMMAND;
    cmdBuf[cmdLen++] = RFID_CMD_READ_DATA;
    cmdBuf[cmdLen++] = 0x00;
    cmdBuf[cmdLen++] = 0x09;
    
    cmdBuf[cmdLen++] = (accessPassword >> 24) & 0xFF;
    cmdBuf[cmdLen++] = (accessPassword >> 16) & 0xFF;
    cmdBuf[cmdLen++] = (accessPassword >> 8) & 0xFF;
    cmdBuf[cmdLen++] = accessPassword & 0xFF;
    
    cmdBuf[cmdLen++] = memBank;
    
    cmdBuf[cmdLen++] = (sa >> 8) & 0xFF;
    cmdBuf[cmdLen++] = sa & 0xFF;
    
    cmdBuf[cmdLen++] = (dl >> 8) & 0xFF;
    cmdBuf[cmdLen++] = dl & 0xFF;
    
    uint8_t cs = 0;
    for (int i = 1; i < cmdLen; i++) cs += cmdBuf[i];
    cmdBuf[cmdLen++] = cs;
    cmdBuf[cmdLen++] = RFID_FRAME_END;
  }

  // 4.9. 写标签数据存储区
  static void buildWriteData(uint32_t accessPassword, uint8_t memBank, uint16_t sa, uint16_t dl, const uint8_t* data, uint16_t dataLen) {
    // CMD: BB 00 49 PL_H PL_L AP(4) MB SA(2) DL(2) DT(N) CS 7E
    // PL = 9 + dataLen
    uint16_t pl = 9 + dataLen;
    
    cmdLen = 0;
    cmdBuf[cmdLen++] = RFID_FRAME_HEADER;
    cmdBuf[cmdLen++] = RFID_TYPE_COMMAND;
    cmdBuf[cmdLen++] = RFID_CMD_WRITE_DATA;
    cmdBuf[cmdLen++] = (pl >> 8) & 0xFF;
    cmdBuf[cmdLen++] = pl & 0xFF;
    
    cmdBuf[cmdLen++] = (accessPassword >> 24) & 0xFF;
    cmdBuf[cmdLen++] = (accessPassword >> 16) & 0xFF;
    cmdBuf[cmdLen++] = (accessPassword >> 8) & 0xFF;
    cmdBuf[cmdLen++] = accessPassword & 0xFF;
    
    cmdBuf[cmdLen++] = memBank;
    
    cmdBuf[cmdLen++] = (sa >> 8) & 0xFF;
    cmdBuf[cmdLen++] = sa & 0xFF;
    
    cmdBuf[cmdLen++] = (dl >> 8) & 0xFF;
    cmdBuf[cmdLen++] = dl & 0xFF;
    
    for(int i=0; i<dataLen; i++) {
      cmdBuf[cmdLen++] = data[i];
    }
    
    uint8_t cs = 0;
    for (int i = 1; i < cmdLen; i++) cs += cmdBuf[i];
    cmdBuf[cmdLen++] = cs;
    cmdBuf[cmdLen++] = RFID_FRAME_END;
  }
};

// Define static members
uint8_t RfidCommands::cmdBuf[64];
int RfidCommands::cmdLen = 0;

#endif
