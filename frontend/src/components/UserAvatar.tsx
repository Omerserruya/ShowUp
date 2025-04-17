import React from 'react';
import { Avatar, Stack, Typography, Box } from '@mui/material';
import { useUser } from '../contexts/UserContext';

interface UserAvatarProps {
    username?: string;
    avatarUrl?: string;
    size?: number;
    showUsername?: boolean;
    userFromProps?: boolean;
}

export default function UserAvatar({ 
    username: propUsername, 
    avatarUrl: propAvatarUrl,
    size = 40, 
    showUsername = true,
    userFromProps = false 
}: UserAvatarProps) {
    const { user } = useUser();
    
    // Use props if provided, otherwise use user from context
    const username = userFromProps ? propUsername : user?.username;
    const avatarUrl = userFromProps ? propAvatarUrl : user?.avatarUrl;

    // Get initials from username
    const getInitials = (name: string | undefined) => {
        if (!name) return 'G';
        
        return name
            .split(' ')
            .map(word => word[0])
            .join('')
            .toUpperCase();
    };

    // If not showing username, just render the Avatar
    if (!showUsername) {
        return (
            <Avatar 
                src={avatarUrl || ""}
                sx={{ 
                    width: size, 
                    height: size,
                    bgcolor: '#9e9e9e', // Consistent gray color
                    fontSize: `${size * 0.4}px`,
                    fontWeight: 'medium'
                }}
            >
                {getInitials(username)}
            </Avatar>
        );
    }

    // If showing username, render Avatar with text
    return (
        <Stack direction="row" spacing={2} alignItems="center" sx={{ width: 'fit-content' }}>
            <Avatar 
                src={avatarUrl || ""}
                sx={{ 
                    width: size, 
                    height: size,
                    bgcolor: '#9e9e9e', // Consistent gray color
                    fontSize: `${size * 0.4}px`,
                    fontWeight: 'medium'
                }}
            >
                {getInitials(username)}
            </Avatar>
            {(
                <Box>
                    <Typography variant="subtitle2">{username || 'Guest Name'}</Typography>
                </Box>
            )}
        </Stack>
    );
}