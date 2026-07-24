export type Profile = {
  id: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
  cover_url: string | null;
  bio: string | null;
  location: string | null;
  birthday: string | null;
  show_zodiac: boolean | null;
  username_changed: boolean | null;
  post_visibility?: "everyone" | "friends" | null;
  push_notifications_enabled?: boolean | null;
  email_notifications_enabled?: boolean | null;
  push_token?: string | null;
  created_at: string;
};

export type HonoVariables = {
  user: Profile | null;
  userId: string | null;
  accessToken: string | null;
};
