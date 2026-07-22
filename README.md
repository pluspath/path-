# Path+

An intimate, private social network for close friends and family. Inspired by the original Path app, Path+ limits your connections to 150 people (Dunbar's number), creating a warm and personal sharing experience.

## Features

### Core Screens
- **Onboarding** - 4-step animated flow: welcome splash, phone/OTP verification, profile setup, contact sync
- **Home Feed** - Infinite scroll feed with pull-to-refresh, showing posts from all connections
- **Notifications** - Grouped notifications with "On This Day" memory cards
- **Messages** - Direct messaging with conversation list and chat interface
- **Profile** - Parallax cover photo, avatar, stats, photo grid, and "My Path" timeline
- **Friends** - Friend list, requests, suggestions, and 150-friend limit enforcement
- **Settings** - Account, privacy, notification preferences, and logout

### Moment Types (Post Creation)
7 unique moment types, each with specialized UI:
- Photo, Location (check-in), Music (listening to), Sleep, Food, Thought, Activity

### Design System
- **Navy (#0A1F44)** primary with **Gold (#C9A84C)** accents
- **Cream (#F8F6F2)** backgrounds
- Floating pill-shaped tab bar with 5 tabs
- Spring animations, haptic feedback throughout
- Moment-type-specific card designs and colors

### Navigation
- Custom floating tab bar (Home, Notifications, Create+, Messages, Profile)
- Gold center "+" button opens moment creation
- Stack navigation for chat, friend profiles, settings, edit profile

## Tech Stack
- React Native + Expo SDK 53
- NativeWind (TailwindCSS) for styling
- Zustand for state management
- React Native Reanimated for animations
- FlashList for performant feeds
- Expo Image for optimized image loading
- Lucide icons

## Project Structure
```
mobile/src/
  app/
    (tabs)/          - Tab screens (feed, notifications, messages, profile)
    chat/[id].tsx    - Individual chat screen
    friend-profile/  - Friend profile view
    create-moment    - Moment creation modal
    onboarding       - 4-step onboarding flow
    settings         - App settings
    edit-profile     - Edit profile form
    friends          - Friends list & requests
  components/
    PostCard         - Feed post card with reactions
    FloatingTabBar   - Custom pill tab bar
    RadialMenu       - Radial moment type selector
    MemoryCard       - "On This Day" memory card
  lib/
    types.ts         - TypeScript interfaces
    mock-data.ts     - Pre-populated sample data
    store.ts         - Zustand state management
```
