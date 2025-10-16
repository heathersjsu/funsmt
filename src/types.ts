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