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

    // Brand-family tints only - a random material palette clashed with the
    // otherwise tightly-branded shell.
    const getBrandColor = (name: string) => {
        const colors = ['#6f74e0', '#888cee', '#7c74d6', '#a78bfa', '#5f64d6'];
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
                alt={username}
                aria-label={username}
                sx={{
                    width: size,
                    height: size,
                    bgcolor: getBrandColor(username),
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