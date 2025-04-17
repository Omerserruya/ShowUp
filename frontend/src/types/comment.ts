export interface PostComment {
  id: string;
  user: string;
  content: string;
  timestamp: string;
  userAvatar?: string;
  isCurrentUser?: boolean;
} 