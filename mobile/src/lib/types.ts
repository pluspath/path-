// Path+ Core Types

export type MomentType = 'thought' | 'location' | 'sleep' | 'wakeup';

export type VenueCategory = 'coffee' | 'restaurant' | 'bar' | 'gym' | 'park' | 'home' | 'work' | 'airport' | 'hotel' | 'store';

export interface User {
  id: string;
  name: string;
  username?: string;
  avatar: string;
  bio: string;
  location: string;
  birthday: string;
  coverPhoto: string;
  joinDate: string;
  friendCount: number;
  postCount: number;
  momentCount: number;
  showZodiac?: boolean;
  usernameChanged?: boolean;
  friendshipStatus?: 'none' | 'pending_sent' | 'pending_received' | 'friends';
  friendshipId?: string;
}

export interface Post {
  id: string;
  userId: string;
  user: User;
  type: MomentType;
  content?: string;
  image?: string;
  locationName?: string;
  locationLat?: number;
  locationLng?: number;
  venueCategory?: VenueCategory;
  sleepAction?: 'sleeping' | 'woke_up';
  sleepDuration?: string;
  reactions: Reaction[];
  commentCount: number;
  createdAt: string;
}

export interface Reaction {
  userId: string;
  type: '❤️' | '😊' | '😮' | '😢';
  userAvatar?: string;
}

export interface FriendRequest {
  id: string;
  user: User;
  mutualFriends: number;
  createdAt: string;
}

export interface Notification {
  id: string;
  type: 'reaction' | 'comment' | 'friend_request' | 'friend_accepted' | 'sleep' | 'memory' | 'ping';
  user: User;
  message: string;
  postId?: string;
  postImage?: string;
  read: boolean;
  createdAt: string;
  friendshipId?: string;
}

export interface Message {
  id: string;
  senderId: string;
  text: string;
  image?: string;
  createdAt: string;
}

export interface Conversation {
  id: string;
  user: User;
  lastMessage: string;
  lastMessageTime: string;
  lastMessageSenderId?: string;
  unreadCount: number;
  messages: Message[];
}

export interface Memory {
  id: string;
  post: Post;
  yearsAgo: number;
}

export interface NearbyPlace {
  name: string;
  address: string;
  types: string[];
  rating: number | null;
}
