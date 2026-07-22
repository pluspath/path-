# Path+ App Memory

## Stack
- Mobile: Expo SDK 53, React Native, TypeScript, Zustand, React Query
- Backend: Hono + Bun on port 3000, NO Prisma (removed)
- Auth: Supabase Auth (email/password + OTP)
- Database: Supabase PostgreSQL (accessed via @supabase/supabase-js client, NOT Prisma)
- Storage: Supabase Storage (buckets: avatars, covers)

## Supabase Config
- URL: https://mxdgwftyvupxmlyzsvqk.supabase.co
- Anon Key: sb_publishable_U5tTrVu3kQoL6R3hqzGw2g_DIw3n9F_
- Backend uses anon key + user JWT for RLS-based DB access
- Mobile: EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY set in mobile/.env

## Database Tables (Supabase)
- profiles: id, username, full_name, avatar_url, cover_url, bio, location, birthday, created_at
- posts: id, user_id, content, image_url, location, location_lat, location_lng, type, music_*, activity_*, meal_name, sleep_action, sleep_duration, venue_category, created_at
- friendships: id, requester_id, receiver_id, status, created_at
- reactions: id, post_id, user_id, type, created_at
- comments: id, post_id, user_id, content, created_at
- conversations: id, created_at, updated_at
- conversation_participants: conversation_id, user_id (composite PK)
- messages: id, conversation_id, sender_id, content, image_url, type, created_at
- notifications: id, user_id, from_user_id, type, message, post_id, read, created_at

## Backend Architecture
- No Prisma - uses createUserClient(token) for user-scoped Supabase queries
- Auth middleware: verifies JWT via supabase.auth.getUser(), fetches profile from profiles table
- HonoVariables: user (Profile|null), userId (string|null), accessToken (string|null)
- prisma/schema.prisma renamed to .bak to prevent startup script from running prisma commands

## Key Files
- backend/src/supabase.ts: exports supabase (anon client) and createUserClient(token)
- backend/src/env.ts: validates SUPABASE_URL and SUPABASE_ANON_KEY
- mobile/src/lib/supabase.ts: Supabase client with AsyncStorage
- mobile/src/lib/store.ts: Zustand store with isSleeping state

## Features Implemented
- Supabase Auth (email/password, OTP verification)
- Terms & Conditions screen (shown on first launch, stored in AsyncStorage 'terms_accepted')
- GPS location using expo-location + reverse geocoding
- Sleep mode: posts sleep moment → shows full-screen sleep overlay → wake up creates wake post
- Profile/cover photo upload to Supabase Storage
- Real username uniqueness check (backend /api/username-check/:username)
- Ping message type in conversations

## App Theme
- Background: #0A1F44 (dark navy blue)
- Accent: #C9A84C (gold)
- Text: #FFFFFF, secondary: #94A3B8
