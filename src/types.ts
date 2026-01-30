export type ToyStatus = 'in' | 'out';

export interface Toy {
  id: string;
  user_id: string;
  name: string;
  rfid: string | null;
  photo_url: string | null;
  category: string | null;
  source: string | null;
  location: string | null;
  owner: string | null;
  device_id: string | null;
  status: ToyStatus;
  notes: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface DeviceToken {
  id: string;
  user_id: string;
  token: string;
  created_at: string;
}

export interface Device {
  id?: string;
  device_id: string;
  user_id?: string | null;
  name: string | null;
  location: string | null;
  wifi_ssid: string | null;
  wifi_signal: number | null;
  status: 'online' | 'offline' | string;
  last_seen: string | null;
  config?: any;
  inserted_at?: string | null;
  updated_at?: string | null;
}

export interface Reader {
  id: string
  name: string
  location?: string | null
  device_id: string
  is_online: boolean
  last_seen_at?: string | null
  created_at?: string
  config?: Record<string, unknown>
  org_id?: string | null
  user_id?: string | null
}