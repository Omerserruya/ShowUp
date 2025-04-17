import * as React from 'react';
import { useState } from 'react';
import FormControl from '@mui/material/FormControl';
import InputAdornment from '@mui/material/InputAdornment';
import OutlinedInput from '@mui/material/OutlinedInput';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import CloseIcon from '@mui/icons-material/Close';
import { 
  IconButton, 
  Box, 
  Dialog, 
  DialogContent, 
  Typography, 
  useMediaQuery
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useSearch } from '../contexts/SearchContext';

export default function Search() {
  // Get context values
  const { 
    searchQuery, 
    setSearchQuery, 
    isSearchOpen, 
    setIsSearchOpen
  } = useSearch();
  
  // Media queries for responsive design
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  // Handle input change
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };

  // Open the search dialog
  const handleOpenSearch = () => {
    setIsSearchOpen(true);
  };

  // Close the search dialog and clear search
  const handleCloseSearch = (e?: React.MouseEvent | React.KeyboardEvent) => {
    // If event provided, prevent default and stop propagation
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    
    // Update state to close dialog
    setIsSearchOpen(false);
    
    // We don't clear the search text immediately to avoid visual glitches
    // during the close animation
    setTimeout(() => {
      setSearchQuery('');
    }, 300);
  };

  // Handle dialog close event with correct parameter type
  const handleDialogClose = (_event: {}, reason: "backdropClick" | "escapeKeyDown") => {
    // Close regardless of reason
    setIsSearchOpen(false);
    
    // Clear search with delay
    setTimeout(() => {
      setSearchQuery('');
    }, 300);
  };

  // Clear the search input
  const handleClearSearch = () => {
    setSearchQuery('');
  };

  return (
    <>
      <FormControl
          sx={{
          width: {
            xs: '100%',
            sm: '400px',
            md: '500px',
          },
        }}
        variant="outlined">
        <OutlinedInput
          size="small"
          id="search"
          placeholder="Search…"
          sx={{ flexGrow: 1 }}
          onClick={handleOpenSearch}
          onFocus={handleOpenSearch}
          value={searchQuery}
          onChange={handleInputChange}
          startAdornment={
            <InputAdornment position="start" sx={{ color: 'text.primary' }}>
              <SearchRoundedIcon fontSize="small" />
            </InputAdornment>
          }
          endAdornment={
            searchQuery ? (
              <InputAdornment position="end">
                <IconButton
                  aria-label="clear search"
                  onClick={handleClearSearch}
                  edge="end"
                  size="small"
                >
                  <CloseIcon fontSize="small" />
                </IconButton>
              </InputAdornment>
            ) : null
          }
          inputProps={{
            'aria-label': 'search',
          }}
        />
      </FormControl>

      {/* Search Dialog */}
      <Dialog
        open={isSearchOpen}
        onClose={handleDialogClose}
        fullScreen={isMobile}
        maxWidth="md"
        fullWidth
        disableRestoreFocus
        keepMounted={false}
        hideBackdrop={false}
        onClick={(e) => {
          // This ensures clicking the dialog itself doesn't trigger closing
          e.stopPropagation();
        }}
        BackdropProps={{
          onClick: (e) => {
            // Clicking backdrop should close the dialog
            handleCloseSearch(e);
          }
        }}
      >
        <DialogContent sx={{ p: 0 }}>
          {/* Search Bar */}
          <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center' }}>
            <FormControl fullWidth variant="outlined">
              <OutlinedInput
                autoFocus
                size="small"
                placeholder="Search..."
                value={searchQuery}
                onChange={handleInputChange}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    handleCloseSearch(e);
                  }
                }}
                startAdornment={
                  <InputAdornment position="start">
                    <SearchRoundedIcon fontSize="small" />
                  </InputAdornment>
                }
                endAdornment={
                  searchQuery && (
                    <InputAdornment position="end">
                      <IconButton
                        aria-label="clear search"
                        onClick={handleClearSearch}
                        edge="end"
                        size="small"
                      >
                        <CloseIcon fontSize="small" />
                      </IconButton>
                    </InputAdornment>
                  )
                }
              />
            </FormControl>

            {/* Close Button - Using a native HTML button for reliability */}
            <button
              onClick={(e) => handleCloseSearch(e)}
              style={{
                background: 'transparent',
                border: 'none',
                padding: '8px',
                marginLeft: '8px',
                borderRadius: '50%',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <CloseIcon />
            </button>
          </Box>
          
          {/* Coming Soon Message */}
          <Box sx={{ 
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            overflowY: 'auto', 
            maxHeight: 'calc(80vh - 70px)',
            height: isMobile ? 'calc(100vh - 70px)' : '400px',
            p: 4
          }}>
            <Typography variant="h4" color="primary" textAlign="center" sx={{ mb: 2 }}>
              Coming Soon!
            </Typography>
            <Typography variant="body1" color="text.secondary" textAlign="center">
              Search functionality is currently under development and will be available in a future update.
            </Typography>
          </Box>
        </DialogContent>
      </Dialog>
    </>
  );
}
