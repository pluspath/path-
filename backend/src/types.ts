export type Profile = {
  id: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
  cover_url: string | null;
  bio: string | null;
  location: string | null;
  birthday: string | null;
  gender: string | null;
  show_age: boolean | null;
  show_zodiac: boolean | null;
  username_changed: boolean | null;
  created_at: string;
};

export type HonoVariables = {
  user: Profile | null;
  userId: string | null;
  accessToken: string | null;
};
