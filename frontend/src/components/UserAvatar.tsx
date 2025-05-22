import React from 'react';
import { Avatar, Box, Typography } from '@mui/material';

interface UserAvatarProps {
    username: string;
    avatarUrl?: string;
    size?: number;
    showUsername?: boolean;
    userFromProps?: boolean;
}

export default function UserAvatar({ 
    username, 
    avatarUrl, 
    size = 40, 
    showUsername = true,
    userFromProps = false 
}: UserAvatarProps) {
    const getInitials = (name: string) => {
        return name
            .split(' ')
            .map(part => part[0])
            .join('')
            .toUpperCase()
            .slice(0, 2);
    };

    const getRandomColor = (name: string) => {
        const colors = [
            '#f44336', '#e91e63', '#9c27b0', '#673ab7', '#3f51b5',
            '#2196f3', '#03a9f4', '#00bcd4', '#009688', '#4caf50',
            '#8bc34a', '#cddc39', '#ffc107', '#ff9800', '#ff5722'
        ];
        
        let hash = 0;
        for (let i = 0; i < name.length; i++) {
            hash = name.charCodeAt(i) + ((hash << 5) - hash);
        }
        
        return colors[Math.abs(hash) % colors.length];
    };

    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Avatar 
                src={avatarUrl}
                sx={{ 
                    width: size, 
                    height: size,
                    bgcolor: getRandomColor(username),
                    fontSize: `${size * 0.4}px`
                }}
            >
                {!avatarUrl && getInitials(username)}
            </Avatar>
            {showUsername && (
                <Typography variant="body1" sx={{ fontWeight: 500 }}>
                    {username}
                </Typography>
            )}
                </Box>
    );
}