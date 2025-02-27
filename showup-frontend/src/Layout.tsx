import React from "react";
import SideMenu from "./components/SideMenuCustom/SideMenu";
import { Box } from "@mui/material";
import Stack from "@mui/material/Stack";

function Layout() {
  return (
    <Stack direction="row" spacing={2}>
      <Box
        sx={{
          width: '240px', // Adjust the width as needed
          height: '100vh', // Full height of the viewport
          overflow: 'auto', // Add scroll if content overflows
        }}
      >
        <SideMenu />
      </Box>
      <Box flex={1}
      sx={{bgColor:'background.secondary',
         height: '100%' 
      }}>
      </Box>
    </Stack>
  );
}

export default Layout;